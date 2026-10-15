import {
  imapServerErrors,
  mailboxError,
  mailboxTestFailureMessage,
  mailboxTestMessages,
  normalizeImapPort,
  normalizeMailbox,
  qiyeMailboxMessages,
  type AdapterMode,
  type FieldErrors,
  type MailboxTestFailureReason,
  type MailboxTestInput,
  type MessageDirection,
} from '@forcome/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import PostalMime, { type Email } from 'postal-mime';
import { z } from 'zod';
import {
  defineFeed,
  defineJob,
  FieldValidationError,
  transaction,
  type AppEnv,
  type Feed,
  type JobContext,
  type Logger,
  type Runtime,
} from '../core';
import {
  ClientNotConfiguredError,
  CursorExpiredError,
  ExternalServiceError,
  ExternalTimeoutError,
  imapClient,
  imapMessageId,
  MailboxAccessError,
  savedMailboxAuthCodes,
  type ImapAccount,
  type ImapClient,
  type ImapFolderRole,
  type ImapIdle,
  type ImapMessageInfo,
  type ImapRawMessage,
  type ImapSession,
  type IntegrationClients,
} from '../integration';
import { liveMailOpen } from './mail-cutover';
import {
  firstMailbox,
  ingestMessage,
  isStored,
  mailboxTarget,
  mailboxTargets,
  messageIdOf,
  noteFailure,
  SyncedMailTally,
  type MailboxTarget,
  type MailOutcome,
} from './mail-ingest';
import { mailboxHealths, recordMailboxSuccess } from './mailbox-health';
import type { SenderRule } from './recognition';
import { mailboxSync, message, store, storeMailbox, type ImapCursor } from './schema';
import { reusesSavedAuthCode } from './stores';
import { loadSenderRules } from './sender-rules';

/*
 * 163 企业邮箱的收信（ADR 0015，规格「163 企业邮箱收信」，待办 35）：经 IMAP 取信，取到的原文走 mail-ingest.ts 与 Gmail 同一段入库路径。
 * 1. 开始监听：第一次记下收件箱与「已发送」的 UIDVALIDITY 与 UIDNEXT（IMAP 游标，写 watched_at），之后到的信都在增量里
 *    （之前的由历史回放导入，待办 26 的 T0 口径同 Gmail）；常驻拉取对还没开始监听的 163 企业邮箱自动开始，失败按退避再试；
 * 2. 常驻拉取 channel.imap_idle（独占：多个 worker 时咨询锁选主）：给每个已开始监听的 163 企业邮箱开一条 IMAP 连接在收件箱上 IDLE，
 *    收到新信（EXISTS）就排一次该邮箱的同步；连接断了按 1 分钟起翻倍、最多 30 分钟重连，断开后重连成功不算连接失败，重连上先同步一次；
 *    登录失败照 6.9 计数，其中授权码错、客户端登录被关、登录 IP 受限（要管理员处理）不在常驻连接里连环重试，只靠每 5 分钟的轮询再试
 *    （网易对连续登录失败可能锁定账号），等管理员在 P18 改了服务器、端口或授权码（立即重连）或轮询同步成功后再开；
 * 3. 定时任务 channel.imap_poll：每 5 分钟给每个已开始监听的 163 企业邮箱排一次同步——「已发送」不另开 IDLE（我方回复最多约 5 分钟后被识别，
 *    首次回复时长按 INTERNALDATE 算、不受影响），也是 IDLE 不可用或掉线时的兜底，让没有新信的邮箱「最近同步成功」照样前进；
 * 4. 任务 channel.imap_sync：两个文件夹各取游标之后的信（UID FETCH，INTERNALDATE + 原文），按到达时间先后逐封入库，全部入库后在一个事务里
 *    推进两组游标（比较旧值、只往前）并记同步成功（synced_through 取列清单之前的时刻）——水位只在持久化成功后推进；
 * 5. UIDVALIDITY 变了（文件夹重建、服务端迁移）等同 Gmail 的游标过期：先记下两个文件夹此刻的新位置，再从上次同步成功前 1 小时起按到达时间
 *    区间补拉（SEARCH SINCE 只到日期，取回后按 INTERNALDATE 再筛），全部入库后才换上新游标；补拉完成前「最近同步成功」不前移；
 * 6. 去重：「邮箱 + 服务商消息标识（inbox:UIDVALIDITY:UID）」唯一；UIDVALIDITY 变了以后同一封信的标识也变了，所以入库前另按
 *    「同一邮箱 + 方向 + Message-ID」（没有 Message-ID 时按「到达时间 + 发件人 + 主题」）认出已收过的信，跳过；
 * 7. 找不到「已发送」：收件箱照收、记同步成功，只记警告日志（不计连接失败、不出横幅）；之后找到了从那时起收「已发送」；
 * 8. 上线切换完成前（mail-cutover.ts）同步什么也不做——不登录、不记成败，常驻连接也不开（同 Gmail）；没保存授权码（或主密钥换了解不开）
 *    为「未连接」，不登录、不算失败。
 * 测试连接：渠道卡测全部 163 企业邮箱（同 Gmail 的 connection-tests，testImapConnection），店铺抽屉按行测（testMailboxRow，不保存）。
 */

