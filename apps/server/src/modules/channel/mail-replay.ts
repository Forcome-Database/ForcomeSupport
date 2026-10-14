import { MAIL_REPLAY_DAYS } from '@forcome/contracts';
import { and, asc, count, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  announceChange,
  toMilliseconds,
  transaction,
  type DbExecutor,
  type Logger,
  type Runtime,
} from '../core';
import { ExternalCallFailedError, type IntegrationClients } from '../integration';
import {
  directionOf,
  gmailFor,
  gmailSyncJob,
  ingestById,
  mailboxTarget,
  mailboxTargets,
  startWatching,
  type MailOutcome,
} from './gmail-sync';
import { readMailCutover, type MailCutover } from './mail-cutover';
import { mailboxSync, mailCutover, mailReplayItem, storeMailbox } from './schema';
import { loadSenderRules } from './sender-rules';

/*
 * 历史邮件回放的各步（规格「历史导入与切换」，待办 26）：命令（apps/server/src/mail-replay-command.ts）按顺序调用——
 * 各邮箱 watch → 写下 T0（进入回放中）→ 列回放清单 → 按到达时间逐封入库（与实时同步同一个 ingestById）→ 完成、开启实时处理。
 * 回放的「当前时间」与提醒、通知的关闭由命令给的回放运行时决定（Runtime.replay 与手动时钟），这里不另写归并、识别与 SLA。
 */

/** 回放清单里的一封 */
export interface ReplayItem {
  readonly mailbox: string;
  readonly gmailMessageId: string;
  readonly internalDate: Date;
}

/** 一个进线邮箱第一次 watch 的时刻 */
export interface WatchedMailbox {
  readonly address: string;
  readonly watchedAt: Date | null;
}

/**
 * 回放开始前给全部进线邮箱 watch：还没有游标的建立游标（记下时刻），已有的续订（游标不动）。哪个邮箱失败就抛出（带邮箱地址），
 * 不开始回放。返回各邮箱第一次 watch 的时刻（T0 不能早于它们）
 */
