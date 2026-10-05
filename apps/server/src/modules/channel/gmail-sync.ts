import {
  isArchivedSource,
  type AdapterMode,
  type MessageDirection,
  type Platform,
  type Site,
} from '@forcome/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
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
} from '../core';
import {
  gmailClient,
  gmailPushClient,
  type GmailRawMessage,
  type IntegrationClients,
} from '../integration';
import { recognizeInbound, type MailAddress, type SenderRule } from './recognition';
import { mailboxSync, message, store, storeMailbox } from './schema';
import { loadSenderRules } from './sender-rules';

/*
 * 收信（规格 channel「Gmail 客户端」「去重」，ADR 0008 修订；待办 08 是最小形态）：
 * 1. 常驻拉取 channel.gmail_push：先确保每个进线邮箱已 watch（没有游标的先 watch，建立增量游标），
 *    再从 Pub/Sub 拉通知，按邮箱排「同步邮箱」任务，任务入队后才确认通知；
 * 2. 任务 channel.gmail_sync：history.list 取游标之后新到的消息，逐封取原文、解析、入库（去重），
 *    全部入库后才推进游标；入库时识别渠道、站点、来源与客户渠道身份（recognition.ts，待办 10）；新入库、
 *    不是别处已收过、来源也不是平台通知或营销（归档、不建工单）的来信，在同一事务里发出「来信已接收」（ticket 据此归并）。
 * 每天续订 watch、每 5 分钟 history.list 兜底、游标过期按 internalDate 区间补拉、「已发送」、常驻拉取选主、
 * 最近同步成功时间与连接状态随 09 号待办；收件地址识别不出店铺的未归属队列随 15。
 */

/** 同步一个邮箱：每个邮箱最多一个在排队、一个在跑（stately），通知再多也不会堆积 */
export const gmailSyncJob = defineJob('channel.gmail_sync', z.object({ mailbox: z.string() }), {
  policy: 'stately',
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
});

/**
 * 领域事件「来信已接收」：一封来信入库（不是别的邮箱已收过的同一封信，来源也不是归档的平台通知与营销），
 * ticket 据此归并成工单
 */