/** 同 Gmail：每个 worker 同时同步几个 163 企业邮箱（同一邮箱仍由 stately + singletonKey 保证只跑一个） */
export const IMAP_SYNC_CONCURRENCY = 5;

/**
 * 同步一个 163 企业邮箱：每个邮箱最多一个在排队、一个在跑（stately）。连不上、超时等可重试的失败照 Gmail 60 秒起翻倍重试；
 * 认证失败与 IP 受限不重试（任务记失败后正常结束），等下一次轮询
 */
export const imapSyncJob = defineJob(
  'channel.imap_sync',
  z.object({ mailbox: z.string() }),
  { policy: 'stately', retryLimit: 5, retryDelay: 60, retryBackoff: true },
  undefined,
  IMAP_SYNC_CONCURRENCY,
);

/** 每 5 分钟给每个已开始监听的 163 企业邮箱排一次同步（「已发送」与 IDLE 的兜底）；worker 启动时也一次 */
export const imapPollJob = defineJob(
  'channel.imap_poll',
  z.object({}),
  { policy: 'stately', retryLimit: 0 },
  { cron: '*/5 * * * *', tz: 'Asia/Shanghai', runAtStartup: true },
);

/** 按店铺的数据来源取 163 企业邮箱的客户端 */
export function imapFor(clients: IntegrationClients, target: MailboxTarget): ImapClient {
  return clients.forStore(imapClient, { id: target.storeId, adapterMode: target.adapterMode });
}

/** 要连的邮箱：地址、登记的 IMAP 服务器与端口（授权码由真实现按地址读已保存的） */
export function accountOf(target: MailboxTarget): ImapAccount {
  if (!target.imapHost || !target.imapPort) {
    throw new Error(`${target.address} 不是 163 企业邮箱或没有登记 IMAP 服务器`);
  }
  return { address: target.address, host: target.imapHost, port: target.imapPort };
}

/** 要管理员处理的错误（授权码、客户端登录、登录 IP）：不连环重试 */
function needsAdmin(error: unknown): boolean {
  return error instanceof MailboxAccessError && error.needsAdmin;
}

/** 用完关掉会话；关的时候出错不盖掉原来的结果 */
async function withSession<T>(
  imap: ImapClient,
  account: ImapAccount,
  run: (session: ImapSession) => Promise<T>,
): Promise<T> {
  const session = await imap.connect(account);
  try {
    return await run(session);
  } finally {
    await session.close().catch(() => undefined);
  }
}

/** 两个文件夹此刻的位置写成游标（已收到 UIDNEXT − 1）；找不到「已发送」时它为空 */
async function currentCursor(session: ImapSession): Promise<ImapCursor> {
  const inbox = await session.position('inbox');
  const sent = session.sentFolder ? await session.position('sent') : null;
  return {
    inbox: { uidValidity: inbox.uidValidity, uid: inbox.uidNext - 1 },
    sent: sent ? { uidValidity: sent.uidValidity, uid: sent.uidNext - 1 } : null,
    sentFolder: session.sentFolder,
  };
}

/**
 * 开始监听一个 163 企业邮箱：记下两个文件夹此刻的位置作为 IMAP 游标（已有游标就不动它）与第一次的时刻（watched_at，历史回放的 T0
 * 不能早于它），并立即排一次同步（切换完成前同步不入库）。失败照常抛出
 */
export async function startListening(
  runtime: Runtime,
  imap: ImapClient,
  target: MailboxTarget,
  logger: Logger,
): Promise<ImapCursor> {
  const cursor = await withSession(imap, accountOf(target), currentCursor);
  if (!cursor.sentFolder) {
    logger.warn({ mailbox: target.address }, '找不到「已发送」文件夹：先只收收件箱（ADR 0015）');
  }
  await transaction(runtime, async (tx) => {
    const [existing] = await tx.db
      .select({ imapCursor: mailboxSync.imapCursor })
      .from(mailboxSync)
      .where(eq(mailboxSync.address, target.address))
      .for('update');
    if (existing?.imapCursor) return;
    await tx.db
      .insert(mailboxSync)
      .values({
        address: target.address,
        imapCursor: cursor,
        watchedAt: tx.now,
        createdAt: tx.now,
        updatedAt: tx.now,
      })
      .onConflictDoUpdate({
        target: mailboxSync.address,
        set: {
          imapCursor: cursor,
          watchedAt: tx.now,
          updatedAt: tx.now,
        },
      });
    await tx.enqueue(imapSyncJob, { mailbox: target.address }, { singletonKey: target.address });
  });
  logger.info({ mailbox: target.address, cursor }, '163 企业邮箱已开始监听');
  return cursor;
}

/** 开始监听或常驻连接失败后多久再试：1 分钟起翻倍，最多 30 分钟 */
const RETRY_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;

