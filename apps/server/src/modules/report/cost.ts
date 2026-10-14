import { businessDate } from '@forcome/calendar';
import {
  reportCostRange,
  sortCostBars,
  type ReportCost,
  type ReportQuery,
} from '@forcome/contracts';
import Big from 'big.js';
import { and, count, eq, gte, lte, sql } from 'drizzle-orm';
import { aftersalesCost } from '../aftersales/schema';
import { storeScopeCondition, type Database, type StoreScope } from '../core';
import { runReportQuery } from './read-only';

/*
 * P17「售后成本按责任类型」（PRD P17「第一阶段」v2.35、R-AS-08、AC-RP-01，待办 25）：在只读角色下（runReportQuery）直读
 * aftersales 的售后成本视图 aftersales_cost（ADR 0005 的例外：经 aftersales/schema.ts 引用）——与 P13 合计行同一个视图、同一组条件，
 * 卡头总额与 P13 合计一致。费用发生日取本月 1 日至今天（不随时间筛选），显式施加店铺范围与店铺筛选（视图的 store_id，ADR 0010），
 * 不随站点（P13 没有站点筛选，协调者 2026-10-14 决定 Q2）。责任类型为空的金额单列（未登记责任，Q1），不从合计里丢掉。
 */

/** 本月的售后成本：合计、单数与每个责任类型（含未登记责任）的金额与单数（金额为 0 的也在，画面上不出条、导出照列） */
export async function costReport(
  db: Database,
  scope: StoreScope,
  query: Pick<ReportQuery, 'store'>,
  now: Date,
): Promise<ReportCost> {
  const range = reportCostRange(businessDate(now));
  const rows = await runReportQuery(db, (tx) =>
    tx
      .select({
        responsibility: aftersalesCost.responsibility,
        totalUsd: sql<string>`sum(${aftersalesCost.totalUsd})::numeric(12, 2)::text`,
        count: count(),
      })
      .from(aftersalesCost)
      .where(
        and(
          storeScopeCondition(scope, aftersalesCost.storeId),
          query.store ? eq(aftersalesCost.storeId, query.store) : undefined,
          gte(aftersalesCost.feeDate, range.from),
          lte(aftersalesCost.feeDate, range.to),
        ),
      )
      .groupBy(aftersalesCost.responsibility),
  );
  const totalUsd = rows.reduce((sum, row) => sum.plus(row.totalUsd), new Big(0)).toFixed(2);
  return {
    range,
    totalUsd,
    count: rows.reduce((n, row) => n + row.count, 0),
    bars: sortCostBars(rows),
  };
}
