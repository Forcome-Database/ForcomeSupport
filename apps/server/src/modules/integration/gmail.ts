import type { DemoFixture } from '@forcome/fixtures';
import { toMilliseconds, type Clock } from '../core';
import { defineClient, type FakeClient } from './definition';
import { ExternalCallFailedError, FaultInjector } from './faults';
import { buildFakeMail, type FakeMailInput } from './gmail-mime';
import { createRealGmail, createRealGmailPush } from './gmail-real';
import { fixtureMails, type ReplayMail } from './gmail-replay';

/*
 * Gmail（规格 channel「Gmail 客户端」、ADR 0008 修订；待办 08 是最小形态，09 补健壮性）：
 * - 邮箱（店铺级，gmail）：watch 建立推送并给出增量游标 historyId；history.list 取游标之后新到的消息；
 *   messages.get 取原始邮件（RFC 822）。真实现与 Fake 是同一个接口；
 * - 推送（全局，gmail_push）：Gmail 把「某邮箱有变化」发到 Pub/Sub 主题，worker 从本环境的订阅 pull 后确认。
 *   推送是环境级的（一个订阅服务全部邮箱），所以与按店铺选择的邮箱客户端分开，按 CLIENT_MODE_GMAIL_PUSH 选择；
 *   Fake 邮箱在被 watch 后把通知发进同一进程的 Fake 推送。
 * 真实现（gmail-real.ts，待办 09）：服务账号 + 全域委派以各邮箱身份调 Gmail REST 接口、Pub/Sub 用 REST 的一元 pull，
 * 都经出站 HTTP 客户端工厂（代理、限流、调用记录）。没配置 Google 凭据时调用以「未配置」失败，生产环境不会悄悄退回 Fake。
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
  /** 邮箱此刻的增量游标（users.getProfile 的 historyId）：游标过期补拉前取新游标，「测试连接」也用它探邮箱能不能访问 */
  profile(mailbox: string): Promise<{ historyId: string }>;
  /**
   * 游标之后新到的消息（users.history.list，historyTypes=messageAdded，分页在实现里取完）；
   * 返回新游标。游标过期（404）抛 CursorExpiredError，调用方改按 internalDate 区间补拉（listMessages）
   */
  listHistory(
    mailbox: string,
    startHistoryId: string,
  ): Promise<{ messageIds: string[]; historyId: string }>;
  /**
   * 某个时刻之后到达的全部消息（users.messages.list，q=after:<秒>，不按标签过滤、不含垃圾邮件与已删除，分页在实现里取完）：
   * 游标过期后的区间补拉用
   */
  listMessages(mailbox: string, range: { after: Date }): Promise<string[]>;
  /** 一封邮件的原文（users.messages.get，format=raw）；邮件已不存在（404）抛带状态码 404 的 ExternalCallFailedError */
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

// ---------------------------------------------------------------- Fake

interface StoredMessage extends GmailRawMessage {
  readonly historyId: number;
}

interface FakeMailbox {
  /** 当前的 historyId；每到一封信加 1 */
  historyId: number;
  watched: boolean;
  readonly messages: StoredMessage[];
  /** 回放的示例邮件（来信与「已发送」）：开始监听后才送达（演示环境里它们是系统上线后到达的邮件） */
  pending: ReplayMail[];
}

/** 不在收信范围里的标签（同 Gmail 的 messages.list 默认：不含垃圾邮件与已删除） */
const EXCLUDED_FROM_LIST = new Set(['SPAM', 'TRASH']);

function recipientsOf(mail: FakeMailInput): readonly string[] {
  return typeof mail.to === 'string' ? [mail.to] : mail.to;
}

/** 邮箱的 historyId 从这里起算（Gmail 的 historyId 是不透明的递增数字） */
const HISTORY_START = 1000;
/** Gmail 推送的有效期 */
const WATCH_DAYS = 7;

const DAY_MS = toMilliseconds({ days: 1 });

/**
 * 示例邮件平移几天（待办 16）：夹具的时间在 9 月的演示时刻附近，开发测试环境与 Playwright 用真实时钟，原样回放的话
 * 时限扫描一上来就把它们按 7 天、14 天关闭（与归并交错时还会重开、另建工单）。回放时按整天平移到当前日期：
 * 演示时刻落在「现在」之前不到一天，时分不变（北京时间没有夏令时），原型画面的状态在当下重现，之后照规则随时间推进。
 * 时钟在演示时刻（本机截图的 CLOCK_START、集成测试）或更早时不平移
 */
function replayShiftMs(fixture: DemoFixture, now: Date): number {
  const ahead = now.getTime() - new Date(fixture.meta.now).getTime();
  return ahead > 0 ? Math.floor(ahead / DAY_MS) * DAY_MS : 0;
}