function retryDelay(failures: number): number {
  return Math.min(RETRY_MS * 2 ** (failures - 1), RETRY_MAX_MS);
}

/** 每 5 分钟：给每个已开始监听的 163 企业邮箱排一次同步 */
export async function pollImapMailboxes(runtime: Runtime, logger: Logger): Promise<void> {
  const targets = await mailboxTargets(runtime.db, { provider: 'qiye163', watched: true });
  await transaction(runtime, async (tx) => {
    for (const target of targets) {
      await tx.enqueue(imapSyncJob, { mailbox: target.address }, { singletonKey: target.address });
    }
  });
  logger.debug({ mailboxes: targets.length }, '已排同步（163 企业邮箱每 5 分钟检查）');
}

/**
 * 一封要入库的信：从哪个文件夹（决定方向与消息标识）、UID 与到达时间；原文到入库前才取（load），已入库的不取，
 * 长时间断线后一次取到几千封也不会把原文都读进内存
 */
export interface ImapMailRef {
  readonly role: ImapFolderRole;
  readonly uidValidity: string;
  readonly uid: number;
  readonly internalDate: Date;
  /** 取原文；已不在服务端（期间被删）为 null */
  readonly load: () => Promise<ImapRawMessage | null>;
}

/** 会话里按 UID 取一封的原文 */
function refsOf(
  session: ImapSession,
  role: ImapFolderRole,
  uidValidity: string,
  messages: readonly ImapMessageInfo[],
): ImapMailRef[] {
  return messages.map((m) => ({
    role,
    uidValidity,
    uid: m.uid,
    internalDate: m.internalDate,
    load: async () => (await session.fetch(role, uidValidity, [m.uid]))[0] ?? null,
  }));
}

const DIRECTION: Record<ImapFolderRole, MessageDirection> = {
  inbox: 'inbound',
  sent: 'outbound',
};

/**
 * UIDVALIDITY 变了以后重新取到的同一封信（ADR 0015）：同一邮箱、同方向里 Message-ID 相同的信已经入库；没有 Message-ID 的按
 * 「到达时间 + 发件人 + 主题」（库里不存大小，ADR 的摘要去掉了大小这一项）
 */
async function receivedBefore(
  runtime: Runtime,
  address: string,
  direction: MessageDirection,
  parsed: Email,
  internalDate: Date,
): Promise<boolean> {
  const rfcMessageId = messageIdOf(parsed.messageId);
  const [found] = await runtime.db
    .select({ id: message.id })
    .from(message)
    .where(
      and(
        eq(message.mailbox, address),
        eq(message.direction, direction),
        rfcMessageId
          ? eq(message.rfcMessageId, rfcMessageId)
          : and(
              isNull(message.rfcMessageId),
              eq(message.receivedAt, internalDate),
              eq(message.fromAddress, firstMailbox(parsed.from).address),
              eq(message.subject, parsed.subject?.trim() ?? ''),
            ),
      ),
    )
    .limit(1);
  return found !== undefined;
}

/** 一封 IMAP 取到的信入库（实时同步、区间补拉与历史回放共用）：收件箱为来信，「已发送」为我方发出 */
export async function ingestImapMail(
  runtime: Runtime,
  target: MailboxTarget,
  rules: readonly SenderRule[],
  mail: ImapMailRef,
  logger: Logger,
): Promise<MailOutcome> {
  const providerMessageId = imapMessageId(mail.role, mail.uidValidity, mail.uid);
  if (await isStored(runtime.db, target.address, providerMessageId)) {
    logger.info({ mailbox: target.address, providerMessageId }, '重复消息，已丢弃（E-15）');
    return { result: 'stored' };
  }
  const raw = await mail.load();
  if (!raw) {
    logger.info({ mailbox: target.address, providerMessageId }, '邮件已不存在，跳过');
    return { result: 'gone' };
  }
  const direction = DIRECTION[mail.role];
  const parsed = await PostalMime.parse(raw.raw);
  if (await receivedBefore(runtime, target.address, direction, parsed, raw.internalDate)) {
    logger.info(
      { mailbox: target.address, providerMessageId },
      '同一封信已经收过（UIDVALIDITY 变化后重新取到），跳过',
    );
    return { result: 'stored' };
  }
  const result = await ingestMessage(
    runtime,
    target,
    rules,
    { providerMessageId, threadId: null, internalDate: raw.internalDate },
    parsed,
    direction,
    logger,
  );
  return { result, direction, internalDate: raw.internalDate };
}

/** 逐封入库（按到达时间先后，同一时刻收件箱在前），返回这次新入库的来信 */
async function ingestAll(
  runtime: Runtime,
  target: MailboxTarget,
  mails: readonly ImapMailRef[],
  logger: Logger,
) {
  const rules = await loadSenderRules(runtime.db);
  const tally = new SyncedMailTally();
  const ordered = [...mails].sort(
    (a, b) =>
      a.internalDate.getTime() - b.internalDate.getTime() ||
      (a.role === b.role ? a.uid - b.uid : a.role === 'inbox' ? -1 : 1),
  );
  for (const mail of ordered) tally.add(await ingestImapMail(runtime, target, rules, mail, logger));
  return tally.synced;
}

