import { ratioPairsOf, type LedgerItem, type Ratios } from '@forcome/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { storeNamesById } from '../channel';
import { storeScopeCondition, type DbExecutor, type StoreScope } from '../core';
import { feesOf } from './fees';
import { aftersales } from './schema';

/*
 * 登记台账 P13 的查询（店铺范围内，ADR 0010）。最简列表：售后单号、客户、店铺与站点、处理方式、责任、状态、
 * 快递单号、费用列（原币、汇率与冻结美元值，待办 20）；筛选、合计行、列设置与导出随 22，完整率与「缺 N 项」随 21。
 */

export type AftersalesRow = typeof aftersales.$inferSelect;

/** 三组承担比例；历史导入缺比例时为 null */
export function ratiosOf(row: AftersalesRow): Ratios | null {
  const { productFactoryPct: product, freightFactoryPct: freight, otherFactoryPct: other } = row;
  if (product === null || freight === null || other === null) return null;
  return ratioPairsOf({ product, freight, other });
}

/** 台账的一行；财务字段由接口按查看者的权限过滤（stripFinanceFields） */
export function toLedgerItem(
  row: AftersalesRow,
  storeNames: ReadonlyMap<string, string>,
): LedgerItem {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    origin: row.origin,
    customerName: row.customerName,
    store: { id: row.storeId, name: storeNames.get(row.storeId) ?? '' },
    site: row.site,
    method: row.method,
    responsibility: row.responsibility,
    trackingNumber: row.trackingNumber,
    version: row.version,
    fees: feesOf(row),
    ratios: ratiosOf(row),
  };
}

/** P13 台账（店铺范围内），按售后单号先后（原型 P13 的顺序：创建日期、全局序号） */
export async function listLedger(db: DbExecutor, scope: StoreScope): Promise<LedgerItem[]> {
  const rows = await db
    .select()
    .from(aftersales)
    .where(storeScopeCondition(scope, aftersales.storeId))
    .orderBy(asc(aftersales.number));
  const names = await storeNamesById(
    db,
    rows.map((row) => row.storeId),
  );
  return rows.map((row) => toLedgerItem(row, names));
}

/** 按售后单号取一张（店铺范围内；不在范围内或没有为 null） */
export async function findAftersales(
  db: DbExecutor,
  scope: StoreScope,
  number: string,
): Promise<AftersalesRow | null> {
  const [row] = await db
    .select()
    .from(aftersales)
    .where(and(eq(aftersales.number, number), storeScopeCondition(scope, aftersales.storeId)));
  return row ?? null;
}
