import {
  isArchivedSource,
  type AdapterMode,
  type MessageDirection,
  type Platform,
  type Site,
} from '@forcome/contracts';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import PostalMime, { type Address, type Email } from 'postal-mime';
import { z } from 'zod';
import {
  advisoryLock,
  defineFeed,
  defineJob,
  transaction,
  type DbExecutor,
  type Feed,
  type JobContext,
  type Logger,
  type Runtime,
  type Tx,
} from '../core';
import {
  ClientNotConfiguredError,
  CursorExpiredError,
  ExternalCallFailedError,
  ExternalServiceError,
  gmailClient,
  gmailPushClient,
  type GmailClient,
  type GmailRawMessage,
  type IntegrationClients,
} from '../integration';
import { recordMailboxFailure, recordMailboxSuccess, type SyncedMail } from './mailbox-health';
import { recognizeInbound, type MailAddress, type SenderRule } from './recognition';
import { mailboxSync, message, store, storeMailbox } from './schema';
import { loadSenderRules } from './sender-rules';

/*
 * 收信（规格 channel「Gmail 客户端」「去重」，ADR 0008 修订；待办 08 是最小形态，09 补健壮性）：
 * 1. 常驻拉取 channel.gmail_push（独占：多个 worker 时咨询锁选主）：先确保每个进线邮箱已 watch（没有游标的先 watch，
 *    建立增量游标并立即排一次同步），再从 Pub/Sub 拉通知，按邮箱排「同步邮箱」任务，任务入队后才确认通知；
 * 2. 定时任务 channel.gmail_poll：每 5 分钟给每个已 watch 的邮箱排一次同步（history.list 兜底：推送丢了、推送接的是另一类店铺、
 *    以及让「最近同步成功的时间」在没有新信时也前进）；channel.gmail_renew_watch：每天续订 watch（不按标签过滤，7 天到期）；
 * 3. 任务 channel.gmail_sync：history.list 取游标之后新到的消息，逐封取原文、解析、入库（去重），全部入库后才推进游标并记同步成功
 *    （水位只在持久化成功后推进）。来信入库时识别渠道、站点、来源与客户渠道身份（recognition.ts，待办 10），新入库、不是别处已收过、
 *    来源也不是平台通知或营销的，在同一事务里发出「来信已接收」；「已发送」里我方发出的信入库、方向为我方，同一事务里发出
 *    「我方发信已同步」（ticket 据此识别回复，16）；
 * 4. 游标过期（history.list 404）：先取邮箱此刻的新游标，再按 internalDate 从上次成功同步前 1 小时起全量补拉，全部入库后才换上新游标；
 *    补拉中途失败下次接着补，补拉完成前「最近同步成功的时间」不前移（报表的「更新于」不谎报新鲜度）；
 * 5. 外部调用失败记进同步记录（mailbox-health.ts）：连续 3 次为连接异常（通知、审计、全站横幅），之后同步成功即恢复并补拉。
 * 收件地址识别不出店铺的未归属队列随 15。
 */

/** 同步一个邮箱：每个邮箱最多一个在排队、一个在跑（stately），通知再多也不会堆积 */
/**
 * 每个 worker 同时同步几个邮箱（同一邮箱仍由 stately + singletonKey 保证只跑一个）：邮箱多时（开发测试环境累积了几十个
 * 冒烟店铺的邮箱）逐个同步要排很久，重放来信后几分钟都同步不完（待办 14 部署冒烟发现，同订单同步，ADR 0008 修订）
 */
export const GMAIL_SYNC_CONCURRENCY = 5;

export const gmailSyncJob = defineJob(
  'channel.gmail_sync',
  z.object({ mailbox: z.string() }),
  {
    policy: 'stately',
    retryLimit: 5,
    // 每次重试都算一次失败：60 秒起翻倍，持续约 3 分钟的故障才满 3 次（转连接异常）
    retryDelay: 60,
    retryBackoff: true,
  },
  undefined,
  GMAIL_SYNC_CONCURRENCY,
);

/** 每 5 分钟给每个已 watch 的邮箱排一次同步（history.list 兜底，ADR 0008）；worker 启动时也一次 */
export const gmailPollJob = defineJob(
  'channel.gmail_poll',
  z.object({}),
  { policy: 'stately', retryLimit: 0 },
  { cron: '*/5 * * * *', tz: 'Asia/Shanghai', runAtStartup: true },
);