/** 位置失效后从上次成功同步前多久起补拉（同 Gmail：INTERNALDATE 与同步时刻有先后差，多拉一段由去重兜住） */
const BACKFILL_MARGIN_MS = 60 * 60_000;

interface ImapSyncState {
  readonly imapCursor: ImapCursor;
  readonly lastSuccessAt: Date | null;
  readonly createdAt: Date;
  readonly backfillFrom: Date | null;
  readonly imapBackfillCursor: ImapCursor | null;
}

/** 补拉期间又遇到 UIDVALIDITY 变化：重新记位置再补一次也没补成，不算连接失败（任务稍后重试） */
class BackfillRestartedError extends Error {
  override name = 'BackfillRestartedError';
}

/**
 * UIDVALIDITY 变了：先记下两个文件夹此刻的新位置（补拉期间新到的信之后照常经增量取到），记下补拉区间的起点
 * （上次成功同步前 1 小时；从没成功过取开始监听的时刻；已在补拉的沿用原来的起点），之后由 backfill 补拉
 */
async function startBackfill(
  runtime: Runtime,
  session: ImapSession,
  target: MailboxTarget,
  state: ImapSyncState,
  logger: Logger,
): Promise<{ from: Date; cursor: ImapCursor }> {
  const cursor = await currentCursor(session);
  const from =
    state.backfillFrom ??
    new Date((state.lastSuccessAt ?? state.createdAt).getTime() - BACKFILL_MARGIN_MS);
  await runtime.db
    .update(mailboxSync)
    .set({ backfillFrom: from, imapBackfillCursor: cursor, updatedAt: runtime.clock.now() })
    .where(eq(mailboxSync.address, target.address));
  logger.warn(
    { mailbox: target.address, from, cursor },
    'UIDVALIDITY 变了，按到达时间区间补拉（ADR 0015）',
  );
  return { from, cursor };
}

/**
 * 区间补拉：UIDVALIDITY 变了的文件夹按日期搜索起点之后到达的信（只取新游标之前的 UID，之后的留给增量）；没变的文件夹照常按旧游标取增量，
 * 免得漏掉 UID 在游标之后、到达时间却早于起点的信（例如客户端离线后补存进「已发送」的回信）。逐封入库，全部完成后才换上新游标、
 * 清掉补拉记录并记同步成功。补拉中途 UIDVALIDITY 又变了：重新记下位置再补一次
 */
async function backfill(
  runtime: Runtime,
  session: ImapSession,
  target: MailboxTarget,
  state: ImapSyncState,
  range: { from: Date; cursor: ImapCursor },
  logger: Logger,
  retried = false,
): Promise<void> {
  const listedAt = runtime.clock.now();
  const mails: ImapMailRef[] = [];
  const cursor = { ...range.cursor };
  try {
    for (const role of ['inbox', 'sent'] as const) {
      const expected = range.cursor[role];
      if (!expected || (role === 'sent' && session.sentFolder !== range.cursor.sentFolder)) {
        continue;
      }
      const old = state.imapCursor[role];
      const sameFolder =
        role === 'inbox' || state.imapCursor.sentFolder === range.cursor.sentFolder;
      if (old && sameFolder && old.uidValidity === expected.uidValidity) {
        const found = await session.fetchAfter(role, old);
        mails.push(...refsOf(session, role, old.uidValidity, found));
        cursor[role] = {
          uidValidity: old.uidValidity,
          uid: Math.max(expected.uid, old.uid, ...found.map((m) => m.uid)),
        };
        continue;
      }
      const found = await session.search(role, { since: range.from });
      if (found.uidValidity !== expected.uidValidity) {
        throw new CursorExpiredError('qiye163', `search:${role}`);
      }
      const messages = found.messages.filter((m) => m.uid <= expected.uid);
      mails.push(...refsOf(session, role, found.uidValidity, messages));
    }
  } catch (error) {
    if (!(error instanceof CursorExpiredError)) throw error;
    if (retried) throw new BackfillRestartedError('补拉期间 UIDVALIDITY 又变了，稍后重试');
    const again = await startBackfill(
      runtime,
      session,
      target,
      { ...state, backfillFrom: range.from },
      logger,
    );
    await backfill(runtime, session, target, state, again, logger, true);
    return;
  }
  const synced = await ingestAll(runtime, target, mails, logger);
  await transaction(runtime, async (tx) => {
    await tx.db
      .update(mailboxSync)
      .set({ imapCursor: cursor, backfillFrom: null, imapBackfillCursor: null, updatedAt: tx.now })
      .where(eq(mailboxSync.address, target.address));
    await recordMailboxSuccess(tx, target.address, 'qiye163', synced, listedAt);
  });
  logger.info({ mailbox: target.address, messages: mails.length }, '区间补拉完成');
}

