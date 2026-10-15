import type { DemoFixture } from '@forcome/fixtures';
import type { Clock } from '../core';
import { defineClient, type FakeClient } from './definition';
import {
  ConnectionLostError,
  CursorExpiredError,
  FaultInjector,
  MailboxAccessError,
} from './faults';
import { fixtureMailsFor, replayShiftMs, shiftedMail, type ReplayMail } from './fixture-mails';
import { buildFakeMail, type FakeMailInput } from './gmail-mime';
import { createRealImap } from './imap-real';

export { findSentFolder } from './imap-real';

/*
 * 163 企业邮箱（网易企业邮箱）的 IMAP 收信（ADR 0015，规格「163 企业邮箱收信」，待办 35）：店铺级客户端，按店铺的数据来源选真实现或 Fake。
 * 只读：一律 EXAMINE 选中文件夹、BODY.PEEK[] 取原文，不置已读、不移动、不删除。只收收件箱与「已发送」两个文件夹：
 * - connect：用邮箱地址与客户端授权码登录（先发 IMAP ID，网易要求），找出「已发送」（LIST 的 \Sent 特殊用途标记，没有时按名字兜底）；
 * - 会话里按文件夹取此刻的 UIDVALIDITY 与 UIDNEXT（「开始监听」记下它）、取某个 UID 之后的信（增量）、按日期区间搜索（位置失效时的补拉、
 *   历史回放列清单）与按 UID 取信；位置失效（UIDVALIDITY 变了）抛 CursorExpiredError，调用方按到达时间区间补拉；
 * - idle：常驻连接在收件箱上 IDLE，有新信（EXISTS）时回调，连接断了以错误结束。
 * 访问不了邮箱抛 MailboxAccessError（授权码、登录 IP、连不上）或 ExternalTimeoutError；没保存授权码抛 ClientNotConfiguredError（未连接，不算失败）。
 * 真实现在 imap-real.ts（imapflow）；Fake 在下面，测试用 deliver / send / resetUidValidity 与故障注入（认证失败、IP 限制、连不上、超时、IDLE 掉线）。
 */

/** 同步的两个文件夹：收件箱（来信）与「已发送」（我方发出） */
export const imapFolderRoles = ['inbox', 'sent'] as const;
export type ImapFolderRole = (typeof imapFolderRoles)[number];

/** 要连的邮箱：地址（也是登录名）、IMAP 服务器与端口；authCode 给了用它（按行测试连接），不给用该地址已保存的 */
export interface ImapAccount {
  readonly address: string;
  readonly host: string;
  readonly port: number;
  readonly authCode?: string;
}

/** 文件夹此刻的位置：UIDVALIDITY（十进制字符串，最大 2^32−1）与下一封信的 UID */
export interface ImapPosition {
  readonly uidValidity: string;
  readonly uidNext: number;
}

/** 一封信的概要：UID 与到达时间（INTERNALDATE） */
export interface ImapMessageInfo {
  readonly uid: number;
  readonly internalDate: Date;
}

/** 一封信的原文（RFC 822，BODY.PEEK[]） */
export interface ImapRawMessage extends ImapMessageInfo {
  readonly size: number;
  readonly raw: Uint8Array;
}