/** 每天续订各邮箱的 watch（Gmail 推送 7 天到期；不按标签过滤，收件箱与「已发送」都推送）；失败 30 分钟后再试 */
export const gmailRenewWatchJob = defineJob(
  'channel.gmail_renew_watch',
  z.object({}),
  { policy: 'stately', retryLimit: 3, retryDelay: 30 * 60 },
  { cron: '0 3 * * *', tz: 'Asia/Shanghai' },
);

/**
 * 领域事件「来信已接收」：一封来信入库（不是别的邮箱已收过的同一封信，来源也不是归档的平台通知与营销），
 * ticket 据此归并成工单
 */
export const inboundReceivedJob = defineJob(
  'channel.inbound_received',
  z.object({ messageId: z.uuid() }),
  { retryLimit: 5, retryDelay: 10, retryBackoff: true },
);

/**
 * 领域事件「我方发信已同步」：店铺邮箱「已发送」里的一封我方邮件入库（不是别的邮箱已收过的同一封），
 * ticket 据此按 In-Reply-To、References、Gmail 线程把它归到工单（回复识别，R-SL-08，待办 16）
 */
export const outboundSyncedJob = defineJob(
  'channel.outbound_synced',
  z.object({ messageId: z.uuid() }),
  { retryLimit: 5, retryDelay: 10, retryBackoff: true },
);

/** 一个进线邮箱与它所属的店铺（按店铺的数据来源取 Gmail 客户端） */
interface MailboxTarget {
  readonly address: string;
  readonly storeId: string;
  readonly adapterMode: AdapterMode;
  readonly platform: Platform;
  readonly defaultSite: Site;
}

const mailboxTargetColumns = {
  address: storeMailbox.address,
  storeId: store.id,
  adapterMode: store.adapterMode,
  platform: store.platform,
  defaultSite: store.defaultSite,
};

/** 进线邮箱与所属店铺（按地址排序）：可只取某个地址，或只取已 watch（有游标）/ 还没 watch 的 */
async function mailboxTargets(
  db: DbExecutor,
  filter: { readonly address?: string; readonly watched?: boolean } = {},
): Promise<MailboxTarget[]> {
  const watched =
    filter.watched === undefined
      ? undefined
      : filter.watched
        ? isNotNull(mailboxSync.historyId)
        : isNull(mailboxSync.historyId);
  return db
    .select(mailboxTargetColumns)
    .from(storeMailbox)
    .innerJoin(store, eq(store.id, storeMailbox.storeId))
    .leftJoin(mailboxSync, eq(mailboxSync.address, storeMailbox.address))
    .where(and(filter.address ? eq(storeMailbox.address, filter.address) : undefined, watched))
    .orderBy(storeMailbox.address);
}

async function mailboxTarget(db: DbExecutor, address: string): Promise<MailboxTarget | null> {
  return (await mailboxTargets(db, { address }))[0] ?? null;
}

function gmailFor(clients: IntegrationClients, target: MailboxTarget): GmailClient {
  return clients.forStore(gmailClient, { id: target.storeId, adapterMode: target.adapterMode });
}

/**
 * 外部调用的失败记进同步记录（连续 3 次为连接异常）。我们自己的错误不算；没配置凭据也不算（还没接通，6.9 的「未连接」）。
 * 记录本身出错只记日志，不盖掉原来的错误（调用方照常抛原错误）
 */
async function noteFailure(
  runtime: Runtime,
  address: string,
  error: unknown,
  logger: Logger,
): Promise<void> {
  if (!(error instanceof ExternalServiceError) || error instanceof ClientNotConfiguredError) {
    return;
  }
  try {
    const failures = await recordMailboxFailure(runtime, address, error);
    logger.warn({ err: error, mailbox: address, failures }, 'Gmail 调用失败，已记入同步记录');
  } catch (recordError) {
    logger.error({ err: recordError, mailbox: address }, '记同步失败时出错');
  }
}

/** 开始监听失败后多久再试：1 分钟起翻倍，最多 30 分钟（每次失败都记进同步记录，连续 3 次为连接异常） */
const WATCH_RETRY_MS = 60_000;
const WATCH_RETRY_MAX_MS = 30 * 60_000;

