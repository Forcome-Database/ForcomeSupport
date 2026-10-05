import type { DemoFixture } from '@forcome/fixtures';
import { defineClient, type FakeClient } from './definition';
import { ExternalCallFailedError, FaultInjector } from './faults';
import { buildFakeMail, type FakeMailInput } from './gmail-mime';
import { fixtureMails } from './gmail-replay';

/*
 * Gmail（规格 channel「Gmail 客户端」、ADR 0008 修订；待办 08 是最小形态，09 补健壮性）：
 * - 邮箱（店铺级，gmail）：watch 建立推送并给出增量游标 historyId；history.list 取游标之后新到的消息；
 *   messages.get 取原始邮件（RFC 822）。真实现与 Fake 是同一个接口；
 * - 推送（全局，gmail_push）：Gmail 把「某邮箱有变化」发到 Pub/Sub 主题，worker 从本环境的订阅 pull 后确认。
 *   推送是环境级的（一个订阅服务全部邮箱），所以与按店铺选择的邮箱客户端分开，按 CLIENT_MODE_GMAIL_PUSH 选择；
 *   Fake 邮箱在被 watch 后把通知发进同一进程的 Fake 推送。
 * 真实现（服务账号 + 全域委派、Pub/Sub 订阅、代理与调用记录）随 09 号待办；在那之前调用一律以「未接入」失败，
 * 生产环境不会悄悄退回 Fake。
 */

/** 一封邮件的原始内容（messages.get format=raw） */
export interface GmailRawMessage {
  /** Gmail 消息 ID（同一邮箱内唯一，E-15 按「邮箱 + 它」去重） */
  readonly id: string;
  readonly threadId: string;
  /** Gmail 标签，如 INBOX、SENT、DRAFT、SPAM */
  readonly labelIds: readonly string[];
  /** 到达时间（Gmail internalDate），SLA 与「最近来信」都以它为准 */
  readonly internalDate: Date;
  /** RFC 822 原文（真实现把 base64url 解码成字节） */
  readonly raw: Uint8Array;
}

export interface GmailClient {
  /** 建立（或续订）推送，返回此刻的增量游标与推送到期时间（users.watch，不按标签过滤） */
  watch(mailbox: string): Promise<{ historyId: string; expiration: Date }>;
  /**
   * 游标之后新到的消息（users.history.list，historyTypes=messageAdded，分页在实现里取完）；
   * 返回新游标。游标过期（404）抛 CursorExpiredError，由 09 号待办按 internalDate 区间补拉
   */
  listHistory(
    mailbox: string,
    startHistoryId: string,
  ): Promise<{ messageIds: string[]; historyId: string }>;
  /** 一封邮件的原文（users.messages.get，format=raw） */
  getMessage(mailbox: string, messageId: string): Promise<GmailRawMessage>;
}

/** Pub/Sub 推来的一条通知：某邮箱有变化（Gmail 推送的 emailAddress 与 historyId） */
export interface GmailNotification {
  readonly ackId: string;
  readonly mailbox: string;
  readonly historyId: string;
}

export interface GmailPushClient {
  /** 从本环境的订阅拉取通知；waitSeconds 为 0 时立即返回，否则最多等这么久（长轮询） */
  pull(options: { maxMessages: number; waitSeconds: number }): Promise<GmailNotification[]>;
  /** 确认已处理；没确认的通知到期后会再次投递（至少一次） */
  acknowledge(ackIds: readonly string[]): Promise<void>;
}

function notConnected(system: string, operation: string): Promise<never> {
  return Promise.reject(
    new ExternalCallFailedError(system, operation, {
      message: '尚未接入真实接口（服务账号与 Pub/Sub 订阅随 09 号待办）',
      retryable: false,
    }),
  );
}

/** 真实现的占位：09 号待办接入服务账号 + 全域委派（googleapis）与 Pub/Sub 订阅 */
const realGmail = (): GmailClient => ({
  watch: () => notConnected('gmail', 'users.watch'),
  listHistory: () => notConnected('gmail', 'users.history.list'),
  getMessage: () => notConnected('gmail', 'users.messages.get'),
});

