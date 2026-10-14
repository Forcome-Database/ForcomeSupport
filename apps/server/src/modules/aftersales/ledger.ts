import { BUSINESS_TIME_ZONE, businessDate } from '@forcome/calendar';
import {
  costShares,
  defaultFeeDateRange,
  feeItems,
  missingFields,
  PENDING_OWNER,
  ratioPairsOf,
  type AftersalesDetail,
  type Completion,
  type FactoryRatios,
  type FeeDateRange,
  type FeeItem,
  type LedgerCost,
  type LedgerItem,
  type LedgerOptions,
  type LedgerQuery,
  type LedgerTotals,
  type OwnerOption,
  type Ratios,
  type RegistrationField,
  type RegistrationRecord,
} from '@forcome/contracts';
import Big from 'big.js';
import {
  and,
  asc,
  eq,
  getViewSelectedFields,
  gte,
  isNotNull,
  lte,
  min,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { storeNamesById } from '../channel';
import { isStoreInScope, storeScopeCondition, type DbExecutor, type StoreScope } from '../core';
import { listParts } from '../factory';
import { listAftersalesOwners, memberNamesById, type Access } from '../org';
import { feesOf } from './fees';
import { aftersales, aftersalesCost } from './schema';

/*
 * 登记台账 P13 的查询（店铺范围内，ADR 0010）：列表与合计行（筛选行的条件与「缺字段」筛选；每行计入售后成本的部分取
 * 售后成本视图）、当月登记完整率（R-AS-08）、一张单的完整登记（编辑登记抽屉）。导出用同一份列表（export.ts）。
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

/** 售后成本视图的一行（这张单计入售后成本的部分） */
export type CostRow = typeof aftersalesCost.$inferSelect;

/** 台账各行要显示的名字：店铺名、负责人姓名、配件名（按 ID 或 SKU 取） */
export interface LedgerNames {
  readonly stores: ReadonlyMap<string, string>;
  readonly members: ReadonlyMap<string, string>;
  readonly parts: ReadonlyMap<string, string>;
}

/** 取这些单要显示的名字（店铺、负责人、配件） */
export async function ledgerNamesOf(
  db: DbExecutor,
  rows: readonly AftersalesRow[],
): Promise<LedgerNames> {
  const [stores, members, parts] = await Promise.all([
    storeNamesById(
      db,
      rows.map((row) => row.storeId),
    ),
    memberNamesById(
      db,
      rows.flatMap((row) => (row.ownerId ? [row.ownerId] : [])),
    ),
    rows.some((row) => row.partSku) ? listParts(db) : Promise.resolve([]),
  ]);
  return { stores, members, parts: new Map(parts.map((part) => [part.sku, part.name])) };
}

/**
 * 一行计入售后成本的部分（售后成本视图）与两方承担：费用合计取视图，FSH / 工厂承担按计入的金额与三组比例逐行算
 * （contracts 的 costShares，R-AS-08）
 */
export function ledgerCostOf(row: AftersalesRow, cost: CostRow): LedgerCost {
  const counted: Record<FeeItem, string | null> = {
    productCost: cost.productCostUsd,
    freight: cost.freightUsd,
    compensation: cost.compensationUsd,
    otherCost: cost.otherCostUsd,
  };
  const { fsh, factory } = costShares(counted, factoryRatiosOfRow(row));
  return { ...counted, total: cost.totalUsd, fsh, factory };
}

/** 台账的一行；财务字段由接口按查看者的权限过滤（stripFinanceFields） */
export function toLedgerItem(row: AftersalesRow, cost: CostRow, names: LedgerNames): LedgerItem {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    origin: row.origin,
    customerName: row.customerName,
    store: { id: row.storeId, name: names.stores.get(row.storeId) ?? '' },
    site: row.site,
    method: row.method,
    responsibility: row.responsibility,
    factory: row.factoryCode,
    part: row.partSku
      ? {
          sku: row.partSku,
          name: names.parts.get(row.partSku) ?? null,
          quantity: row.partQuantity,
        }
      : null,
    trackingNumber: row.trackingNumber,
    feeDate: row.feeDate,
    registeredById: row.registeredById,
    ownerId: row.ownerId,
    ownerName: row.ownerId ? (names.members.get(row.ownerId) ?? null) : null,
    ownerPending: isOwnerPending(row),
    missing: missingOf(row),
    version: row.version,
    fees: feesOf(row),
    ratios: ratiosOf(row),
    cost: ledgerCostOf(row, cost),
    keptFees: row.status === 'cancelled' ? keptFeesOf(row) : null,
  };
}