/** 已登录的会话：用完要 close（真实现 LOGOUT） */
export interface ImapSession {
  /** 「已发送」文件夹的名字；找不到为 null（收件箱照收，测试连接报「找不到「已发送」文件夹」） */
  readonly sentFolder: string | null;
  /** 文件夹此刻的位置（EXAMINE）；「已发送」找不到时抛错，调用方先看 sentFolder */
  position(role: ImapFolderRole): Promise<ImapPosition>;
  /**
   * 某个 UID 之后到的信的 UID 与到达时间（UID FETCH <uid+1>:* 只取 INTERNALDATE，原文由调用方入库前逐封 fetch，不一次读进内存），
   * 按 UID 升序；文件夹的 UIDVALIDITY 已不是 uidValidity 时抛 CursorExpiredError（文件夹被重建、服务端迁移），调用方按到达时间区间补拉
   */
  fetchAfter(
    role: ImapFolderRole,
    from: { uidValidity: string; uid: number },
  ): Promise<ImapMessageInfo[]>;
  /**
   * 按日期搜索（SEARCH SINCE <since 那天> [BEFORE <before 那天的次日>]，IMAP 只到日期）后取到达时间，再按 [since, before) 精确筛，
   * 按 UID 升序；返回此刻的 UIDVALIDITY（之后按 UID 取信要对得上）
   */
  search(
    role: ImapFolderRole,
    range: { since: Date; before?: Date },
  ): Promise<{ uidValidity: string; messages: ImapMessageInfo[] }>;
  /** 按 UID 取信（已不存在的不返回）；UIDVALIDITY 已不是 uidValidity 时抛 CursorExpiredError */
  fetch(
    role: ImapFolderRole,
    uidValidity: string,
    uids: readonly number[],
  ): Promise<ImapRawMessage[]>;
  close(): Promise<void>;
}