const realGmailPush = (): GmailPushClient => ({
  pull: () => notConnected('gmail_push', 'pull'),
  acknowledge: () => notConnected('gmail_push', 'acknowledge'),
});

// ---------------------------------------------------------------- Fake

interface StoredMessage extends GmailRawMessage {
  readonly historyId: number;
}

interface FakeMailbox {
  /** 当前的 historyId；每到一封信加 1 */
  historyId: number;
  watched: boolean;
  readonly messages: StoredMessage[];
  /** 回放的示例来信：开始监听后才送达（演示环境里它们是系统上线后到达的来信） */
  pending: FakeMailInput[];
}

function recipientsOf(mail: FakeMailInput): readonly string[] {
  return typeof mail.to === 'string' ? [mail.to] : mail.to;
}

/** 邮箱的 historyId 从这里起算（Gmail 的 historyId 是不透明的递增数字） */
const HISTORY_START = 1000;
/** Gmail 推送的有效期 */
const WATCH_DAYS = 7;

/**
 * Fake 推送：Fake 邮箱被 watch 后，每到一封信发一条通知进来。拉走但没确认的通知，下次拉取时再次投递
 * （真实 Pub/Sub 在确认期限到了之后重投，这里不等期限）。
 */
export class FakeGmailPush implements FakeClient<GmailPushClient> {
  readonly faults = new FaultInjector('gmail_push');
  #queue: { ackId: string; mailbox: string; historyId: string }[] = [];
  #outstanding = new Map<string, { ackId: string; mailbox: string; historyId: string }>();
  #nextAck = 1;

  publish(mailbox: string, historyId: string): void {
    this.#queue.push({ ackId: `ack-${this.#nextAck++}`, mailbox, historyId });
  }

  /** 还没确认的通知数（包括已拉走未确认的） */
  get unacknowledged(): number {
    return this.#queue.length + this.#outstanding.size;
  }

  client(): GmailPushClient {
    return {
      pull: async ({ maxMessages }) => {
        await this.faults.check('pull');
        // 上次拉走没确认的先重投
        this.#queue.unshift(...this.#outstanding.values());
        this.#outstanding.clear();
        const batch = this.#queue.splice(0, maxMessages);
        for (const n of batch) this.#outstanding.set(n.ackId, n);
        return batch.map((n) => ({ ...n }));
      },
      acknowledge: async (ackIds) => {
        await this.faults.check('acknowledge');
        for (const ackId of ackIds) this.#outstanding.delete(ackId);
      },
    };
  }

  reset(): void {
    this.#queue = [];
    this.#outstanding.clear();
    this.#nextAck = 1;
    this.faults.reset();
  }
}

/**
 * Fake Gmail：按邮箱存放邮件与 history。测试用 deliver 放入来信（发到多个邮箱时每个邮箱各一份，Message-ID 相同），
 * redeliver 让同一封信在 history 里再出现一次（E-15 的重复投递）；被 watch 的邮箱每到一封信发一条推送通知。
 * 进程启动时从示例数据夹具回放来信（replay），这些来信在邮箱开始监听后送达。
 */
export class FakeGmail implements FakeClient<GmailClient> {
  readonly faults = new FaultInjector('gmail');
  readonly #push: () => FakeGmailPush;
  readonly #mailboxes = new Map<string, FakeMailbox>();
  #nextId = 1;

  constructor(push: () => FakeGmailPush) {
    this.#push = push;
  }