/** 游标只往前走：同一个 UIDVALIDITY 取较大的 UID */
function forward(
  before: ImapCursor['inbox'] | null,
  after: ImapCursor['inbox'] | null,
): ImapCursor['inbox'] | null {
  if (!before || !after || before.uidValidity !== after.uidValidity) return after;
  return after.uid >= before.uid ? after : before;
}

/**
 * 同步一个 163 企业邮箱（见文件头 4–8）：两个文件夹各取游标之后的信，按到达时间入库，全部成功后推进游标并记同步成功；
 * 中途失败则任务重试（已入库的按去重跳过）。外部调用失败记进同步记录（连续 3 次为连接异常）
 */
export async function syncImapMailbox(
  clients: IntegrationClients,
  appEnv: AppEnv,
  { mailbox }: { mailbox: string },
  { runtime, logger }: JobContext,
): Promise<void> {
  const address = mailbox.toLowerCase();
  if (!(await liveMailOpen(runtime.db, appEnv))) {
    logger.debug({ mailbox: address }, '上线切换还没完成，不实时收信（待办 26）');
    return;
  }
  const target = await mailboxTarget(runtime.db, address);
  if (!target || target.provider !== 'qiye163') {
    logger.info({ mailbox: address }, '已不是登记的 163 企业邮箱，跳过');
    return;
  }
  const [row] = await runtime.db
    .select({
      imapCursor: mailboxSync.imapCursor,
      lastSuccessAt: mailboxSync.lastSuccessAt,
      createdAt: mailboxSync.createdAt,
      backfillFrom: mailboxSync.backfillFrom,
      imapBackfillCursor: mailboxSync.imapBackfillCursor,
    })
    .from(mailboxSync)
    .where(eq(mailboxSync.address, address))
    .limit(1);
  if (!row?.imapCursor) {
    logger.warn({ mailbox: address }, '还没有开始监听，等常驻拉取记下位置后再同步');
    return;
  }
  const state: ImapSyncState = { ...row, imapCursor: row.imapCursor };
  try {
    await withSession(imapFor(clients, target), accountOf(target), async (session) => {
      // 上次补拉没完成：接着补（补拉完成前不按旧游标增量取）
      if (state.backfillFrom && state.imapBackfillCursor) {
        await backfill(
          runtime,
          session,
          target,
          state,
          { from: state.backfillFrom, cursor: state.imapBackfillCursor },
          logger,
        );
        return;
      }
      const listedAt = runtime.clock.now();
      const before = state.imapCursor;
      const mails: ImapMailRef[] = [];
      let sent = before.sent;
      let sentFolder = before.sentFolder;
      try {
        const inbox = await session.fetchAfter('inbox', before.inbox);
        mails.push(...refsOf(session, 'inbox', before.inbox.uidValidity, inbox));
        if (!session.sentFolder) {
          logger.warn(
            { mailbox: address },
            '找不到「已发送」文件夹：收件箱照收，我方回复暂时收不到（ADR 0015）',
          );
        } else if (!before.sent || before.sentFolder !== session.sentFolder) {
          // 刚找到「已发送」（或换了名字）：从此刻起收，之前的不补（同新加的邮箱）
          const position = await session.position('sent');
          sent = { uidValidity: position.uidValidity, uid: position.uidNext - 1 };
          sentFolder = session.sentFolder;
          logger.info({ mailbox: address, sentFolder }, '找到「已发送」文件夹，从此刻起收');
        } else {
          const sentMails = await session.fetchAfter('sent', before.sent);
          mails.push(...refsOf(session, 'sent', before.sent.uidValidity, sentMails));
        }
      } catch (error) {
        if (!(error instanceof CursorExpiredError)) throw error;
        const range = await startBackfill(runtime, session, target, state, logger);
        await backfill(runtime, session, target, state, range, logger);
        return;
      }
      const synced = await ingestAll(runtime, target, mails, logger);
      const maxUid = (role: ImapFolderRole) =>
        Math.max(-1, ...mails.filter((m) => m.role === role).map((m) => m.uid));
      const next: ImapCursor = {
        inbox: forward(before.inbox, {
          uidValidity: before.inbox.uidValidity,
          uid: Math.max(before.inbox.uid, maxUid('inbox')),
        })!,
        sent:
          sent && before.sent && sent.uidValidity === before.sent.uidValidity
            ? forward(before.sent, { ...sent, uid: Math.max(sent.uid, maxUid('sent')) })
            : sent,
        sentFolder,
      };
      await transaction(runtime, async (tx) => {
        // 比较旧值再写：游标在这期间被改过（服务商改了、同步记录被重置）就不记这次同步成功，下一次重新取
        const advanced = await tx.db
          .update(mailboxSync)
          .set({ imapCursor: next, updatedAt: tx.now })
          .where(and(eq(mailboxSync.address, address), eq(mailboxSync.imapCursor, before)))
          .returning({ id: mailboxSync.id });
        if (advanced.length === 0) {
          logger.warn({ mailbox: address }, '同步期间游标被改过，这次不记同步成功');
          return;
        }
        await recordMailboxSuccess(tx, address, 'qiye163', synced, listedAt);
      });
    });
  } catch (error) {
    if (error instanceof ClientNotConfiguredError) {
      // 没保存授权码（或主密钥换了解不开）：未连接，不算失败，等管理员在 P18 填写
      logger.debug({ err: error, mailbox: address }, '没有可用的客户端授权码，不同步');
      return;
    }
    // 补拉期间 UIDVALIDITY 接连变化不是连接问题：不记失败，任务稍后重试
    if (!(error instanceof BackfillRestartedError))
      await noteFailure(runtime, target, error, logger);
    // 授权码错、客户端登录被关、登录 IP 受限：不按任务重试连环登录，等下一次轮询
    if (needsAdmin(error)) return;
    throw error;
  }
}

