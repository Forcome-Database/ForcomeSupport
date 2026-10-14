import {
  CONNECTION_FAILURE_LIMIT,
  SYNC_DELAY_MS,
  syncConnectionStatus,
  type ConnectionStatus,
  type SyncHealth,
} from '@forcome/contracts';
import { eq, sql } from 'drizzle-orm';
import {
  recordAudit,
  systemActor,
  transaction,
  type AppEnv,
  type DbExecutor,
  type Runtime,
  type Tx,
} from '../core';
import { notifyMembers } from '../org';
import { GMAIL_CONNECTION_NOTICES, gmailAuditObject } from './gmail-copy';
import { liveMailOpen } from './mail-cutover';
import { mailboxSync, storeMailbox } from './schema';

/*
 * 邮箱的同步记录与连接状态（PRD 6.9、E-02、11.4，待办 09）：
 * - 每个进线邮箱按 channel.mailbox_sync 的「最近同步成功的时间」与「连续失败的次数」算状态（contracts 的 syncConnectionStatus：
 *   连续 3 次失败为连接异常，从没成功过为未连接，超过 10 分钟没同步成功为同步延迟）；
 * - 失败：watch、续订与同步的外部调用失败都记一次；连续第 3 次时转为连接异常——给在职的管理员与客服主管发站内通知
 *   （连接异常另排钉钉工作通知，org 的 notifyMembers 按 11.4 自动），记审计「连接异常」，全站横幅随之出现（alerts）；
 * - 成功：一次同步把游标之后的消息全部入库（游标过期时是区间补拉全部完成）才算，清零失败次数、记下这次取清单的时刻
 *   （那之前到达的信都已入库；按时关闭据此判断邮箱同步到了哪里，待办 33）；
 *   之前是连接异常的，发「Gmail 已恢复」（写补拉了几封来信）并记审计「恢复连接」，横幅随之消失。
 * 我们自己的错误（数据库、解析）不算连接失败：游标不前进，超过 10 分钟就显示同步延迟。
 */

/** 一个进线邮箱的同步记录 */
export interface MailboxHealth extends SyncHealth {
  readonly address: string;
  readonly failingSince: Date | null;
}

/** 全部进线邮箱的同步记录（按地址排序；还没 watch 过的邮箱为空记录） */
export async function mailboxHealths(db: DbExecutor): Promise<MailboxHealth[]> {
  const rows = await db
    .select({
      address: storeMailbox.address,
      lastSuccessAt: mailboxSync.lastSuccessAt,
      consecutiveFailures: mailboxSync.consecutiveFailures,
      failingSince: mailboxSync.failingSince,
    })
    .from(storeMailbox)
    .leftJoin(mailboxSync, eq(mailboxSync.address, storeMailbox.address))
    .orderBy(storeMailbox.address);
  return rows.map((row) => ({
    address: row.address,
    lastSuccessAt: row.lastSuccessAt,
    consecutiveFailures: row.consecutiveFailures ?? 0,
    failingSince: row.failingSince,
  }));
}

/**
 * 一个店铺的来信是否已经全部同步到某个时刻（ticket 按时关闭的前提「没看到全部来信前不关」，待办 33、ADR 0008 修订）：
 * 店铺的每个进线邮箱最近一次同步成功都不早于这个时刻（同步成功记的是这次取清单的时刻，那之前到达的信都已入库）。
 * 实时收信还没开（上线切换前，mail-cutover.ts：同步不入库、不记成败）、有邮箱从没同步成功过的，都算没同步到。
 * 店铺没有进线邮箱：不会再收到它的信，算已同步。历史回放不看这里（回放按到达时间逐封入库，回放时钟之前的信都已入库）
 */
export async function mailSyncedThrough(
  db: DbExecutor,
  appEnv: AppEnv,
  storeId: string,
  at: Date,
): Promise<boolean> {
  if (!(await liveMailOpen(db, appEnv))) return false;
  const rows = await db
    .select({ lastSuccessAt: mailboxSync.lastSuccessAt })
    .from(storeMailbox)
    .leftJoin(mailboxSync, eq(mailboxSync.address, storeMailbox.address))
    .where(eq(storeMailbox.storeId, storeId));
  return rows.every((row) => row.lastSuccessAt !== null && row.lastSuccessAt >= at);
}

/** 邮箱的连接状态（6.9：Gmail 超过 10 分钟没同步成功为同步延迟） */
export function mailboxStatus(health: SyncHealth, now: Date): ConnectionStatus {
  return syncConnectionStatus(health, SYNC_DELAY_MS.gmail, now);
}

/** 失败的原因（排错用；只留前一段） */
function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/**
 * 记一次失败（单独的事务：同步本身已经失败回滚了）。连续第 3 次时转为连接异常：通知管理员与客服主管、记审计。
 * 返回连续失败了几次
 */