function shifted(mail: FakeMailInput, ms: number): FakeMailInput {
  return ms === 0 ? mail : { ...mail, at: new Date(new Date(mail.at).getTime() + ms) };
}

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
  readonly #clock: Clock;
  readonly #mailboxes = new Map<string, FakeMailbox>();
  #nextId = 1;

  constructor(push: () => FakeGmailPush, clock: Clock) {
    this.#push = push;
    this.#clock = clock;
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

  /**
   * 让这个邮箱之后到的信的 historyId 排在 historyId 之后（Fake 的历史号从 HISTORY_START 起数，进程重启就从头数；开发测试环境的库
   * 却记着上一个进程的游标，新到的信历史号比游标小，增量同步取不到。之后投信前先接上库里的游标，待办 24 的验收夹具用）
   */
  continueHistoryFrom(address: string, historyId: number): void {
    const box = this.#mailbox(address);
    box.historyId = Math.max(box.historyId, historyId);
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
   * 返回各邮箱里的 Gmail 消息 ID（与 to 同序）。给了 mailbox 时只落在那一个邮箱（寄到它的别名或转发地址）。
   * 每一份像真实 Gmail 一样在最上面写 Delivered-To（实际投递到的地址，见 FakeMailInput.deliveredTo）
   */
  deliver(mail: FakeMailInput): string[] {
    const recipients = mail.mailbox ? [mail.mailbox] : recipientsOf(mail);
    const messageId = `<fake-${this.#nextId}@mail.example.com>`;
    return recipients.map((address) => {
      const built = buildFakeMail(
        mail,
        messageId,
        mail.deliveredTo === undefined ? address : mail.deliveredTo,
      );
      const id = mail.gmailId && recipients.length === 1 ? mail.gmailId : this.#newId();
      this.#append(address, {
        id,
        threadId: (recipients.length === 1 && mail.threadId) || id,
        labelIds: ['INBOX', 'UNREAD'],
        internalDate: built.internalDate,
        raw: built.raw,
      });
      return id;
    });
  }

  /**
   * 店铺邮箱发出一封信（Gmail 标签 SENT，落在发件邮箱的「已发送」里）：from 是店铺邮箱，to 是客户；返回 Gmail 消息 ID。
   * 收件人里有别的店铺邮箱时，它们照常各收到一份来信（deliver）
   */
  send(mail: Omit<FakeMailInput, 'from' | 'to'> & { from: string; to: string }): string {
    const built = buildFakeMail(
      { ...mail, from: { address: mail.from }, to: mail.to },
      `<fake-${this.#nextId}@forcome.example>`,
    );
    const id = mail.gmailId ?? this.#newId();
    this.#append(mail.from, {
      id,
      threadId: mail.threadId ?? id,
      labelIds: ['SENT'],
      internalDate: built.internalDate,
      raw: built.raw,
    });
    return id;
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
        // 回放的示例邮件在开始监听之后送达
        const pending = box.pending;
        box.pending = [];
        for (const entry of pending) this.#replayOne(entry);
        // Gmail 的推送 7 天后到期，要每天续订（09）；Fake 没有时钟，到期时间只作展示，按到达的最后一封信推算
        const last = box.messages.at(-1)?.internalDate.getTime() ?? 0;
        return { historyId, expiration: new Date(last + WATCH_DAYS * 86_400_000) };
      },
      profile: async (mailbox) => {
        await this.faults.check('users.getProfile');
        return { historyId: String(this.#mailbox(mailbox).historyId) };
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
      listMessages: async (mailbox, { after }) => {
        await this.faults.check('users.messages.list');
        const seen = new Set<string>();
        return this.#mailbox(mailbox)
          .messages.filter(
            (m) =>
              m.internalDate.getTime() >= after.getTime() &&
              !m.labelIds.some((label) => EXCLUDED_FROM_LIST.has(label)) &&
              !seen.has(m.id) &&
              seen.add(m.id),
          )
          .map((m) => m.id);
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

  /** 回放的一封：来信送到店铺邮箱（寄到别名的落在它所属的邮箱，mail.mailbox），我方邮件放进发件邮箱的「已发送」 */
  #replayOne({ mailbox, sent, mail }: ReplayMail): void {
    if (sent) {
      this.send({ ...mail, from: mailbox, to: recipientsOf(mail)[0]! });
    } else {
      this.deliver(mail.mailbox ? mail : { ...mail, to: mailbox });
    }
  }

  /**
   * 从示例数据夹具回放来信与我方回复（ADR 0009 修订）：按时间排好、整天平移到当前日期（replayShiftMs），
   * 每个邮箱的邮件等开始监听后送达
   */
  replay(fixture: DemoFixture): void {
    const shift = replayShiftMs(fixture, this.#clock.now());
    const mails = fixtureMails(fixture)
      .map((entry) => ({ ...entry, mail: shifted(entry.mail, shift) }))
      .sort((a, b) => new Date(a.mail.at).getTime() - new Date(b.mail.at).getTime());
    for (const entry of mails) {
      const box = this.#mailbox(entry.mailbox);
      if (box.watched) this.#replayOne(entry);
      else box.pending.push(entry);
    }
  }
}

/** Gmail 推送（全局，按 CLIENT_MODE_GMAIL_PUSH 选择） */
export const gmailPushClient = defineClient({
  system: 'gmail_push',
  scope: 'global',
  createReal: createRealGmailPush,
  createFake: () => new FakeGmailPush(),
});

/** Gmail 邮箱（店铺级，按店铺的数据来源选择） */
export const gmailClient = defineClient({
  system: 'gmail',
  scope: 'store',
  createReal: createRealGmail,
  createFake: ({ fake, clock }) => new FakeGmail(() => fake(gmailPushClient), clock),
});