/** 一个 163 企业邮箱的常驻连接的状态（worker 进程内） */
interface IdleConnection {
  /** 服务器、端口、授权码与数据来源：变了就重连 */
  key: string;
  idle: ImapIdle | null;
  /** 正在连 */
  opening: boolean;
  /** 连续连不上或掉线了几次（按它退避；重连成功清零） */
  failures: number;
  retryAt: number;
  /** 要管理员处理的错误停下了重连的时刻；之后配置变了或轮询同步成功才再连 */
  stoppedAt: Date | null;
}

/** 开始监听失败的邮箱：下次再试的时刻（配置变了立即重试） */
type ListenRetries = Map<string, { readonly key: string; failures: number; retryAt: number }>;

/** 常驻连接的配置指纹：服务器、端口、授权码最近一次填写的时刻、数据来源 */
function configKey(target: MailboxTarget, savedAt: Date | undefined): string {
  return [target.imapHost, target.imapPort, savedAt?.getTime() ?? '', target.adapterMode].join('|');
}

/**
 * 常驻拉取：163 企业邮箱的 IDLE 常驻连接 → 有新信的邮箱排同步。独占（ADR 0008）：多个 worker 时只有拿到咨询锁的那个开连接。
 * 每次拉取先给还没开始监听的邮箱开始监听，再按当前的邮箱与配置开、关、重连各条常驻连接，最后把有新信的邮箱排同步
 * （测试的「跑完任务」每轮拉一次、不等待；worker 里最多等 waitSeconds 秒新信）
 */
