import { BUSINESS_TIME_ZONE, businessDate } from '@forcome/calendar';
import {
  feeItems,
  missingFields,
  ratioPairsOf,
  type AftersalesDetail,
  type Completion,
  type FactoryRatios,
  type FeeItem,
  type LedgerItem,
  type LedgerQuery,
  type Ratios,
  type RegistrationField,
  type RegistrationRecord,
} from '@forcome/contracts';
import { and, asc, eq, gte, lte, ne, sql, type SQL } from 'drizzle-orm';
import { storeNamesById } from '../channel';
import { storeScopeCondition, type DbExecutor, type StoreScope } from '../core';
import { feesOf } from './fees';
import { aftersales } from './schema';

/*
 * 登记台账 P13 的查询（店铺范围内，ADR 0010）：列表（店铺、费用发生日筛选与「缺字段」筛选；筛选行的其余条件、合计、
 * 列设置与导出随 22）、当月登记完整率（R-AS-08）、一张单的完整登记（编辑登记抽屉）。
 * 缺失字段按 contracts 的 missingFields（R-AS-08 必填矩阵，前后端共用）判断，只对已完成的单算（AC-AS-22）。
 */

export type AftersalesRow = typeof aftersales.$inferSelect;

/** 三组工厂比例；历史导入缺比例时为 null */
export function factoryRatiosOfRow(row: AftersalesRow): FactoryRatios | null {
  const { productFactoryPct: product, freightFactoryPct: freight, otherFactoryPct: other } = row;
  if (product === null || freight === null || other === null) return null;
  return { product, freight, other };
}

/** 三组承担比例的两侧；历史导入缺比例时为 null */
export function ratiosOf(row: AftersalesRow): Ratios | null {
  const factory = factoryRatiosOfRow(row);
  return factory ? ratioPairsOf(factory) : null;
}

/** 售后单 → R-AS-08 判断缺失字段要看的内容 */
export function recordOf(row: AftersalesRow): RegistrationRecord {
  return {
    method: row.method,
    storeId: row.storeId,
    site: row.site,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    feeDate: row.feeDate,
    ownerId: row.ownerId,
    responsibility: row.responsibility,
    responsibilityReason: row.responsibilityReason,
    factory: row.factoryCode,
    claimTarget: row.claimTarget,
    claimStatus: row.claimStatus,
    part: row.partSku ? { sku: row.partSku, quantity: row.partQuantity } : null,
    shipper: row.shipper,
    carrier: row.carrier,
    shipDate: row.shipDate,
    trackingNumber: row.trackingNumber,
    factoryRatios: factoryRatiosOfRow(row),
    fees: {
      productCost: row.productCost,
      freight: row.freight,
      compensation: row.compensation,
      otherCost: row.otherCost,
    },
  };
}

/**
 * 台账上标出的缺失字段（R-AS-08）：只对已完成的单算——「待回填」标黄与「缺 N 项」只对已完成的单生效，
 * 进行中还没发生的字段显示「—」（AC-AS-22），已取消的单不再登记
 */
export function missingOf(row: AftersalesRow): RegistrationField[] {
  return row.status === 'completed' ? missingFields(recordOf(row)) : [];
}

/** 取消时确认保留的费用项（已取消的单） */
export function keptFeesOf(row: AftersalesRow): FeeItem[] {
  return feeItems.filter((item) => row[`${item}Kept`] === true);
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
    feeDate: row.feeDate,
    registeredById: row.registeredById,
    ownerId: row.ownerId,
    missing: missingOf(row),
    version: row.version,
    fees: feesOf(row),
    ratios: ratiosOf(row),
  };
}

/**
 * 一张单的完整登记（编辑登记抽屉）；姓名表含登记人与负责人（离职的也在），配件名按 SKU 取；财务字段由接口过滤
 */