  #mailbox(address: string): FakeMailbox {
    const key = address.toLowerCase();
    let box = this.#mailboxes.get(key);
    if (!box) {
      box = { historyId: HISTORY_START, watched: false, messages: [], pending: [] };
      this.#mailboxes.set(key, box);
    }
    return box;
  }

  #append(address: string, message: Omit<StoredMessage, 'historyId'>): void {
    const box = this.#mailbox(address);
    box.historyId += 1;
    box.messages.push({ ...message, historyId: box.historyId });
    if (box.watched) this.#push().publish(address.toLowerCase(), String(box.historyId));
  }

  /** 该邮箱是否已开始监听（watch） */
  isWatched(address: string): boolean {
    return this.#mailbox(address).watched;
  }

  /**
   * 一封邮件到达：发给几个店铺邮箱，每个邮箱各收到一份（Gmail 消息 ID 各不相同，Message-ID 相同），
   * 返回各邮箱里的 Gmail 消息 ID（与 to 同序）
   */
  deliver(mail: FakeMailInput): string[] {
    const recipients = recipientsOf(mail);
    const built = buildFakeMail(mail, `<fake-${this.#nextId}@mail.example.com>`);
    return recipients.map((address) => {
      const id = mail.gmailId && recipients.length === 1 ? mail.gmailId : this.#newId();
      this.#append(address, {
        id,
        threadId: id,
        labelIds: ['INBOX', 'UNREAD'],
        internalDate: built.internalDate,
        raw: built.raw,
      });
      return id;
    });
  }

  /** 同一封信在该邮箱的 history 里再出现一次（Gmail 与 Pub/Sub 都可能重复投递，E-15） */
  redeliver(address: string, messageId: string): void {
    const found = this.#mailbox(address).messages.find((m) => m.id === messageId);
    if (!found) throw new Error(`${address} 里没有 Gmail 消息 ${messageId}`);
    this.#append(address, found);
  }

  #newId(): string {
    return `fake${String(this.#nextId++).padStart(12, '0')}`;
  }

  client(): GmailClient {
    return {
      watch: async (mailbox) => {
        await this.faults.check('users.watch');
        const box = this.#mailbox(mailbox);
        const historyId = String(box.historyId);
        box.watched = true;
        // 回放的示例来信在开始监听之后送达
        const pending = box.pending;
        box.pending = [];
        for (const mail of pending) this.deliver(mail);
        // Gmail 的推送 7 天后到期，要每天续订（09）；Fake 没有时钟，到期时间只作展示，按到达的最后一封信推算
        const last = box.messages.at(-1)?.internalDate.getTime() ?? 0;
        return { historyId, expiration: new Date(last + WATCH_DAYS * 86_400_000) };
      },
      listHistory: async (mailbox, startHistoryId) => {
        await this.faults.check('users.history.list');
        const box = this.#mailbox(mailbox);
        const start = Number(startHistoryId);
        return {
          messageIds: box.messages.filter((m) => m.historyId > start).map((m) => m.id),
          historyId: String(Math.max(box.historyId, start)),
        };
      },
      getMessage: async (mailbox, messageId) => {
        await this.faults.check('users.messages.get');
        const found = this.#mailbox(mailbox).messages.find((m) => m.id === messageId);
        if (!found) {
          throw new ExternalCallFailedError('gmail', 'users.messages.get', { status: 404 });
        }
        return {
          id: found.id,
          threadId: found.threadId,
          labelIds: found.labelIds,
          internalDate: found.internalDate,
          raw: found.raw,
        };
      },
    };
  }

  reset(): void {
    this.#mailboxes.clear();
    this.#nextId = 1;
    this.faults.reset();
  }

  /** 从示例数据夹具回放来信：每个邮箱的来信按到达时间排好，等开始监听后送达（ADR 0009 修订） */
  replay(fixture: DemoFixture): void {
    const mails = fixtureMails(fixture).sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
    for (const mail of mails) {
      for (const address of recipientsOf(mail)) {
        const box = this.#mailbox(address);
        if (box.watched) this.deliver({ ...mail, to: address });
        else box.pending.push({ ...mail, to: address });
      }
    }
  }
}

/** Gmail 推送（全局，按 CLIENT_MODE_GMAIL_PUSH 选择） */
export const gmailPushClient = defineClient({
  system: 'gmail_push',
  scope: 'global',
  createReal: realGmailPush,
  createFake: () => new FakeGmailPush(),
});

/** Gmail 邮箱（店铺级，按店铺的数据来源选择） */
export const gmailClient = defineClient({
  system: 'gmail',
  scope: 'store',
  createReal: realGmail,
  createFake: ({ fake }) => new FakeGmail(() => fake(gmailPushClient)),
});