/** 常驻连接：在收件箱上 IDLE */
export interface ImapIdle {
  /** 连接结束：close() 主动关时正常结束，断线、被踢时以错误结束 */
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

export interface ImapClient {
  /** 登录并找出「已发送」 */
  connect(account: ImapAccount): Promise<ImapSession>;
  /** 开一条常驻连接在收件箱上 IDLE，收件箱有新信（EXISTS）时调 onNewMail；登录失败照 connect 抛错 */
  idle(account: ImapAccount, onNewMail: () => void): Promise<ImapIdle>;
}

/** 服务商的消息标识（ADR 0015）：「文件夹角色 : UIDVALIDITY : UID」，例 inbox:1700000001:4521 */
export function imapMessageId(role: ImapFolderRole, uidValidity: string, uid: number): string {
  return `${role}:${uidValidity}:${uid}`;
}

// ---------------------------------------------------------------- Fake

interface FakeFolder {
  uidValidity: number;
  uidNext: number;
  messages: ImapRawMessage[];
}

interface FakeMailbox {
  readonly inbox: FakeFolder;
  /** 「已发送」的名字；null 为没有「已发送」（找不到的情形） */
  sentName: string | null;
  readonly sent: FakeFolder;
  /** 已开始监听（第一次取过位置）：回放的示例邮件在这之后送达 */
  listening: boolean;
  /** 回放的示例邮件（来信与「已发送」）：开始监听后才送达 */
  pending: ReplayMail[];
  /** 在收件箱上 IDLE 的常驻连接 */
  readonly idles: Set<FakeIdle>;
  /** 一直登录不上（授权码错、IP 受限、连不上）：直到 acceptLogin */
  rejected: MailboxAccessError['reason'] | null;
}

interface FakeIdle {
  readonly onNewMail: () => void;
  readonly end: (error?: Error) => void;
}

/**
 * Fake IMAP 的约定写法（Playwright 与开发测试环境的冒烟在另一个进程里，注入不了故障，经 P18 的输入触发）：按行测试或保存时填这几个
 * 授权码之一为登录失败、登录被拒；IMAP 服务器以 .invalid 结尾（保留的顶级域，不会是真服务器）为连不上
 */
export const FAKE_IMAP_REJECTED_AUTH_CODES: Readonly<Record<string, MailboxAccessError['reason']>> =
  {
    'fake-auth-failed': 'auth_failed',
    'fake-ip-denied': 'login_denied_ip',
  };

/** 示例与测试邮箱的 UIDVALIDITY 从这里起算（真实服务器多为建文件夹的时刻） */
const UID_VALIDITY_START = 1_700_000_001;

function emptyFolder(uidValidity: number): FakeFolder {
  return { uidValidity, uidNext: 1, messages: [] };
}

/** 按日期搜索时 IMAP 只看日期（服务器时区，这里按 UTC）：SINCE 那天 0 点起、BEFORE 那天 0 点前 */
function dayStart(at: Date): number {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

/**
 * Fake IMAP：按邮箱存收件箱与「已发送」，维护 UIDVALIDITY 与 UID。测试用 deliver（来信落进收件箱）、send（我方发出，落进「已发送」）、
 * redeliver（同一封再出现一次）、resetUidValidity（文件夹重建：UID 从头编、UIDVALIDITY 换新）、removeSentFolder（找不到「已发送」）、
 * rejectLogin / acceptLogin（之后一直登录不上，直到恢复）、dropIdle（IDLE 掉线），一次性的故障用 faults（操作名 connect、position、
 * fetchAfter、search、fetch、idle）。进程启动时从示例数据夹具回放服务商为 163 企业邮箱的邮箱的来信，开始监听后送达。
 * 不校验授权码的内容（示例店铺存的是模拟授权码）
 */
export class FakeImap implements FakeClient<ImapClient> {
  readonly faults = new FaultInjector('qiye163');
  readonly #clock: Clock;
  readonly #mailboxes = new Map<string, FakeMailbox>();
  #nextId = 1;
  #nextValidity = UID_VALIDITY_START;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  #mailbox(address: string): FakeMailbox {
    const key = address.toLowerCase();
    let box = this.#mailboxes.get(key);
    if (!box) {
      box = {
        inbox: emptyFolder(this.#nextValidity++),
        sentName: '已发送',
        sent: emptyFolder(this.#nextValidity++),
        listening: false,
        pending: [],
        idles: new Set(),
        rejected: null,
      };
      this.#mailboxes.set(key, box);
    }
    return box;
  }

  #append(address: string, role: ImapFolderRole, built: { internalDate: Date; raw: Uint8Array }) {
    const box = this.#mailbox(address);
    const folder = box[role];
    const uid = folder.uidNext++;
    folder.messages.push({
      uid,
      internalDate: built.internalDate,
      size: built.raw.length,
      raw: built.raw,
    });
    if (role === 'inbox') for (const idle of box.idles) idle.onNewMail();
    return uid;
  }

  /**
   * 一封来信到达：发给几个店铺邮箱时每个邮箱的收件箱各一份（Message-ID 相同），返回各自的 UID（与收件人同序）。
   * 给了 mailbox 时只落在那一个邮箱（寄到它的别名或转发地址）；Delivered-To 同 Fake Gmail（见 FakeMailInput.deliveredTo）
   */
  deliver(mail: FakeMailInput): number[] {
    const recipients = mail.mailbox
      ? [mail.mailbox]
      : typeof mail.to === 'string'
        ? [mail.to]
        : [...mail.to];
    const messageId = `<fake-imap-${this.#nextId++}@mail.example.com>`;
    return recipients.map((address) =>
      this.#append(
        address,
        'inbox',
        buildFakeMail(mail, messageId, mail.deliveredTo === undefined ? address : mail.deliveredTo),
      ),
    );
  }

  /** 店铺邮箱发出一封信，落在它的「已发送」里（from 是店铺邮箱，to 是客户）；返回 UID */
  send(mail: Omit<FakeMailInput, 'from' | 'to'> & { from: string; to: string }): number {
    const built = buildFakeMail(
      { ...mail, from: { address: mail.from }, to: mail.to },
      `<fake-imap-${this.#nextId++}@forcome.example>`,
    );
    return this.#append(mail.from, 'sent', built);
  }

  /** 同一封信在同一个文件夹里再出现一次（新的 UID，原文相同；例如被复制回来） */
  redeliver(address: string, role: ImapFolderRole, uid: number): number {
    const found = this.#mailbox(address)[role].messages.find((m) => m.uid === uid);
    if (!found) throw new Error(`${address} 的 ${role} 里没有 UID ${uid}`);
    return this.#append(address, role, found);
  }

  /** 文件夹重建（UIDVALIDITY 变化）：信还在，UID 从 1 重新编，UIDVALIDITY 换新 */
  resetUidValidity(address: string, role: ImapFolderRole): void {
    const folder = this.#mailbox(address)[role];
    folder.uidValidity = this.#nextValidity++;
    folder.uidNext = 1;
    folder.messages = folder.messages.map((m) => ({ ...m, uid: folder.uidNext++ }));
  }

  /**
   * 让这个文件夹接上库里的游标：UIDVALIDITY 取游标的，之后到的信的 UID 排在游标之后（Fake 的 UID 进程重启就从头编，开发测试环境的库
   * 却记着上一个进程的游标，新到的信 UID 比游标小，增量同步取不到。之后投信前先接上库里的游标，待办 24 的验收夹具用，同 Fake Gmail 的
   * continueHistoryFrom）
   */
  continueFrom(
    address: string,
    role: ImapFolderRole,
    cursor: { uidValidity: string; uid: number },
  ): void {
    const folder = this.#mailbox(address)[role];
    if (String(folder.uidValidity) === cursor.uidValidity) {
      folder.uidNext = Math.max(folder.uidNext, cursor.uid + 1);
      return;
    }
    // 已在本进程里的信（还没送达过库）排到游标之后，重复的由入库去重兜住
    let next = cursor.uid + 1;
    folder.uidValidity = Number(cursor.uidValidity);
    folder.messages = folder.messages.map((m) => ({ ...m, uid: next++ }));
    folder.uidNext = next;
  }

  /** 「已发送」找不到（网易里改了名字又没有特殊用途标记）；restoreSentFolder 恢复 */
  removeSentFolder(address: string): void {
    this.#mailbox(address).sentName = null;
  }

  restoreSentFolder(address: string, name = '已发送'): void {
    this.#mailbox(address).sentName = name;
  }

  /** 之后登录这个邮箱一直失败（授权码被重新生成、登录 IP 受限、服务器连不上），直到 acceptLogin */
  rejectLogin(address: string, reason: MailboxAccessError['reason'] = 'auth_failed'): void {
    this.#mailbox(address).rejected = reason;
  }

  acceptLogin(address: string): void {
    this.#mailbox(address).rejected = null;
  }

  /** IDLE 掉线：这个邮箱的常驻连接以断线结束 */
  dropIdle(address: string): void {
    const box = this.#mailbox(address);
    for (const idle of [...box.idles]) idle.end(new ConnectionLostError('qiye163', 'idle'));
  }

  /** 这个邮箱现在有几条常驻连接在 IDLE */
  idleConnections(address: string): number {
    return this.#mailbox(address).idles.size;
  }

  /** 已开始监听（第一次取过位置） */
  isListening(address: string): boolean {
    return this.#mailbox(address).listening;
  }

  async #login(account: ImapAccount, operation: string): Promise<FakeMailbox> {
    await this.faults.check(operation);
    const box = this.#mailbox(account.address);
    const rejected =
      box.rejected ??
      (account.authCode ? FAKE_IMAP_REJECTED_AUTH_CODES[account.authCode] : undefined) ??
      (account.host.endsWith('.invalid') ? 'unreachable' : undefined);
    if (rejected) throw new MailboxAccessError('qiye163', operation, rejected);
    return box;
  }

