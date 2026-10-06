import {
  CONNECTION_FAILURE_LIMIT,
  SYNC_DELAY_MS,
  syncConnectionStatus,
  type ConnectionStatus,
  type SyncHealth,
} from '@forcome/contracts';
import { and, eq, sql } from 'drizzle-orm';
import {
  recordAudit,
  systemActor,
  transaction,
  type DbExecutor,
  type Runtime,
  type Tx,
} from '../core';
import { notifyMembers } from '../org';
import type { MirrorWrites } from './mirror';
import { AMAZON_CONNECTION_NOTICES, amazonAuditObject } from './amazon-copy';
import { orderSweep, orderSync, type OrderSource } from './schema';
import { SHOPIFY_CONNECTION_NOTICES, shopifyAuditObject } from './shopify-copy';

/*
 * 订单同步记录与连接状态（PRD 6.9、E-01、11.4，待办 11；亚马逊待办 12；同 Gmail 的 mailbox-health.ts）：按「店铺 × 数据源」
 * - 每个店铺按 order.order_sync 的「最近同步成功的时间」与「连续失败的次数」算状态（contracts 的 syncConnectionStatus：
 *   连续 3 次失败为连接异常，从没成功过为未连接，超过 10 分钟没同步成功为同步延迟）；
 * - 失败：每分钟增量同步的外部调用失败各记一次（按订单名补拉是归并时的按需查询，失败由调用方重试，不记）；连续第 3 次时转为连接异常——给在职的管理员与客服主管发站内通知
 *   （连接异常另排钉钉工作通知，org 的 notifyMembers 按 11.4 自动），记审计「连接异常」，全站横幅随之出现；
 * - 成功：一轮增量把水位之后的订单全部写进镜像才算，清零失败次数、记下时间；之前是连接异常的，
 *   发「Shopify 已恢复」/「亚马逊 SP-API 已恢复」（写补拉了几笔订单）并记审计「恢复连接」，横幅随之消失。
 * 我们自己的错误（数据库）不算连接失败：水位不前进，超过 10 分钟就显示同步延迟。通知与审计的写法按数据源（CHANNELS）。
 */

/** 各数据源的渠道：通知文案、审计对象与审计快照里的 channel（P27「补拉 N 笔订单」） */
const CHANNELS = {
  shopify_orders: {
    channel: 'shopify',
    notices: SHOPIFY_CONNECTION_NOTICES,
    auditObject: shopifyAuditObject,
  },
  amazon_orders: {
    channel: 'amazon',
    notices: AMAZON_CONNECTION_NOTICES,
    auditObject: amazonAuditObject,
  },
} as const satisfies Record<OrderSource, unknown>;

/** 一个店铺的订单同步记录 */
export interface OrderSyncHealth extends SyncHealth {
  readonly storeId: string;
  readonly failingSince: Date | null;
}

/** 某个数据源全部店铺的同步记录（还没同步过的店铺没有记录） */
export async function orderSyncHealths(
  db: DbExecutor,
  source: OrderSource,
): Promise<Map<string, OrderSyncHealth>> {
  const rows = await db
    .select({
      storeId: orderSync.storeId,
      lastSuccessAt: orderSync.lastSuccessAt,
      consecutiveFailures: orderSync.consecutiveFailures,
      failingSince: orderSync.failingSince,
    })
    .from(orderSync)
    .where(eq(orderSync.source, source));
  return new Map(rows.map((row) => [row.storeId, row]));
}

/** 订单同步的连接状态（6.9：订单超过 10 分钟没同步成功为同步延迟） */
export function orderSyncStatus(health: SyncHealth, now: Date): ConnectionStatus {
  return syncConnectionStatus(health, SYNC_DELAY_MS.orders, now);
}

/** 失败的原因（排错用；只留前一段） */
function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/** 写同步记录要知道的店铺（通知与审计写店铺名） */
export interface SyncedStore {
  readonly id: string;
  readonly name: string;
}

/**
 * 记一次失败（单独的事务：同步本身已经失败）。连续第 3 次时转为连接异常：通知管理员与客服主管、记审计。返回连续失败了几次
 */
