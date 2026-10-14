import { CONNECTION_FAILURE_LIMIT, ORDER_QUEUE_BACKLOG_LIMIT } from '@forcome/contracts';
import { and, isNotNull, isNull, lte } from 'drizzle-orm';
import {
  alertClip as clip,
  alertTime,
  type AlertFinding,
  type DbExecutor,
  type SelfCheckProbe,
} from '../core';
import { orderQueue, orderSweep } from './schema';

/*
 * worker 自检的订单一项（待办 28，协调者 2026-10-14 决定 Q2 e、f；待办 12、13 留下的衔接）：
 * - 订单通知队列（SQS）：连续 3 次拉取失败（PRD 的「拉取失败」）、等待拉取的通知达到 10 条（「积压」），以及超过
 *   ALERT_SQS_CHECK_STALE_MINUTES 没有检查记录（拉取源没在跑）。没配置 SQS 时没有记录，不告警。这些在 P18 只写在亚马逊卡的
 *   一行、不出横幅、不发通知（协调者 Q7），系统级告警在这里；
 * - 订单回补与夜间对账：对账开始超过 ALERT_RECONCILE_STALE_HOURS 仍未完成；回补或对账的失败持续 30 分钟以上
 *   （failing_since；一次失败后 1 分钟起退避重试，偶发的失败下一页取到就清掉，不提醒）。
 * 店铺名由组装根注入（order 不依赖 channel）。
 */

/** 回补或对账连续失败这么久才告警（偶发的失败重试一次就好） */
const SWEEP_FAILING_MS = 30 * 60_000;

const SWEEP_LABELS = { backfill: '订单回补', reconcile: '夜间对账' } as const;

export function createOrderSelfCheckProbes(deps: {
  storeNames: (db: DbExecutor, ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
}): SelfCheckProbe[] {
  const queueProbe: SelfCheckProbe = {
    name: '订单通知队列（SQS）',
    async check({ db, now, settings }) {
      const rows = await db.select().from(orderQueue);
      const findings: AlertFinding[] = [];
      for (const row of rows) {
        const subject = '亚马逊订单通知队列（SQS）';
        if (row.consecutiveFailures >= CONNECTION_FAILURE_LIMIT) {
          findings.push({
            key: `sqs:${row.name}:failing`,
            subject,
            problem: `拉取失败：连续 ${row.consecutiveFailures} 次${row.failingSince ? `（自 ${alertTime(row.failingSince)} 起）` : ''}${row.lastError ? `：${clip(row.lastError)}` : ''}`,
          });
        }
        if (row.backlog !== null && row.backlog >= ORDER_QUEUE_BACKLOG_LIMIT) {
          findings.push({
            key: `sqs:${row.name}:backlog`,
            subject,
            problem: `积压 ${row.backlog} 条等待拉取的通知`,
          });
        }
        const checkedAt = row.checkedAt ?? row.updatedAt;
        if (now.getTime() - checkedAt.getTime() > settings.sqsCheckStaleMs) {
          findings.push({
            key: `sqs:${row.name}:stale`,
            subject,
            problem: `超过 ${Math.round(settings.sqsCheckStaleMs / 60_000)} 分钟没有检查记录（拉取源可能没在运行；最近 ${alertTime(checkedAt)}）`,
          });
        }
      }
      return findings;
    },
  };

  const sweepProbe: SelfCheckProbe = {
    name: '订单回补与夜间对账',
    async check({ db, now, settings }) {
      const stale = await db
        .select()
        .from(orderSweep)
        .where(
          and(
            isNull(orderSweep.completedAt),
            lte(orderSweep.startedAt, new Date(now.getTime() - settings.reconcileStaleMs)),
          ),
        );
      const failing = await db
        .select()
        .from(orderSweep)
        .where(
          and(
            isNull(orderSweep.completedAt),
            isNotNull(orderSweep.failingSince),
            lte(orderSweep.failingSince, new Date(now.getTime() - SWEEP_FAILING_MS)),
          ),
        );
      const names = await deps.storeNames(
        db,
        [...stale, ...failing].map((row) => row.storeId),
      );
      const store = (id: string) => names.get(id) ?? id;
      const findings: AlertFinding[] = [];
      // 回补可以跑很久（亚马逊按默认配额一天约 1.2 万笔），超过时限的只看对账
      for (const row of stale.filter((r) => r.kind === 'reconcile')) {
        findings.push({
          key: `sweep:${row.storeId}:reconcile:stale`,
          subject: `夜间对账 ${store(row.storeId)}`,
          problem: `开始于 ${alertTime(row.startedAt)}，超过 ${Math.round(settings.reconcileStaleMs / 3_600_000)} 小时仍未完成（已取 ${row.pages} 页）`,
        });
      }
      for (const row of failing) {
        findings.push({
          key: `sweep:${row.storeId}:${row.kind}:failing`,
          subject: `${SWEEP_LABELS[row.kind]} ${store(row.storeId)}`,
          problem: `自 ${alertTime(row.failingSince ?? row.updatedAt)} 起一直失败：${clip(row.lastError ?? '没有记下原因')}`,
        });
      }
      return findings;
    },
  };

  return [queueProbe, sweepProbe];
}