  /**
   * 开始监听：取过位置的会话关闭时（「开始监听」先取两个文件夹的位置、记下来再关会话），回放的示例邮件才送达，
   * 都排在记下的位置之后（同 Fake Gmail 的 watch）
   */
  #startListening(box: FakeMailbox): void {
    if (box.listening) return;
    box.listening = true;
    const pending = box.pending;
    box.pending = [];
    for (const entry of pending) this.#replayOne(entry);
  }

  #folder(box: FakeMailbox, role: ImapFolderRole, operation: string): FakeFolder {
    if (role === 'sent' && box.sentName === null) {
      throw new Error(`qiye163 ${operation}：没有「已发送」文件夹`);
    }
    return box[role];
  }

  client(): ImapClient {
    return {
      connect: async (account) => {
        const box = await this.#login(account, 'connect');
        let positioned = false;
        const session: ImapSession = {
          sentFolder: box.sentName,
          position: async (role) => {
            await this.faults.check('position');
            const folder = this.#folder(box, role, 'position');
            positioned = true;
            return { uidValidity: String(folder.uidValidity), uidNext: folder.uidNext };
          },
          fetchAfter: async (role, from) => {
            await this.faults.check('fetchAfter');
            const folder = this.#folder(box, role, 'fetchAfter');
            if (String(folder.uidValidity) !== from.uidValidity) {
              throw new CursorExpiredError('qiye163', 'fetchAfter');
            }
            return folder.messages
              .filter((m) => m.uid > from.uid)
              .map((m) => ({ uid: m.uid, internalDate: m.internalDate }));
          },
          search: async (role, { since, before }) => {
            await this.faults.check('search');
            const folder = this.#folder(box, role, 'search');
            const from = dayStart(since);
            const until = before ? dayStart(before) + 86_400_000 : Infinity;
            return {
              uidValidity: String(folder.uidValidity),
              messages: folder.messages
                .filter((m) => m.internalDate.getTime() >= from && m.internalDate.getTime() < until)
                .filter(
                  (m) =>
                    m.internalDate.getTime() >= since.getTime() &&
                    (!before || m.internalDate.getTime() < before.getTime()),
                )
                .map((m) => ({ uid: m.uid, internalDate: m.internalDate })),
            };
          },
          fetch: async (role, uidValidity, uids) => {
            await this.faults.check('fetch');
            const folder = this.#folder(box, role, 'fetch');
            if (String(folder.uidValidity) !== uidValidity) {
              throw new CursorExpiredError('qiye163', 'fetch');
            }
            const wanted = new Set(uids);
            return folder.messages.filter((m) => wanted.has(m.uid));
          },
          close: () => {
            if (positioned) this.#startListening(box);
            return Promise.resolve();
          },
        };
        return session;
      },
      idle: async (account, onNewMail) => {
        const box = await this.#login(account, 'idle');
        let end!: (error?: Error) => void;
        const closed = new Promise<void>((resolve, reject) => {
          end = (error) => {
            box.idles.delete(idle);
            if (error) reject(error);
            else resolve();
          };
        });
        // 没人等的时候断线也不要变成未处理的拒绝
        closed.catch(() => undefined);
        const idle: FakeIdle = { onNewMail, end };
        box.idles.add(idle);
        return { closed, close: () => Promise.resolve(end()) };
      },
    };
  }

  reset(): void {
    for (const box of this.#mailboxes.values()) {
      for (const idle of [...box.idles]) idle.end();
    }
    this.#mailboxes.clear();
    this.#nextId = 1;
    this.#nextValidity = UID_VALIDITY_START;
    this.faults.reset();
  }

  /** 回放的一封：来信落进收件箱（寄到别名的落在它所属的邮箱），我方邮件放进发件邮箱的「已发送」 */
  #replayOne({ mailbox, sent, mail }: ReplayMail): void {
    if (sent) {
      const to = typeof mail.to === 'string' ? mail.to : mail.to[0]!;
      this.send({ ...mail, from: mailbox, to });
    } else {
      this.deliver(mail.mailbox ? mail : { ...mail, to: mailbox });
    }
  }

  /**
   * 从示例数据夹具回放服务商为 163 企业邮箱的邮箱的来信与我方回复（同 Fake Gmail：按时间排好、整天平移到当前日期），
   * 每个邮箱的邮件等开始监听后送达
   */
  replay(fixture: DemoFixture): void {
    const shift = replayShiftMs(fixture, this.#clock.now());
    const mails = fixtureMailsFor(fixture, 'qiye163')
      .map((entry) => ({ ...entry, mail: shiftedMail(entry.mail, shift) }))
      .sort((a, b) => new Date(a.mail.at).getTime() - new Date(b.mail.at).getTime());
    for (const entry of mails) {
      const box = this.#mailbox(entry.mailbox);
      if (box.listening) this.#replayOne(entry);
      else box.pending.push(entry);
    }
  }
}

/** 163 企业邮箱（店铺级，按店铺的数据来源选择；系统名 qiye163 同服务商的取值） */
export const imapClient = defineClient({
  system: 'qiye163',
  scope: 'store',
  createReal: createRealImap,
  createFake: ({ clock }) => new FakeImap(clock),
});