export async function recordMailboxFailure(
  runtime: Runtime,
  address: string,
  error: unknown,
): Promise<number> {
  return transaction(runtime, async (tx) => {
    const [row] = await tx.db
      .insert(mailboxSync)
      .values({
        address,
        consecutiveFailures: 1,
        failingSince: tx.now,
        lastError: errorText(error),
        createdAt: tx.now,
        updatedAt: tx.now,
      })
      .onConflictDoUpdate({
        target: mailboxSync.address,
        set: {
          consecutiveFailures: sql`${mailboxSync.consecutiveFailures} + 1`,
          failingSince: sql`coalesce(${mailboxSync.failingSince}, excluded.failing_since)`,
          lastError: sql`excluded.last_error`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .returning({
        failures: mailboxSync.consecutiveFailures,
        lastSuccessAt: mailboxSync.lastSuccessAt,
      });
    const failures = row?.failures ?? 1;
    if (failures === CONNECTION_FAILURE_LIMIT) {
      await disconnected(tx, address, row?.lastSuccessAt ?? null);
    }
    return failures;
  });
}

async function disconnected(tx: Tx, address: string, lastSuccessAt: Date | null): Promise<void> {
  const notice = GMAIL_CONNECTION_NOTICES.disconnected;
  await notifyMembers(tx, {
    type: 'channel_disconnected',
    title: notice.title,
    body: notice.body(address),
    object: { ...GMAIL_CONNECTION_NOTICES.object },
  });
  const lastSuccess = lastSuccessAt?.toISOString() ?? null;
  await recordAudit(tx, systemActor, {
    action: 'channel.disconnected',
    objectType: 'channel',
    ...gmailAuditObject(address),
    before: {
      // 第 3 次失败之前的状态：上次成功的时间决定是已连接、同步延迟还是未连接
      status: mailboxStatus(
        { lastSuccessAt, consecutiveFailures: CONNECTION_FAILURE_LIMIT - 1 },
        tx.now,
      ),
      lastSuccessAt: lastSuccess,
      backfilled: null,
      trigger: null,
    },
    after: {
      status: 'error',
      lastSuccessAt: lastSuccess,
      backfilled: null,
      trigger: { kind: 'failures', count: CONNECTION_FAILURE_LIMIT },
    },
  });
}

/** 这次同步入库的来信：几封、到达时间的起止（恢复通知与审计写「补拉 N 封来信」） */
export interface SyncedMail {
  readonly count: number;
  readonly from: Date | null;
  readonly to: Date | null;
}

/**
 * 记一次同步成功（与推进游标在同一个事务里）：清零失败次数、记下这次取清单（history.list 或区间补拉的 messages.list）的时刻——
 * 不是入库完的时刻：入库期间新到的信不在这次的清单里。之前是连接异常的，发「Gmail 已恢复」并记审计
 */
export async function recordMailboxSuccess(
  tx: Tx,
  address: string,
  synced: SyncedMail,
  listedAt: Date,
): Promise<void> {
  const [before] = await tx.db
    .select({
      failures: mailboxSync.consecutiveFailures,
      lastSuccessAt: mailboxSync.lastSuccessAt,
    })
    .from(mailboxSync)
    .where(eq(mailboxSync.address, address))
    .for('update');
  await tx.db
    .update(mailboxSync)
    .set({
      lastSuccessAt: listedAt,
      consecutiveFailures: 0,
      failingSince: null,
      lastError: null,
      updatedAt: tx.now,
    })
    .where(eq(mailboxSync.address, address));
  if (!before || before.failures < CONNECTION_FAILURE_LIMIT) return;

  const notice = GMAIL_CONNECTION_NOTICES.recovered;
  await notifyMembers(tx, {
    type: 'channel_recovered',
    title: notice.title,
    body: notice.body(address, synced.count),
    object: { ...GMAIL_CONNECTION_NOTICES.object },
  });
  await recordAudit(tx, systemActor, {
    action: 'channel.recovered',
    objectType: 'channel',
    ...gmailAuditObject(address),
    before: {
      status: 'error',
      lastSuccessAt: before.lastSuccessAt?.toISOString() ?? null,
      backfilled: null,
      trigger: { kind: 'failures', count: before.failures },
    },
    after: {
      status: 'connected',
      lastSuccessAt: listedAt.toISOString(),
      backfilled:
        synced.count > 0 && synced.from && synced.to
          ? { count: synced.count, from: synced.from.toISOString(), to: synced.to.toISOString() }
          : null,
      trigger: { kind: 'retry_succeeded', attempt: before.failures + 1 },
    },
  });
}
