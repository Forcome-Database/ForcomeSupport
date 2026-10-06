import { orderQueueStatus, type OrderQueue } from '@forcome/contracts';
import { eq, sql } from 'drizzle-orm';
import type { DbExecutor, Runtime } from '../core';
import { orderQueue, type OrderQueueName } from './schema';

/*
 * 订单通知队列（SQS）的拉取与检查记录（PRD P18「第一阶段」亚马逊卡的 SQS 行，待办 12；协调者 2026-10-06 决定 Q7）：
 * - 常驻拉取每次拉取失败（外部调用）记一次，连续 3 次为「拉取失败」；拉取成功清零；
 * - 每分钟最多检查一次队列里等待拉取的通知数，达到 10 条为「积压」；
 * - 没配置 SQS 时没有记录（拉取源遇到「未配置」会清掉旧记录），卡上为「未连接」。
 * 只影响亚马逊卡上的 SQS 行：不进连接状态、不出横幅、不发通知（订单另有每 4 分钟的增量兜底）。
 */

const QUEUE: OrderQueueName = 'amazon_orders';

/** 失败的原因（排错用；只留前一段） */
function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/** 拉取成功：清零连续失败 */
export async function recordQueueReceiveSuccess(runtime: Runtime): Promise<void> {
  const now = runtime.clock.now();
  const healthy = { consecutiveFailures: 0, failingSince: null, lastError: null, updatedAt: now };
  await runtime.db
    .insert(orderQueue)
    .values({ name: QUEUE, ...healthy })
    .onConflictDoUpdate({ target: orderQueue.name, set: healthy });
}

/** 拉取失败（外部调用）：记一次，返回连续失败了几次 */
export async function recordQueueReceiveFailure(runtime: Runtime, error: unknown): Promise<number> {
  const now = runtime.clock.now();
  const [row] = await runtime.db
    .insert(orderQueue)
    .values({
      name: QUEUE,
      consecutiveFailures: 1,
      failingSince: now,
      lastError: errorText(error),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: orderQueue.name,
      set: {
        consecutiveFailures: sql`${orderQueue.consecutiveFailures} + 1`,
        failingSince: sql`coalesce(${orderQueue.failingSince}, excluded.failing_since)`,
        lastError: sql`excluded.last_error`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning({ failures: orderQueue.consecutiveFailures });
  return row?.failures ?? 1;
}

/** 检查到的等待拉取的通知数 */
export async function recordQueueBacklog(runtime: Runtime, backlog: number): Promise<void> {
  const now = runtime.clock.now();
  await runtime.db
    .insert(orderQueue)
    .values({ name: QUEUE, backlog, checkedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: orderQueue.name,
      set: { backlog, checkedAt: now, updatedAt: now },
    });
}

/** 没配置 SQS：清掉记录（卡上为未连接；之前配置过、后来去掉的不留旧状态） */
export async function clearQueueRecord(runtime: Runtime): Promise<void> {
  await runtime.db.delete(orderQueue).where(eq(orderQueue.name, QUEUE));
}

/** 订单通知队列此刻的状态（亚马逊卡的 SQS 行）：没有记录为未连接 */
export async function orderQueueState(db: DbExecutor): Promise<OrderQueue> {
  const [row] = await db
    .select({ failures: orderQueue.consecutiveFailures, backlog: orderQueue.backlog })
    .from(orderQueue)
    .where(eq(orderQueue.name, QUEUE))
    .limit(1);
  return orderQueueStatus({
    configured: row !== undefined,
    consecutiveFailures: row?.failures ?? 0,
    backlog: row?.backlog ?? null,
  });
}