export function toDetail(
  row: AftersalesRow,
  storeName: string,
  memberNames: ReadonlyMap<string, string>,
  partNames: ReadonlyMap<string, string>,
): AftersalesDetail {
  const person = (id: string | null, snapshot?: string | null) =>
    id ? { id, name: memberNames.get(id) ?? snapshot ?? '' } : null;
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    origin: row.origin,
    version: row.version,
    store: { id: row.storeId, name: storeName },
    site: row.site,
    sourceTicket: row.sourceTicketNumber,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    registeredBy: person(row.registeredById, row.registeredByName),
    owner: person(row.ownerId),
    feeDate: row.feeDate,
    completedAt: row.completedAt?.toISOString() ?? null,
    method: row.method,
    responsibility: row.responsibility,
    responsibilityReason: row.responsibilityReason,
    factory: row.factoryCode,
    part: row.partSku
      ? {
          sku: row.partSku,
          name: partNames.get(row.partSku) ?? null,
          quantity: row.partQuantity,
        }
      : null,
    shipper: row.shipper,
    carrier: row.carrier,
    shipDate: row.shipDate,
    trackingNumber: row.trackingNumber,
    claimTarget: row.claimTarget,
    claimStatus: row.claimStatus,
    fees: feesOf(row),
    ratios: ratiosOf(row),
    missing: missingOf(row),
    cancellation:
      row.status === 'cancelled' && row.cancelReason !== null && row.cancelledAt !== null
        ? { reason: row.cancelReason, at: row.cancelledAt.toISOString(), keptFees: keptFeesOf(row) }
        : null,
    updatedBy: row.updatedByName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------- 当月登记完整率（R-AS-08）

/** 当月 YYYY-MM（北京时间） */
export function businessMonth(now: Date): string {
  return businessDate(now).slice(0, 7);
}

function nextMonth(month: string): string {
  const [year = 0, mon = 0] = month.split('-').map(Number);
  return mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
}

/**
 * 计入某月完整率的单（R-AS-08）：当月（按完成时间，北京时间）已完成的单，历史导入不计。
 * 完成时间换成北京时间的本地时刻再比月份，日界不随 UTC 走。
 */
function completedIn(month: string): SQL | undefined {
  const local = sql`(${aftersales.completedAt} AT TIME ZONE ${BUSINESS_TIME_ZONE})`;
  return and(
    eq(aftersales.status, 'completed'),
    ne(aftersales.origin, 'history_import'),
    sql`${local} >= ${`${month}-01`}::timestamp`,
    sql`${local} < ${`${nextMonth(month)}-01`}::timestamp`,
  );
}

/** 店铺筛选（店铺范围由 scope 施加；筛选的店铺在范围内由接口先用 access.requireStores 把关） */
function storeFilter(store: string | undefined): SQL | undefined {
  return store ? eq(aftersales.storeId, store) : undefined;
}

/**
 * 当月登记完整率（R-AS-08）：当月已完成的单中适用字段齐全的单数 ÷ 当月已完成单数；只随店铺数据范围与店铺筛选变化，
 * 不随日期筛选。当月没有已完成的单时 completed 为 0（界面写「—」）。
 */
export async function completionOf(
  db: DbExecutor,
  scope: StoreScope,
  store: string | undefined,
  now: Date,
): Promise<Completion> {
  const month = businessMonth(now);
  const rows = await db
    .select()
    .from(aftersales)
    .where(
      and(storeScopeCondition(scope, aftersales.storeId), storeFilter(store), completedIn(month)),
    );
  return {
    month,
    completed: rows.length,
    complete: rows.filter((row) => missingOf(row).length === 0).length,
  };
}

/**
 * P13 台账（店铺范围内），按售后单号先后（原型 P13 的顺序：创建日期、全局序号）。
 * 筛选：店铺、费用发生日起止；missing 只列当月缺字段的已完成单（与完整率同口径，点页头完整率筛出）。
 */
export async function listLedger(
  db: DbExecutor,
  scope: StoreScope,
  query: LedgerQuery,
  now: Date,
): Promise<LedgerItem[]> {
  const rows = await db
    .select()
    .from(aftersales)
    .where(
      and(
        storeScopeCondition(scope, aftersales.storeId),
        storeFilter(query.store),
        query.from ? gte(aftersales.feeDate, query.from) : undefined,
        query.to ? lte(aftersales.feeDate, query.to) : undefined,
        query.missing ? completedIn(businessMonth(now)) : undefined,
      ),
    )
    .orderBy(asc(aftersales.number));
  const listed = query.missing ? rows.filter((row) => missingOf(row).length > 0) : rows;
  const names = await storeNamesById(
    db,
    listed.map((row) => row.storeId),
  );
  return listed.map((row) => toLedgerItem(row, names));
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