export async function watchMailboxes(
  runtime: Runtime,
  clients: IntegrationClients,
  logger: Logger,
): Promise<WatchedMailbox[]> {
  for (const target of await mailboxTargets(runtime.db)) {
    try {
      await startWatching(runtime, gmailFor(clients, target), target, logger);
    } catch (error) {
      throw new Error(
        `邮箱 ${target.address} 开始监听失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  return watchedMailboxes(runtime.db);
}

/** 各进线邮箱第一次 watch 的时刻（还没 watch 为 null），按地址 */
export async function watchedMailboxes(db: DbExecutor): Promise<WatchedMailbox[]> {
  return db
    .select({ address: storeMailbox.address, watchedAt: mailboxSync.watchedAt })
    .from(storeMailbox)
    .leftJoin(mailboxSync, eq(mailboxSync.address, storeMailbox.address))
    .orderBy(storeMailbox.address);
}

/** 写下切换时刻 T0，进入回放中（实时收信随之暂停）；已有切换记录时不动它，返回库里的那一条 */
export async function beginCutover(runtime: Runtime, t0: Date): Promise<MailCutover> {
  await transaction(runtime, async (tx) => {
    await tx.db
      .insert(mailCutover)
      .values({
        id: 1,
        t0,
        replayFrom: new Date(t0.getTime() - toMilliseconds({ days: MAIL_REPLAY_DAYS })),
        createdAt: tx.now,
        updatedAt: tx.now,
      })
      .onConflictDoNothing();
  });
  return (await readMailCutover(runtime.db))!;
}

/**
 * 列回放清单：各进线邮箱在 [replayFrom, T0) 到达的邮件（收件与「已发送」，不含草稿与垃圾邮件），已列过的不再取概要。
 * 全部邮箱列完才记下列完的时刻；中途失败下次重列（已列的跳过）。返回各邮箱这次列进了几封
 */
export async function listReplayMail(
  runtime: Runtime,
  clients: IntegrationClients,
  cutover: MailCutover,
  logger: Logger,
): Promise<Map<string, number>> {
  const listed = new Map<string, number>();
  for (const target of await mailboxTargets(runtime.db)) {
    const gmail = gmailFor(clients, target);
    const ids = await gmail.listMessages(target.address, {
      after: cutover.replayFrom,
      before: cutover.t0,
    });
    const known = new Set(
      (
        await runtime.db
          .select({ id: mailReplayItem.gmailMessageId })
          .from(mailReplayItem)
          .where(eq(mailReplayItem.mailbox, target.address))
      ).map((row) => row.id),
    );
    const rows: ReplayItem[] = [];
    for (const id of new Set(ids)) {
      if (known.has(id)) continue;
      let info: Awaited<ReturnType<typeof gmail.getMessageInfo>>;
      try {
        info = await gmail.getMessageInfo(target.address, id);
      } catch (error) {
        if (error instanceof ExternalCallFailedError && error.status === 404) continue;
        throw error;
      }
      if (!directionOf(info.labelIds)) continue;
      // Gmail 按秒比较：边界那一秒的按 internalDate 再筛，[replayFrom, T0)
      const at = info.internalDate.getTime();
      if (at < cutover.replayFrom.getTime() || at >= cutover.t0.getTime()) continue;
      rows.push({ mailbox: target.address, gmailMessageId: id, internalDate: info.internalDate });
    }
    for (let i = 0; i < rows.length; i += 500) {
      await runtime.db
        .insert(mailReplayItem)
        .values(rows.slice(i, i + 500))
        .onConflictDoNothing();
    }
    listed.set(target.address, rows.length);
    logger.info({ mailbox: target.address, listed: rows.length }, '回放清单：已列出');
  }
  await runtime.db
    .update(mailCutover)
    .set({ listedAt: runtime.clock.now(), updatedAt: runtime.clock.now() })
    .where(eq(mailCutover.id, 1));
  return listed;
}

/** 回放清单的进度：共几封、已回放几封 */
export async function replayProgress(
  runtime: Runtime,
): Promise<{ total: number; replayed: number }> {
  const [total] = await runtime.db.select({ n: count() }).from(mailReplayItem);
  const [replayed] = await runtime.db
    .select({ n: count() })
    .from(mailReplayItem)
    .where(isNotNull(mailReplayItem.replayedAt));
  return { total: total?.n ?? 0, replayed: replayed?.n ?? 0 };
}

/** 接下来要回放的几封：还没回放的，按到达时间升序（同一时刻按邮箱、Gmail 消息 ID） */
export async function nextReplayItems(runtime: Runtime, limit: number): Promise<ReplayItem[]> {
  return runtime.db
    .select({
      mailbox: mailReplayItem.mailbox,
      gmailMessageId: mailReplayItem.gmailMessageId,
      internalDate: mailReplayItem.internalDate,
    })
    .from(mailReplayItem)
    .where(isNull(mailReplayItem.replayedAt))
    .orderBy(
      asc(mailReplayItem.internalDate),
      asc(mailReplayItem.mailbox),
      asc(mailReplayItem.gmailMessageId),
    )
    .limit(limit);
}

/**
 * 回放一封：与实时同步同一条入库路径（去重、识别、未归属入队、发「来信已接收」「我方发信已同步」），运行时由调用方给
 * （回放的运行时：「当前时间」是这封邮件的到达时间、通知关闭）。邮箱已不在店铺配置里的跳过
 */
export async function replayMail(
  runtime: Runtime,
  clients: IntegrationClients,
  item: ReplayItem,
  logger: Logger,
): Promise<MailOutcome> {
  const target = await mailboxTarget(runtime.db, item.mailbox);
  if (!target) {
    logger.warn({ mailbox: item.mailbox }, '回放：邮箱已不在店铺配置里，跳过');
    return { result: 'skipped' };
  }
  const rules = await loadSenderRules(runtime.db);
  return ingestById(runtime, gmailFor(clients, target), target, rules, item.gmailMessageId, logger);
}

/** 这一封回放完了（入库与它引起的任务都已跑完）：记下处理时刻 */
export async function markReplayed(runtime: Runtime, item: ReplayItem, at: Date): Promise<void> {
  await runtime.db
    .update(mailReplayItem)
    .set({ replayedAt: at })
    .where(
      and(
        eq(mailReplayItem.mailbox, item.mailbox),
        eq(mailReplayItem.gmailMessageId, item.gmailMessageId),
      ),
    );
}

/**
 * 完成切换、开启实时处理：记下完成时刻，给每个已 watch 的邮箱排一次同步（worker 起来后立即从游标接着收 T0 之后的信，
 * 回放过的按「邮箱 + Gmail 消息 ID」去重），并通知开着的页面工单与未归属队列变了（回放期间不推送）。运行时是实时的
 */
export async function completeCutover(runtime: Runtime): Promise<MailCutover> {
  const watched = await mailboxTargets(runtime.db, { watched: true });
  await transaction(runtime, async (tx) => {
    await tx.db
      .update(mailCutover)
      .set({ completedAt: tx.now, updatedAt: tx.now })
      .where(and(eq(mailCutover.id, 1), isNull(mailCutover.completedAt)));
    for (const target of watched) {
      await tx.enqueue(gmailSyncJob, { mailbox: target.address }, { singletonKey: target.address });
    }
    await announceChange(tx, { topic: 'tickets' });
    await announceChange(tx, { topic: 'unassigned_mail' });
  });
  return (await readMailCutover(runtime.db))!;
}