export function createImapIdleFeed(clients: IntegrationClients, appEnv: AppEnv): Feed {
  const connections = new Map<string, IdleConnection>();
  const listenRetries: ListenRetries = new Map();
  const signaled = new Set<string>();
  let wake: (() => void) | null = null;

  const signal = (address: string) => {
    signaled.add(address);
    wake?.();
  };

  async function close(address: string): Promise<void> {
    const connection = connections.get(address);
    connections.delete(address);
    await connection?.idle?.close().catch(() => undefined);
  }

  async function ensureListening(runtime: Runtime, logger: Logger, saved: Map<string, Date>) {
    const now = runtime.clock.now().getTime();
    for (const target of await mailboxTargets(runtime.db, {
      provider: 'qiye163',
      watched: false,
    })) {
      const key = configKey(target, saved.get(target.address));
      const retry = listenRetries.get(target.address);
      if (retry && retry.key === key && retry.retryAt > now) continue;
      try {
        await startListening(runtime, imapFor(clients, target), target, logger);
        listenRetries.delete(target.address);
      } catch (error) {
        const failures = retry && retry.key === key ? retry.failures + 1 : 1;
        const delay = retryDelay(failures);
        listenRetries.set(target.address, { key, failures, retryAt: now + delay });
        const level = error instanceof ClientNotConfiguredError ? 'debug' : 'warn';
        logger[level](
          { err: error, mailbox: target.address, failures, retryInMs: delay },
          '163 企业邮箱开始监听失败，稍后重试',
        );
        await noteFailure(runtime, target, error, logger);
      }
    }
  }

  async function open(
    runtime: Runtime,
    logger: Logger,
    target: MailboxTarget,
    connection: IdleConnection,
  ): Promise<void> {
    connection.opening = true;
    try {
      const idle = await imapFor(clients, target).idle(accountOf(target), () =>
        signal(target.address),
      );
      connection.idle = idle;
      connection.failures = 0;
      connection.stoppedAt = null;
      // 连上（或重连上）先同步一次：断开期间到的信不等下一次轮询
      signal(target.address);
      idle.closed.then(
        () => undefined,
        (error: unknown) => {
          if (connections.get(target.address) !== connection) return;
          connection.idle = null;
          connection.failures += 1;
          connection.retryAt = runtime.clock.now().getTime() + retryDelay(connection.failures);
          logger.warn(
            { err: error, mailbox: target.address, failures: connection.failures },
            '163 企业邮箱常驻连接断开，稍后重连（不算连接失败）',
          );
        },
      );
    } catch (error) {
      connection.failures += 1;
      connection.retryAt = runtime.clock.now().getTime() + retryDelay(connection.failures);
      if (error instanceof ClientNotConfiguredError) {
        logger.debug({ mailbox: target.address }, '没有可用的客户端授权码，不开常驻连接');
      } else {
        await noteFailure(runtime, target, error, logger);
        if (needsAdmin(error)) {
          connection.stoppedAt = runtime.clock.now();
          logger.warn(
            { err: error, mailbox: target.address },
            '163 企业邮箱登录被拒：停下常驻连接，只靠每 5 分钟检查，等管理员处理',
          );
        }
      }
    } finally {
      connection.opening = false;
    }
  }

  async function reconcile(runtime: Runtime, logger: Logger, saved: Map<string, Date>) {
    const targets = await mailboxTargets(runtime.db, { provider: 'qiye163', watched: true });
    const wanted = new Map(targets.map((target) => [target.address, target]));
    for (const address of [...connections.keys()]) {
      if (!wanted.has(address)) await close(address);
    }
    const healths = new Map(
      (await mailboxHealths(runtime.db)).map((health) => [health.address, health]),
    );
    const now = runtime.clock.now();
    for (const target of targets) {
      const key = configKey(target, saved.get(target.address));
      let connection = connections.get(target.address);
      if (connection && connection.key !== key) {
        // 管理员改了服务器、端口、授权码或数据来源：立即重连
        await close(target.address);
        connection = undefined;
      }
      if (!connection) {
        connection = { key, idle: null, opening: false, failures: 0, retryAt: 0, stoppedAt: null };
        connections.set(target.address, connection);
      }
      if (connection.idle || connection.opening) continue;
      if (connection.stoppedAt) {
        // 轮询同步成功了（管理员在网易后台处理好了）：恢复常驻连接
        const lastSuccess = healths.get(target.address)?.lastSuccessAt;
        if (!lastSuccess || lastSuccess <= connection.stoppedAt) continue;
        connection.stoppedAt = null;
        connection.failures = 0;
        connection.retryAt = 0;
      }
      if (connection.retryAt > now.getTime()) continue;
      await open(runtime, logger, target, connection);
    }
  }

  return defineFeed(
    'channel.imap_idle',
    async ({ runtime, logger, waitSeconds, signal: abort }) => {
      const saved = await savedMailboxAuthCodes(runtime.db);
      // 开始监听在上线切换前就要做（T0 前启动监听，同 Gmail 的 watch，待办 26）；常驻连接等切换完成才开（之前同步不入库）
      await ensureListening(runtime, logger, saved);
      if (await liveMailOpen(runtime.db, appEnv)) {
        await reconcile(runtime, logger, saved);
      } else {
        for (const address of [...connections.keys()]) await close(address);
        signaled.clear();
        return 0;
      }
      if (signaled.size === 0 && waitSeconds > 0) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            abort.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, waitSeconds * 1000);
          wake = done;
          abort.addEventListener('abort', done, { once: true });
        });
        wake = null;
      }
      if (signaled.size === 0) return 0;
      const mailboxes = [...signaled];
      signaled.clear();
      await transaction(runtime, async (tx) => {
        for (const mailbox of mailboxes) {
          await tx.enqueue(imapSyncJob, { mailbox }, { singletonKey: mailbox });
        }
      });
      return mailboxes.length;
    },
    {
      exclusive: true,
      release: async () => {
        for (const address of [...connections.keys()]) await close(address);
        listenRetries.clear();
        signaled.clear();
      },
    },
  );
}

/**
 * 渠道卡的「测试连接」（K20，PRD P18 第一阶段）：逐个 163 企业邮箱登录、看收件箱与「已发送」能否访问；不改连接状态（状态只看同步记录）。
 * 还没开始监听的当场开始监听（「重新检测」立即重测并补拉，不用等常驻拉取的退避），测完给每个已开始监听的邮箱排一次同步。
 * 找不到「已发送」也算访问不了（按行测试会写明原因）
 */
export async function testImapConnection(
  runtime: Runtime,
  clients: IntegrationClients,
  logger: Logger,
): Promise<{ reachable: string[]; unreachable: string[] }> {
  const unwatched = new Set(
    (await mailboxTargets(runtime.db, { provider: 'qiye163', watched: false })).map(
      (target) => target.address,
    ),
  );
  const reachable: string[] = [];
  const unreachable: string[] = [];
  for (const target of await mailboxTargets(runtime.db, { provider: 'qiye163' })) {
    const imap = imapFor(clients, target);
    try {
      const sentFolder = unwatched.has(target.address)
        ? (await startListening(runtime, imap, target, logger)).sentFolder
        : await withSession(imap, accountOf(target), async (session) => {
            await session.position('inbox');
            if (session.sentFolder) await session.position('sent');
            return session.sentFolder;
          });
      if (sentFolder) reachable.push(target.address);
      else unreachable.push(target.address);
    } catch (error) {
      logger.warn({ err: error, mailbox: target.address }, '测试连接：163 企业邮箱无法访问');
      unreachable.push(target.address);
    }
  }
  await pollImapMailboxes(runtime, logger);
  return { reachable, unreachable };
}