/** 开始监听失败的邮箱与下次重试的时刻（进程内，worker 重启后立即重试） */
type WatchRetries = Map<string, { readonly failures: number; readonly retryAt: number }>;

/**
 * 还没有增量游标的进线邮箱先 watch：watch 返回此刻的 historyId 作为游标，之后到的信才同步进来
 * （之前的历史邮件由历史回放导入，26），并立即排一次同步（记下第一次同步成功的时间）。
 * 一个邮箱失败只影响它自己：记进同步记录、按退避稍后再试。
 */
async function ensureWatches(
  runtime: Runtime,
  clients: IntegrationClients,
  logger: Logger,
  retries: WatchRetries,
): Promise<void> {
  for (const target of await mailboxTargets(runtime.db, { watched: false })) {
    const retry = retries.get(target.address);
    if (retry && retry.retryAt > runtime.clock.now().getTime()) continue;
    try {
      await startWatching(runtime, gmailFor(clients, target), target, logger);
      retries.delete(target.address);
    } catch (error) {
      const failures = (retry?.failures ?? 0) + 1;
      const delay = Math.min(WATCH_RETRY_MS * 2 ** (failures - 1), WATCH_RETRY_MAX_MS);
      retries.set(target.address, { failures, retryAt: runtime.clock.now().getTime() + delay });
      // 没配置 Google 凭据（生产上线初期，Gmail 为未连接）：不是故障，只记调试日志
      const level = error instanceof ClientNotConfiguredError ? 'debug' : 'warn';
      logger[level](
        { err: error, mailbox: target.address, failures, retryInMs: delay },
        '邮箱开始监听失败，稍后重试',
      );
      await noteFailure(runtime, target.address, error, logger);
    }
  }
}