/**
 * 一张单的台账行（新建登记、设为已完成、取消等接口返回刚改过的这一行）：这张单已由调用方在店铺范围内取到，
 * 读视图时照样施加店铺范围（ADR 0010：读视图都显式施加）
 */
export async function ledgerItemOf(
  db: DbExecutor,
  scope: StoreScope,
  row: AftersalesRow,
): Promise<LedgerItem> {
  const [[cost], names] = await Promise.all([
    db
      .select()
      .from(aftersalesCost)
      .where(
        and(
          eq(aftersalesCost.aftersalesId, row.id),
          storeScopeCondition(scope, aftersalesCost.storeId),
        ),
      ),
    ledgerNamesOf(db, [row]),
  ]);
  if (!cost) throw new Error(`售后单 ${row.number} 不在售后成本视图里`);
  return toLedgerItem(row, cost, names);
}

/** 合计行：各金额列之和（计入售后成本的部分；FSH / 工厂承担为各行之和，比例没登记的行不计） */
export function ledgerTotalsOf(items: readonly LedgerItem[]): LedgerTotals {
  const sum = (pick: (cost: LedgerCost) => string | null) =>
    items
      .reduce((total, item) => total.plus(item.cost ? (pick(item.cost) ?? 0) : 0), new Big(0))
      .toFixed(2);
  return {
    count: items.length,
    productCost: sum((cost) => cost.productCost),
    freight: sum((cost) => cost.freight),
    compensation: sum((cost) => cost.compensation),
    otherCost: sum((cost) => cost.otherCost),
    total: sum((cost) => cost.total),
    fsh: sum((cost) => cost.fsh),
    factory: sum((cost) => cost.factory),
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

/**
 * 售后负责人在查看者店铺范围内的那部分：查看者只能给自己范围内的店铺登记，候选人的范围只需要（也只该）露出这部分；
 * 与查看者的范围没有交集的售后负责人不列出
 */
export function ownerWithinScope(owner: OwnerOption, scope: StoreScope): OwnerOption | null {
  if (scope.all) return owner;
  const storeIds = owner.stores.all
    ? [...scope.storeIds]
    : owner.stores.storeIds.filter((id) => isStoreInScope(scope, id));
  return storeIds.length > 0 ? { ...owner, stores: { all: false, storeIds } } : null;
}

/**
 * P13 筛选行的选项：负责人筛选列出查看者店铺范围内在职的售后负责人（与新建登记的可选负责人同一批人；「待分配」是界面固定的一项）
 */
export async function ledgerOptions(db: DbExecutor, scope: StoreScope): Promise<LedgerOptions> {
  const owners = await listAftersalesOwners(db);
  return {
    owners: owners.flatMap((owner) =>
      ownerWithinScope(owner, scope) ? [{ id: owner.id, name: owner.name }] : [],
    ),
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

/** 默认的费用发生日：本月（北京时间当月 1 日至今天，按注入的时钟） */
export function defaultFeeDateRangeAt(now: Date): FeeDateRange {
  return defaultFeeDateRange(businessDate(now));
}

/**
 * 待分配的单（钉钉离职进入改派队列，待办 23）：已取消的不算（终态、没有可做的事，标记只作历史保留；协调者 2026-10-14 决定 R1），
 * 已完成的仍算（可改派）
 */
const pendingOwner = and(
  isNotNull(aftersales.reassignQueuedAt),
  ne(aftersales.status, 'cancelled'),
);

/** 这一行是不是待分配（同上） */
export function isOwnerPending(row: Pick<AftersalesRow, 'reassignQueuedAt' | 'status'>): boolean {
  return row.reassignQueuedAt !== null && row.status !== 'cancelled';
}

/**
 * 这次按的费用发生日起止：没给的一端取本月的那一端（北京时间，按注入的时钟；S13 补充小样）；筛出缺字段时不按日期，为 null。
 * 负责人选「待分配」且没给起始日时，从（店铺范围与店铺筛选内）待分配单里最早的费用发生日起，队列里的单都列得出来
 * （协调者 2026-10-14 决定 Q6）；没有待分配的单时照常取本月 1 日
 */
export async function feeDateRangeOf(
  db: DbExecutor,
  scope: StoreScope,
  query: LedgerQuery,
  now: Date,
): Promise<FeeDateRange | null> {
  if (query.missing) return null;
  const fallback = defaultFeeDateRangeAt(now);
  let from = query.from ?? fallback.from;
  if (query.owner === PENDING_OWNER && !query.from) {
    const [earliest] = await db
      .select({ feeDate: min(aftersales.feeDate) })
      .from(aftersales)
      .where(
        and(storeScopeCondition(scope, aftersales.storeId), storeFilter(query.store), pendingOwner),
      );
    if (earliest?.feeDate && earliest.feeDate <= fallback.to) from = earliest.feeDate;
  }
  return { from, to: query.to ?? fallback.to };
}

/** 筛选行的条件（费用发生日起止、处理方式、责任、状态、负责人；店铺另行施加） */
function rowFilters(query: LedgerQuery, range: FeeDateRange): (SQL | undefined)[] {
  return [
    gte(aftersalesCost.feeDate, range.from),
    lte(aftersalesCost.feeDate, range.to),
    query.method ? eq(aftersales.method, query.method) : undefined,
    query.responsibility ? eq(aftersales.responsibility, query.responsibility) : undefined,
    query.status ? eq(aftersales.status, query.status) : undefined,
    query.owner === PENDING_OWNER
      ? pendingOwner
      : query.owner
        ? eq(aftersales.ownerId, query.owner)
        : undefined,
  ];
}

/**
 * P13 台账（店铺范围内）与合计行，按售后单号先后（原型 P13 的顺序：创建日期、全局序号）。
 * 每行连同它在售后成本视图里的一行一起取（R-AS-08：计入售后成本的部分，合计按它求和，与 P17 同一个视图，AC-RP-01）；
 * 店铺范围施加在视图的店铺上。筛选：费用发生日起止（没给的一端取本月）、店铺、处理方式、责任、状态、负责人；missing 只列当月缺字段的
 * 已完成单（与完整率同口径，点页头完整率筛出：只随店铺，不叠其余条件）。
 */
export async function listLedger(
  db: DbExecutor,
  scope: StoreScope,
  query: LedgerQuery,
  now: Date,
): Promise<{ items: LedgerItem[]; totals: LedgerTotals; range: FeeDateRange | null }> {
  const range = await feeDateRangeOf(db, scope, query, now);
  const rows = await db
    .select({ row: aftersales, cost: getViewSelectedFields(aftersalesCost) })
    .from(aftersales)
    .innerJoin(aftersalesCost, eq(aftersalesCost.aftersalesId, aftersales.id))
    .where(
      and(
        storeScopeCondition(scope, aftersalesCost.storeId),
        query.store ? eq(aftersalesCost.storeId, query.store) : undefined,
        ...(range ? rowFilters(query, range) : [completedIn(businessMonth(now))]),
      ),
    )
    .orderBy(asc(aftersales.number));
  const listed = query.missing ? rows.filter(({ row }) => missingOf(row).length > 0) : rows;
  const names = await ledgerNamesOf(
    db,
    listed.map(({ row }) => row),
  );
  const items = listed.map(({ row, cost }) => toLedgerItem(row, cost, names));
  return { items, totals: ledgerTotalsOf(items), range };
}

/**
 * 按售后单号取一张查看或要改的单：不在查看者的店铺范围内时记越权审计并 403（E-24），没有这张单为 null。
 * 越权审计单独提交，不随业务事务回滚，所以在写事务之外调用。
 */
export function findOwnedAftersales(
  db: DbExecutor,
  access: Access,
  number: string,
): Promise<AftersalesRow | null> {
  return access.findOwned(
    (scope) => findAftersales(db, scope, number),
    (row) => ({
      storeIds: [row.storeId],
      objectType: 'aftersales',
      objectId: row.id,
      objectLabel: row.number,
    }),
  );
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