/** 按行测试的结果：通过（「已发送」的名字）或没通过（原因） */
export type MailboxRowTestOutcome =
  | {
      readonly ok: true;
      readonly address: string;
      readonly sentFolder: string;
      readonly message: string;
    }
  | { readonly ok: false; readonly reason: MailboxTestFailureReason; readonly message: string };

/** 同一个地址同时只跑一个测试（连续登录失败可能让网易锁定账号）：后来的等前一个测完再测 */
const runningTests = new Map<string, Promise<unknown>>();

function serialized<T>(address: string, run: () => Promise<T>): Promise<T> {
  const previous = runningTests.get(address) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  runningTests.set(address, next);
  void next
    .catch(() => undefined)
    .finally(() => {
      if (runningTests.get(address) === next) runningTests.delete(address);
    });
  return next;
}

/** 失败原因（只认外部调用的错误；其余照常抛出） */
function failureReason(error: unknown): MailboxTestFailureReason | null {
  if (error instanceof MailboxAccessError) return error.reason;
  if (error instanceof ExternalTimeoutError) return 'timeout';
  if (error instanceof ExternalServiceError && !(error instanceof ClientNotConfiguredError)) {
    return 'unreachable';
  }
  return null;
}

/**
 * 店铺抽屉里按行「测试连接」（K8，PRD P18，D-28）：用这一行当前填的地址、服务器、端口与授权码登录，看收件箱与「已发送」能否访问。
 * 不保存、不记同步记录、不改连接状态。没带授权码时用该地址已保存的——只认 storeId 给出的店铺里这个地址已登记为 163 企业邮箱、保存过、
 * 服务器与端口也没改的（新店铺、新加的行、从 Gmail 改来的、改了服务器或端口的都要带，reusesSavedAuthCode）。填错（地址、服务器、端口、授权码）抛 FieldValidationError（接口 400）。
 * 数据来源：生产环境一律真实接口；其余按抽屉当前的选择，不给时按店铺，新店铺为模拟数据
 */
export async function testMailboxRow(
  runtime: Runtime,
  clients: IntegrationClients,
  appEnv: AppEnv,
  input: MailboxTestInput,
  logger: Logger,
): Promise<MailboxRowTestOutcome> {
  const address = normalizeMailbox(input.address);
  const host = input.imapHost.trim().toLowerCase();
  const port = normalizeImapPort(input.imapPort);
  const authCode = input.authCode?.trim() || undefined;
  const errors: FieldErrors = {};
  const addressError = mailboxError(address, []);
  if (addressError) errors.address = addressError;
  Object.assign(errors, imapServerErrors({ imapHost: host, imapPort: port }));
  const [storeRow] = input.storeId
    ? await runtime.db
        .select({ adapterMode: store.adapterMode })
        .from(store)
        .where(eq(store.id, input.storeId))
        .limit(1)
    : [];
  const [owner] = input.storeId
    ? await runtime.db
        .select({
          provider: storeMailbox.provider,
          imapHost: storeMailbox.imapHost,
          imapPort: storeMailbox.imapPort,
        })
        .from(storeMailbox)
        .where(and(eq(storeMailbox.storeId, input.storeId), eq(storeMailbox.address, address)))
        .limit(1)
    : [];
  // 沿用已保存的授权码只限这一行的地址、服务器、端口都没改（同保存时的规则，免得把授权码发到别的主机）
  const savedUsable = reusesSavedAuthCode(
    owner,
    { imapHost: host, imapPort: port },
    (await savedMailboxAuthCodes(runtime.db, [address])).has(address),
  );
  if (!authCode && !savedUsable) errors.authCode = qiyeMailboxMessages.authCodeMissing;
  if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);
  const adapterMode: AdapterMode =
    appEnv === 'production' ? 'real' : (input.adapterMode ?? storeRow?.adapterMode ?? 'fake');
  const imap = clients.forStore(imapClient, { id: input.storeId ?? null, adapterMode });
  const account: ImapAccount = {
    address,
    host,
    port: port as number,
    ...(authCode ? { authCode } : {}),
  };
  return serialized(address, async () => {
    try {
      const sentFolder = await withSession(imap, account, async (session) => {
        await session.position('inbox');
        if (session.sentFolder) await session.position('sent');
        return session.sentFolder;
      });
      if (!sentFolder) {
        return {
          ok: false,
          reason: 'no_sent_folder',
          message: mailboxTestFailureMessage('no_sent_folder', host, port as number),
        };
      }
      return { ok: true, address, sentFolder, message: mailboxTestMessages.ok };
    } catch (error) {
      if (error instanceof ClientNotConfiguredError) {
        // 保存过的授权码解不开（主密钥换了）：同没有保存，要重新填写
        throw new FieldValidationError({ authCode: qiyeMailboxMessages.authCodeMissing });
      }
      const reason = failureReason(error);
      if (!reason) throw error;
      logger.info({ err: error, mailbox: address, reason }, '按行测试连接：没通过');
      return {
        ok: false,
        reason,
        message: mailboxTestFailureMessage(reason, host, port as number),
      };
    }
  });
}