export const inboundReceivedJob = defineJob(
  'channel.inbound_received',
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

async function mailboxTarget(db: DbExecutor, address: string): Promise<MailboxTarget | null> {
  const [row] = await db
    .select(mailboxTargetColumns)
    .from(storeMailbox)
    .innerJoin(store, eq(store.id, storeMailbox.storeId))
    .where(eq(storeMailbox.address, address))
    .limit(1);
  return row ?? null;
}

function gmailFor(clients: IntegrationClients, target: MailboxTarget) {
  return clients.forStore(gmailClient, { id: target.storeId, adapterMode: target.adapterMode });
}

/** 开始监听失败后多久再试：1 分钟起翻倍，最多 30 分钟（连接状态与告警随 09） */
const WATCH_RETRY_MS = 60_000;
const WATCH_RETRY_MAX_MS = 30 * 60_000;

/** 开始监听失败的邮箱与下次重试的时刻（进程内，worker 重启后立即重试） */
type WatchRetries = Map<string, { readonly failures: number; readonly retryAt: number }>;

/**
 * 还没有增量游标的进线邮箱先 watch：watch 返回此刻的 historyId 作为游标，之后到的信才同步进来
 * （之前的历史邮件由历史回放导入，26）。一个邮箱失败只记日志、按退避稍后再试，不影响其他邮箱。
 */
async function ensureWatches(
  runtime: Runtime,
  clients: IntegrationClients,
  logger: Logger,
  retries: WatchRetries,
): Promise<void> {
  const unwatched: MailboxTarget[] = await runtime.db
    .select(mailboxTargetColumns)
    .from(storeMailbox)
    .innerJoin(store, eq(store.id, storeMailbox.storeId))
    .leftJoin(mailboxSync, eq(mailboxSync.address, storeMailbox.address))
    .where(isNull(mailboxSync.historyId));
  for (const target of unwatched) {
    const retry = retries.get(target.address);
    if (retry && retry.retryAt > runtime.clock.now().getTime()) continue;
    try {
      const watch = await gmailFor(clients, target).watch(target.address);
      const now = runtime.clock.now();
      await runtime.db
        .insert(mailboxSync)
        .values({
          address: target.address,
          historyId: watch.historyId,
          watchExpiresAt: watch.expiration,
          createdAt: now,
          updatedAt: now,
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
      retries.delete(target.address);
      logger.info({ mailbox: target.address, historyId: watch.historyId }, '邮箱已开始监听');
    } catch (error) {
      const failures = (retry?.failures ?? 0) + 1;
      const delay = Math.min(WATCH_RETRY_MS * 2 ** (failures - 1), WATCH_RETRY_MAX_MS);
      retries.set(target.address, { failures, retryAt: runtime.clock.now().getTime() + delay });
      logger.warn(
        { err: error, mailbox: target.address, failures, retryInMs: delay },
        '邮箱开始监听失败，稍后重试',
      );
    }
  }
}

/** 常驻拉取：Gmail 推送（Pub/Sub）→ 按邮箱排同步任务 */
export function createGmailPushFeed(clients: IntegrationClients): Feed {
  const watchRetries: WatchRetries = new Map();
  return defineFeed('channel.gmail_push', async ({ runtime, logger, waitSeconds }) => {
    await ensureWatches(runtime, clients, logger, watchRetries);
    const push = clients.global(gmailPushClient);
    const notifications = await push.pull({ maxMessages: 100, waitSeconds });
    if (notifications.length === 0) return 0;
    const mailboxes = [...new Set(notifications.map((n) => n.mailbox.toLowerCase()))];
    await transaction(runtime, async (tx) => {
      for (const mailbox of mailboxes) {
        await tx.enqueue(gmailSyncJob, { mailbox }, { singletonKey: mailbox });
      }
    });
    // 任务入队（事务提交）后才确认；确认失败通知会重投，同步任务按游标取、入库去重，重投无害
    await push.acknowledge(notifications.map((n) => n.ackId));
    return notifications.length;
  });
}

/** Gmail 标签判断方向：「已发送」为我方发出（09），草稿、垃圾邮件、已删除不收，其余为来信 */
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
 * 一封来信入库（规格 channel「去重」，R-TK-07、E-15）：
 * - 同一邮箱里同一个 Gmail 消息 ID 只入库一次（唯一约束，冲突即视为重复、丢弃并记日志）；
 * - Message-ID 相同的信已在别的店铺邮箱入库：只记「同时发送到」，不识别店铺、不发「来信已接收」；
 * - 否则按收件邮箱识别店铺，识别渠道、站点、来源与客户渠道身份（recognition.ts）；来源是平台通知或营销的
 *   只入库归档（PRD 1.4），其余在同一事务里发出「来信已接收」。
 */
async function ingestInbound(
  runtime: Runtime,
  target: MailboxTarget,
  rules: readonly SenderRule[],
  raw: GmailRawMessage,
  parsed: Email,
  logger: Logger,
): Promise<void> {
  const rfcMessageId = messageIdOf(parsed.messageId);
  const from = firstMailbox(parsed.from);
  const headers = parsed.headers.map((h) => ({ key: h.key, value: h.value }));
  await transaction(runtime, async (tx) => {
    if (rfcMessageId) {
      // 同一封邮件的几份副本可能同时在几个邮箱入库：按 Message-ID 串行，最早入库的一封为准
      await advisoryLock(tx, `channel.rfc_message_id:${rfcMessageId}`);
    }
    const [canonical] = rfcMessageId
      ? await tx.db
          .select({ id: message.id, mailbox: message.mailbox, alsoSentTo: message.alsoSentTo })
          .from(message)
          .where(and(eq(message.rfcMessageId, rfcMessageId), isNull(message.duplicateOfId)))
          .limit(1)
      : [];
    // 同一封邮件的其余副本不识别（R-TK-07：只按最早收到的一封识别店铺并归并）
    const recognized = canonical
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
        direction: 'inbound',
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
        storeId: recognized ? target.storeId : null,
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
      return;
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
      return;
    }
    if (recognized && isArchivedSource(recognized.source)) {
      logger.info(
        { mailbox: target.address, messageId: row.id, source: recognized.source },
        '平台通知或营销邮件，已归档，不建工单',
      );
      return;
    }
    await tx.enqueue(inboundReceivedJob, { messageId: row.id });
  });
}

/** 推进游标：只往前走（同一邮箱的同步不会并行，仍按旧值比较后再写） */
async function advanceCursor(
  runtime: Runtime,
  address: string,
  from: string,
  to: string,
): Promise<void> {
  if (BigInt(to) <= BigInt(from)) return;
  await runtime.db
    .update(mailboxSync)
    .set({ historyId: to, updatedAt: runtime.clock.now() })
    .where(and(eq(mailboxSync.address, address), eq(mailboxSync.historyId, from)));
}

/** 同步一个邮箱：取游标之后新到的消息逐封入库，全部成功后推进游标；中途失败则任务重试，已入库的按去重跳过 */
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
    .select({ historyId: mailboxSync.historyId })
    .from(mailboxSync)
    .where(eq(mailboxSync.address, address))
    .limit(1);
  if (!state?.historyId) {
    logger.warn({ mailbox: address }, '邮箱还没有开始监听，等 watch 建立游标后再同步');
    return;
  }
  const gmail = gmailFor(clients, target);
  const changes = await gmail.listHistory(address, state.historyId);
  const rules = await loadSenderRules(runtime.db);
  for (const id of new Set(changes.messageIds)) {
    const [stored] = await runtime.db
      .select({ id: message.id })
      .from(message)
      .where(and(eq(message.mailbox, address), eq(message.gmailMessageId, id)))
      .limit(1);
    if (stored) {
      logger.info({ mailbox: address, gmailMessageId: id }, '重复消息，已丢弃（E-15）');
      continue;
    }
    const raw = await gmail.getMessage(address, id);
    const direction = directionOf(raw.labelIds);
    if (direction !== 'inbound') {
      // 「已发送」入库与回复识别随 09、16；草稿、垃圾邮件不收
      logger.debug(
        { mailbox: address, gmailMessageId: id, labelIds: raw.labelIds },
        '不是来信，跳过',
      );
      continue;
    }
    const parsed = await PostalMime.parse(raw.raw);
    await ingestInbound(runtime, target, rules, raw, parsed, logger);
  }
  await advanceCursor(runtime, address, state.historyId, changes.historyId);
}