export async function recordOrderSyncFailure(
  runtime: Runtime,
  store: SyncedStore,
  error: unknown,
  source: OrderSource,
): Promise<number> {
  return transaction(runtime, async (tx) => {
    const [row] = await tx.db
      .insert(orderSync)
      .values({
        storeId: store.id,
        source,
        consecutiveFailures: 1,
        failingSince: tx.now,
        lastError: errorText(error),
        createdAt: tx.now,
        updatedAt: tx.now,
      })
      .onConflictDoUpdate({
        target: [orderSync.storeId, orderSync.source],
        set: {
          consecutiveFailures: sql`${orderSync.consecutiveFailures} + 1`,
          failingSince: sql`coalesce(${orderSync.failingSince}, excluded.failing_since)`,
          lastError: sql`excluded.last_error`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .returning({
        failures: orderSync.consecutiveFailures,
        lastSuccessAt: orderSync.lastSuccessAt,
      });
    const failures = row?.failures ?? 1;
    if (failures === CONNECTION_FAILURE_LIMIT) {
      await disconnected(tx, store, row?.lastSuccessAt ?? null, source);
    }
    return failures;
  });
}

async function disconnected(
  tx: Tx,
  store: SyncedStore,
  lastSuccessAt: Date | null,
  source: OrderSource,
): Promise<void> {
  const { channel, notices, auditObject } = CHANNELS[source];
  await notifyMembers(tx, {
    type: 'channel_disconnected',
    title: notices.disconnected.title,
    body: notices.disconnected.body(store.name),
    object: { ...notices.object },
  });
  const lastSuccess = lastSuccessAt?.toISOString() ?? null;
  await recordAudit(tx, systemActor, {
    action: 'channel.disconnected',
    objectType: 'channel',
    ...auditObject(store),
    // 按店铺的记录：P27 按查看者的店铺范围过滤（PRD 10.2）
    storeId: store.id,
    before: {
      channel,
      // 第 3 次失败之前的状态：上次成功的时间决定是已连接、同步延迟还是未连接
      status: orderSyncStatus(
        { lastSuccessAt, consecutiveFailures: CONNECTION_FAILURE_LIMIT - 1 },
        tx.now,
      ),
      lastSuccessAt: lastSuccess,
      backfilled: null,
      trigger: null,
    },
    after: {
      channel,
      status: 'error',
      lastSuccessAt: lastSuccess,
      backfilled: null,
      trigger: { kind: 'failures', count: CONNECTION_FAILURE_LIMIT },
    },
  });
}

/**
 * 记一次同步成功并推进水位（与这一轮最后的写入同一个事务）：清零失败次数、记下时间。之前是连接异常的，发「已恢复」并记审计。
 * watermark 为 null 时不动水位
 */
export async function recordOrderSyncSuccess(
  tx: Tx,
  store: SyncedStore,
  watermark: Date | null,
  writes: MirrorWrites,
  source: OrderSource,
): Promise<void> {
  const [before] = await tx.db
    .select({
      failures: orderSync.consecutiveFailures,
      lastSuccessAt: orderSync.lastSuccessAt,
    })
    .from(orderSync)
    .where(and(eq(orderSync.storeId, store.id), eq(orderSync.source, source)))
    .for('update');
  const success = {
    lastSuccessAt: tx.now,
    consecutiveFailures: 0,
    failingSince: null,
    lastError: null,
    updatedAt: tx.now,
    ...(watermark ? { watermark } : {}),
  };
  await tx.db
    .insert(orderSync)
    .values({ storeId: store.id, source, createdAt: tx.now, ...success })
    .onConflictDoUpdate({
      target: [orderSync.storeId, orderSync.source],
      set: {
        ...success,
        // 水位只进不退：任务过期后旧的一轮晚结束（SP-API 配额排队可能很久）时，不把新一轮推进的水位改回去
        ...(watermark
          ? { watermark: sql`greatest(${orderSync.watermark}, excluded.watermark)` }
          : {}),
      },
    });
  if (!before || before.failures < CONNECTION_FAILURE_LIMIT) return;

  const { channel, notices, auditObject } = CHANNELS[source];
  await notifyMembers(tx, {
    type: 'channel_recovered',
    title: notices.recovered.title,
    body: notices.recovered.body(store.name, writes.count),
    object: { ...notices.object },
  });
  await recordAudit(tx, systemActor, {
    action: 'channel.recovered',
    objectType: 'channel',
    ...auditObject(store),
    storeId: store.id,
    before: {
      channel,
      status: 'error',
      lastSuccessAt: before.lastSuccessAt?.toISOString() ?? null,
      backfilled: null,
      trigger: { kind: 'failures', count: before.failures },
    },
    after: {
      channel,
      status: 'connected',
      lastSuccessAt: tx.now.toISOString(),
      backfilled:
        writes.count > 0 && writes.from && writes.to
          ? { count: writes.count, from: writes.from.toISOString(), to: writes.to.toISOString() }
          : null,
      trigger: { kind: 'retry_succeeded', attempt: before.failures + 1 },
    },
  });
}

/**
 * 店铺换了数据源（平台、平台标识或数据来源改了）：清掉它的订单同步记录，按新配置从头算——之前那个数据源的「最近同步成功」
 * 不能算在新的头上（例如模拟数据改成真实接口而凭据还没配置，应为未连接）。镜像里已有的订单留着
 */
export async function resetOrderSync(tx: Tx, storeId: string): Promise<void> {
  await tx.db.delete(orderSync).where(eq(orderSync.storeId, storeId));
  // 回补与对账也按新配置从头算：回补回到「未开始」，管理员再执行一次（待办 13）
  await tx.db.delete(orderSweep).where(eq(orderSweep.storeId, storeId));
}

/** 水位（还没同步过为 null） */
export async function orderSyncWatermark(
  db: DbExecutor,
  storeId: string,
  source: OrderSource,
): Promise<Date | null> {
  const [row] = await db
    .select({ watermark: orderSync.watermark })
    .from(orderSync)
    .where(and(eq(orderSync.storeId, storeId), eq(orderSync.source, source)))
    .limit(1);
  return row?.watermark ?? null;
}