/** 给一个邮箱 watch：写下游标与推送到期时间，并立即排一次同步。watch 失败照常抛出 */
async function startWatching(
  runtime: Runtime,
  gmail: GmailClient,
  target: MailboxTarget,
  logger: Logger,
): Promise<void> {
  const watch = await gmail.watch(target.address);
  await transaction(runtime, async (tx) => {
    await tx.db
      .insert(mailboxSync)
      .values({
        address: target.address,
        historyId: watch.historyId,
        watchExpiresAt: watch.expiration,
        createdAt: tx.now,
        updatedAt: tx.now,
      })
      .onConflictDoUpdate({
        target: mailboxSync.address,
        // 已有游标就不动它（续订不能跳过还没同步的消息）
        set: {
          historyId: sql`coalesce(${mailboxSync.historyId}, excluded.history_id)`,
          watchExpiresAt: sql`excluded.watch_expires_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    await tx.enqueue(gmailSyncJob, { mailbox: target.address }, { singletonKey: target.address });
  });
  logger.info({ mailbox: target.address, historyId: watch.historyId }, '邮箱已开始监听');
}

/**
 * 常驻拉取：Gmail 推送（Pub/Sub）→ 按邮箱排同步任务。独占（ADR 0008）：多个 worker 时只有拿到咨询锁的那个拉，
 * 免得几个 worker 同时给新邮箱 watch
 */
export function createGmailPushFeed(clients: IntegrationClients): Feed {
  const watchRetries: WatchRetries = new Map();
  let reportedNotConfigured = false;
  return defineFeed(
    'channel.gmail_push',
    async ({ runtime, logger, waitSeconds }) => {
      await ensureWatches(runtime, clients, logger, watchRetries);
      const push = clients.global(gmailPushClient);
      let notifications: Awaited<ReturnType<typeof push.pull>>;
      try {
        notifications = await push.pull({ maxMessages: 100, waitSeconds });
      } catch (error) {
        // 推送用真实接口但没配置 Google 凭据（生产上线初期，用户 2026-10-04 口径）：安静跳过，不当作拉取出错去退避，
        // 只在第一次记一条日志；配置好重新部署后自然开始拉
        if (!(error instanceof ClientNotConfiguredError)) throw error;
        if (!reportedNotConfigured) {
          logger.info('没有配置 Google 凭据，Gmail 推送不拉取（Gmail 为未连接）');
          reportedNotConfigured = true;
        }
        return 0;
      }
      if (notifications.length === 0) return 0;
      const mailboxes = [
        ...new Set(notifications.map((n) => n.mailbox.toLowerCase()).filter(Boolean)),
      ];
      await transaction(runtime, async (tx) => {
        for (const mailbox of mailboxes) {
          await tx.enqueue(gmailSyncJob, { mailbox }, { singletonKey: mailbox });
        }
      });
      // 任务入队（事务提交）后才确认；确认失败通知会重投，同步任务按游标取、入库去重，重投无害
      await push.acknowledge(notifications.map((n) => n.ackId));
      return notifications.length;
    },
    { exclusive: true },
  );
}

/** 每 5 分钟：给每个已 watch 的邮箱排一次同步 */
export async function pollMailboxes(runtime: Runtime, logger: Logger): Promise<void> {
  const targets = await mailboxTargets(runtime.db, { watched: true });
  await transaction(runtime, async (tx) => {
    for (const target of targets) {
      await tx.enqueue(gmailSyncJob, { mailbox: target.address }, { singletonKey: target.address });
    }
  });
  logger.debug({ mailboxes: targets.length }, '已排同步（history.list 兜底）');
}

/** 每天：续订各邮箱的 watch（游标不动）。一个邮箱失败不影响其他的，记进同步记录；有失败时任务失败，30 分钟后再试 */
export async function renewWatches(
  clients: IntegrationClients,
  { runtime, logger }: JobContext,
): Promise<void> {
  const failed: unknown[] = [];
  for (const target of await mailboxTargets(runtime.db, { watched: true })) {
    try {
      const watch = await gmailFor(clients, target).watch(target.address);
      await runtime.db
        .update(mailboxSync)
        .set({ watchExpiresAt: watch.expiration, updatedAt: runtime.clock.now() })
        .where(eq(mailboxSync.address, target.address));
    } catch (error) {
      failed.push(error);
      logger.warn({ err: error, mailbox: target.address }, '续订 watch 失败');
      await noteFailure(runtime, target.address, error, logger);
    }
  }
  if (failed.length > 0) throw new AggregateError(failed, `${failed.length} 个邮箱续订 watch 失败`);
}

/** Gmail 标签判断方向：「已发送」为我方发出，草稿、垃圾邮件、已删除不收，其余为来信 */
function directionOf(labelIds: readonly string[]): MessageDirection | null {
  if (labelIds.some((l) => l === 'DRAFT' || l === 'SPAM' || l === 'TRASH' || l === 'CHAT')) {
    return null;
  }
  return labelIds.includes('SENT') ? 'outbound' : 'inbound';
}

/** 地址列表展开成小写地址（含地址组的成员） */
function addressesOf(list: readonly Address[] | undefined): string[] {
  return (list ?? []).flatMap((a) =>
    a.group ? a.group.map((m) => m.address.toLowerCase()) : [a.address.toLowerCase()],
  );
}

function firstMailbox(address: Address | undefined): MailAddress {
  const mailbox = address?.group ? address.group[0] : address;
  return { name: mailbox?.name.trim() ?? '', address: mailbox?.address.trim().toLowerCase() ?? '' };
}

/** 地址列表展开成「地址 + 显示名」（含地址组的成员；Reply-To 用） */
function mailboxesOf(list: readonly Address[] | undefined): MailAddress[] {
  return (list ?? []).flatMap((a) => (a.group ?? [a]).map((m) => firstMailbox(m)));
}

/** References 等头里的 Message-ID 列表（各自带尖括号） */
function messageIds(value: string | undefined): string[] {
  return value?.match(/<[^<>\s]+>/g) ?? [];
}

function messageIdOf(value: string | undefined): string | null {
  return messageIds(value)[0] ?? null;
}

/**
 * 一封邮件入库（规格 channel「去重」，R-TK-07、E-15），返回是否新入库：
 * - 同一邮箱里同一个 Gmail 消息 ID 只入库一次（唯一约束，冲突即视为重复、丢弃并记日志）；
 * - 同方向、Message-ID 相同的信已在别的店铺邮箱入库：只记「同时发送到」，不识别店铺、不发事件；
 * - 来信：按收件邮箱识别店铺，识别渠道、站点、来源与客户渠道身份（recognition.ts）；来源是平台通知或营销的只入库归档（PRD 1.4），
 *   其余在同一事务里发出「来信已接收」；
 * - 我方发出（「已发送」）：店铺就是发件邮箱的店铺，不识别来源；在同一事务里发出「我方发信已同步」（ticket 识别回复，16）。
 */
/** 一封邮件入库的结果：新的一封、别的邮箱已收过的同一封（只记「同时发送到」）、同一邮箱里重复投递的（丢弃） */
type IngestResult = 'created' | 'copy' | 'duplicate';

async function ingestMessage(
  runtime: Runtime,
  target: MailboxTarget,
  rules: readonly SenderRule[],
  raw: GmailRawMessage,
  parsed: Email,
  direction: MessageDirection,
  logger: Logger,
): Promise<IngestResult> {
  const rfcMessageId = messageIdOf(parsed.messageId);
  const from = firstMailbox(parsed.from);
  const headers = parsed.headers.map((h) => ({ key: h.key, value: h.value }));
  return transaction(runtime, async (tx) => {
    if (rfcMessageId) {
      // 同一封邮件的几份副本可能同时在几个邮箱入库：按 Message-ID 串行，最早入库的一封为准
      await advisoryLock(tx, `channel.rfc_message_id:${rfcMessageId}`);
    }
    const [canonical] = rfcMessageId
      ? await tx.db
          .select({ id: message.id, mailbox: message.mailbox, alsoSentTo: message.alsoSentTo })
          .from(message)
          .where(
            and(
              eq(message.direction, direction),
              eq(message.rfcMessageId, rfcMessageId),
              isNull(message.duplicateOfId),
            ),
          )
          .limit(1)
      : [];
    // 同一封邮件的其余副本不识别（R-TK-07：只按最早收到的一封识别店铺并归并）；我方发出的不识别来源
    const recognized =
      canonical || direction === 'outbound'
        ? null
        : recognizeInbound(
            { from, replyTo: mailboxesOf(parsed.replyTo), text: parsed.text ?? null, headers },
            target,
            rules,
          );
    const [row] = await tx.db
      .insert(message)
      .values({
        mailbox: target.address,
        gmailMessageId: raw.id,
        gmailThreadId: raw.threadId,
        direction,
        rfcMessageId,
        inReplyTo: messageIdOf(parsed.inReplyTo),
        references: messageIds(parsed.references),
        fromAddress: from.address,
        fromName: from.name,
        toAddresses: addressesOf(parsed.to),
        subject: parsed.subject?.trim() ?? '',
        textBody: parsed.text ?? null,
        htmlBody: parsed.html ?? null,
        headers,
        receivedAt: raw.internalDate,
        storeId: recognized || (direction === 'outbound' && !canonical) ? target.storeId : null,
        channel: recognized?.channel ?? null,
        site: recognized?.site ?? null,
        source: recognized?.source ?? null,
        senderAddress: recognized?.sender.address ?? null,
        senderName: recognized?.sender.name ?? null,
        duplicateOfId: canonical?.id ?? null,
        createdAt: tx.now,
      })
      .onConflictDoNothing({ target: [message.mailbox, message.gmailMessageId] })
      .returning({ id: message.id });
    if (!row) {
      logger.info({ mailbox: target.address, gmailMessageId: raw.id }, '重复消息，已丢弃（E-15）');
      return 'duplicate';
    }
    if (canonical) {
      const seen = [canonical.mailbox, ...canonical.alsoSentTo];
      if (!seen.includes(target.address)) {
        await tx.db
          .update(message)
          .set({ alsoSentTo: sql`array_append(${message.alsoSentTo}, ${target.address})` })
          .where(eq(message.id, canonical.id));
      }
      logger.info(
        { mailbox: target.address, rfcMessageId, canonicalId: canonical.id },
        '同一封邮件已在别的邮箱收到，只记「同时发送到」（R-TK-07）',
      );
      return 'copy';
    }
    if (direction === 'outbound') {
      await tx.enqueue(outboundSyncedJob, { messageId: row.id });
      logger.info({ mailbox: target.address, messageId: row.id }, '「已发送」的我方回信已入库');
      return 'created';
    }
    if (recognized && isArchivedSource(recognized.source)) {
      logger.info(
        { mailbox: target.address, messageId: row.id, source: recognized.source },
        '平台通知或营销邮件，已归档，不建工单',
      );
      return 'created';
    }
    await tx.enqueue(inboundReceivedJob, { messageId: row.id });
    return 'created';
  });
}

/** 逐封取原文、解析、入库；返回这次新入库的来信（几封、到达时间的起止） */
async function ingestAll(
  runtime: Runtime,
  gmail: GmailClient,
  target: MailboxTarget,
  ids: readonly string[],
  logger: Logger,
): Promise<SyncedMail> {
  const address = target.address;
  const rules = await loadSenderRules(runtime.db);
  let count = 0;
  let from: Date | null = null;
  let to: Date | null = null;
  for (const id of new Set(ids)) {
    const [stored] = await runtime.db
      .select({ id: message.id })
      .from(message)
      .where(and(eq(message.mailbox, address), eq(message.gmailMessageId, id)))
      .limit(1);
    if (stored) {
      logger.info({ mailbox: address, gmailMessageId: id }, '重复消息，已丢弃（E-15）');
      continue;
    }
    let raw: GmailRawMessage;
    try {
      raw = await gmail.getMessage(address, id);
    } catch (error) {
      // history 里有、之后又被删掉的邮件：Gmail 返回 404，跳过（不是连接问题）
      if (error instanceof ExternalCallFailedError && error.status === 404) {
        logger.info({ mailbox: address, gmailMessageId: id }, '邮件已不存在，跳过');
        continue;
      }
      throw error;
    }
    const direction = directionOf(raw.labelIds);
    if (!direction) {
      logger.debug(
        { mailbox: address, gmailMessageId: id, labelIds: raw.labelIds },
        '草稿或垃圾邮件，跳过',
      );
      continue;
    }
    const parsed = await PostalMime.parse(raw.raw);
    const result = await ingestMessage(runtime, target, rules, raw, parsed, direction, logger);
    // 补拉了几封来信：新入库的来信（含归档的平台通知），别的邮箱已收过的副本不算
    if (result === 'created' && direction === 'inbound') {
      count += 1;
      if (!from || raw.internalDate < from) from = raw.internalDate;
      if (!to || raw.internalDate > to) to = raw.internalDate;
    }
  }
  return { count, from, to };
}

/** 推进游标：只往前走（同一邮箱的同步不会并行，仍按旧值比较后再写） */
async function advanceCursor(tx: Tx, address: string, from: string, to: string): Promise<void> {
  if (BigInt(to) <= BigInt(from)) return;
  await tx.db
    .update(mailboxSync)
    .set({ historyId: to, updatedAt: tx.now })
    .where(and(eq(mailboxSync.address, address), eq(mailboxSync.historyId, from)));
}

/** 游标过期后从上次成功同步前多久起补拉（internalDate 与同步时刻有先后差，多拉一段由去重兜住） */
const BACKFILL_MARGIN_MS = 60 * 60_000;

interface SyncState {
  readonly historyId: string;
  readonly lastSuccessAt: Date | null;
  readonly createdAt: Date;
  readonly backfillFrom: Date | null;
  readonly backfillHistoryId: string | null;
}

/**
 * 游标过期：先取邮箱此刻的新游标（补拉期间新到的信之后照常经 history.list 取到），记下补拉区间的起点
 * （上次成功同步前 1 小时；从没成功过取开始监听的时刻），之后由 backfill 补拉
 */
async function startBackfill(
  runtime: Runtime,
  gmail: GmailClient,
  address: string,
  state: SyncState,
  logger: Logger,
): Promise<{ from: Date; historyId: string }> {
  const { historyId } = await gmail.profile(address);
  const from = new Date((state.lastSuccessAt ?? state.createdAt).getTime() - BACKFILL_MARGIN_MS);
  await runtime.db
    .update(mailboxSync)
    .set({ backfillFrom: from, backfillHistoryId: historyId, updatedAt: runtime.clock.now() })
    .where(eq(mailboxSync.address, address));
  logger.warn({ mailbox: address, from, historyId }, '增量游标已过期，按到达时间区间全量补拉');
  return { from, historyId };
}

/** 区间补拉：取起点之后到达的全部消息逐封入库，全部完成后才换上新游标、清掉补拉记录并记同步成功 */
async function backfill(
  runtime: Runtime,
  gmail: GmailClient,
  target: MailboxTarget,
  range: { from: Date; historyId: string },
  logger: Logger,
): Promise<void> {
  const ids = await gmail.listMessages(target.address, { after: range.from });
  const synced = await ingestAll(runtime, gmail, target, ids, logger);
  await transaction(runtime, async (tx) => {
    await tx.db
      .update(mailboxSync)
      .set({
        historyId: range.historyId,
        backfillFrom: null,
        backfillHistoryId: null,
        updatedAt: tx.now,
      })
      .where(eq(mailboxSync.address, target.address));
    await recordMailboxSuccess(tx, target.address, synced);
  });
  logger.info({ mailbox: target.address, messages: ids.length }, '区间补拉完成');
}

/**
 * 同步一个邮箱：取游标之后新到的消息逐封入库，全部成功后推进游标并记同步成功；中途失败则任务重试，已入库的按去重跳过。
 * 外部调用失败记进同步记录（连续 3 次为连接异常）
 */
export async function syncMailbox(
  clients: IntegrationClients,
  { mailbox }: { mailbox: string },
  { runtime, logger }: JobContext,
): Promise<void> {
  const address = mailbox.toLowerCase();
  const target = await mailboxTarget(runtime.db, address);
  if (!target) {
    logger.warn({ mailbox: address }, '不是登记的进线邮箱，忽略这条推送');
    return;
  }
  const [state] = await runtime.db
    .select({
      historyId: mailboxSync.historyId,
      lastSuccessAt: mailboxSync.lastSuccessAt,
      createdAt: mailboxSync.createdAt,
      backfillFrom: mailboxSync.backfillFrom,
      backfillHistoryId: mailboxSync.backfillHistoryId,
    })
    .from(mailboxSync)
    .where(eq(mailboxSync.address, address))
    .limit(1);
  if (!state?.historyId) {
    logger.warn({ mailbox: address }, '邮箱还没有开始监听，等 watch 建立游标后再同步');
    return;
  }
  const cursor = state.historyId;
  const gmail = gmailFor(clients, target);
  try {
    // 上次补拉没完成：接着补（补拉完成前不按旧游标增量取）
    if (state.backfillFrom && state.backfillHistoryId) {
      await backfill(
        runtime,
        gmail,
        target,
        { from: state.backfillFrom, historyId: state.backfillHistoryId },
        logger,
      );
      return;
    }
    let changes: Awaited<ReturnType<GmailClient['listHistory']>>;
    try {
      changes = await gmail.listHistory(address, cursor);
    } catch (error) {
      if (!(error instanceof CursorExpiredError)) throw error;
      const range = await startBackfill(
        runtime,
        gmail,
        address,
        { ...state, historyId: cursor },
        logger,
      );
      await backfill(runtime, gmail, target, range, logger);
      return;
    }
    const synced = await ingestAll(runtime, gmail, target, changes.messageIds, logger);
    await transaction(runtime, async (tx) => {
      await advanceCursor(tx, address, cursor, changes.historyId);
      await recordMailboxSuccess(tx, address, synced);
    });
  } catch (error) {
    await noteFailure(runtime, address, error, logger);
    throw error;
  }
}

/**
 * 「测试连接」（K20，2026-10-06 用户确认）：逐个进线邮箱取 users.getProfile，看能不能以该邮箱身份访问；不改连接状态
 * （状态只看同步记录）。能访问但还没 watch 成功的邮箱当场 watch（「重新检测」立即重测并补拉，不用等 worker 的退避；
 * watch 失败算访问不了），测完给每个已 watch 的邮箱排一次同步——能访问了就马上补拉、恢复
 */
export async function testGmailConnection(
  runtime: Runtime,
  clients: IntegrationClients,
  logger: Logger,
): Promise<{ reachable: string[]; unreachable: string[] }> {
  const unwatched = new Set(
    (await mailboxTargets(runtime.db, { watched: false })).map((target) => target.address),
  );
  const reachable: string[] = [];
  const unreachable: string[] = [];
  for (const target of await mailboxTargets(runtime.db)) {
    const gmail = gmailFor(clients, target);
    try {
      await gmail.profile(target.address);
      if (unwatched.has(target.address)) await startWatching(runtime, gmail, target, logger);
      reachable.push(target.address);
    } catch (error) {
      logger.warn({ err: error, mailbox: target.address }, '测试连接：邮箱无法访问');
      unreachable.push(target.address);
    }
  }
  await pollMailboxes(runtime, logger);
  return { reachable, unreachable };
}
