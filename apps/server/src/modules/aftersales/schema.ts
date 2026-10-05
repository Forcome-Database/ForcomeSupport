import {
  aftersalesOrigins,
  aftersalesStatuses,
  claimStatuses,
  claimTargets,
  feeItems,
  handlingMethods,
  responsibilities,
  shippers,
  sites,
  type FeeItem,
} from '@forcome/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgSchema,
  smallint,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { amount, feeChecks, feeColumns, primaryId, timestamptz, version } from '../core';

/** aftersales 模块的数据库 schema（一个模块一个 schema，ADR 0006）；表随各期待办加入 */
export const aftersalesSchema = pgSchema('aftersales');

/** 比例列：0–100 的整数（工厂一侧；FSH 一侧 = 100 − 工厂）。CHECK 遇到 NULL 视为通过，可空的列也适用 */
const pct = (name: string) => smallint(name);
const pctCheck = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} BETWEEN 0 AND 100`);

/**
 * 售后单（PRD 11.1 AfterSales；与第二期同一张表）。第一期的创建路径只有手工登记（新建登记，待办 19）与历史导入（27），
 * 状态只有 进行中 / 已完成 / 已取消（6.5「第一阶段台账状态」）；第二期的流程字段（分支、判定方式、比例与协商、
 * 结算状态与批次、当前环节、等待方、发起人）随第二期加列。
 * 字段按 R-AS-08 是否适用由新建登记的校验把关；历史导入的单可能缺字段（「历史导入」不计完整率），所以多数列可空。
 * 费用项一项一组列（core 的 feeColumns）：原币金额与币种、按费用发生日的汇率折算并冻结的美元值、汇率与汇率日期和来源
 * （待办 20）。
 * 店铺、负责人、登记人、来源工单、客户都是别的模块的 ID，跨模块不设外键（ADR 0005）。
 */
export const aftersales = aftersalesSchema.table(
  'aftersales',
  {
    id: primaryId(),
    /** 售后单号 S-创建日期-4 位全局序号（core 的 nextBusinessNumber） */
    number: text('number').notNull(),
    status: text('status', { enum: aftersalesStatuses }).notNull(),
    /** 创建路径：手工登记 / 历史导入 */
    origin: text('origin', { enum: aftersalesOrigins }).notNull(),
    storeId: uuid('store_id').notNull(),
    site: text('site', { enum: sites }),
    /** 来源工单（可不填）：工单 ID 与编号快照（编号不会变，台账与导出直接显示它） */
    sourceTicketId: uuid('source_ticket_id'),
    sourceTicketNumber: text('source_ticket_number'),
    orderNumber: text('order_number'),
    /** 客户：有来源工单时为工单的客户；第一期手工登记的客户是姓名文字（P06 客户档案随第二期） */
    customerId: uuid('customer_id'),
    customerName: text('customer_name'),
    /** 登记人（成员 ID 与姓名快照） */
    registeredById: uuid('registered_by_id'),
    registeredByName: text('registered_by_name'),
    /** 负责人：有该店铺数据范围的售后负责人（D-24） */
    ownerId: uuid('owner_id'),
    /** 费用发生日（北京时间的日期）：售后成本按它归期，汇率按它取（R-AS-08） */
    feeDate: date('fee_date', { mode: 'string' }),
    /** 完成时间：设为已完成时记（待办 21；撤销时清空），完整率按它归月（北京时间） */
    completedAt: timestamptz('completed_at'),
    /** 取消（已取消的单，AC-AS-16）：原因与时刻 */
    cancelReason: text('cancel_reason'),
    cancelledAt: timestamptz('cancelled_at'),
    method: text('method', { enum: handlingMethods }),
    responsibility: text('responsibility', { enum: responsibilities }),
    /** 责任理由（责任为「其他」时） */
    responsibilityReason: text('responsibility_reason'),
    /** 生产厂代码（任一组工厂比例大于 0 时） */
    factoryCode: text('factory_code'),
    partSku: text('part_sku'),
    partQuantity: smallint('part_quantity'),
    shipper: text('shipper', { enum: shippers }),
    carrier: text('carrier'),
    shipDate: date('ship_date', { mode: 'string' }),
    trackingNumber: text('tracking_number'),
    claimTarget: text('claim_target', { enum: claimTargets }),
    claimStatus: text('claim_status', { enum: claimStatuses }),
    // 四个费用项（键与 contracts 的 feeItems 一致）：原币金额与币种、冻结美元值、汇率与汇率日期和来源；
    // 下面的 feeChecks 逐项对应（CHECK 是表级约束，列助手里生成不了，所以两处各写一遍，键由类型检查对上）
    ...feeColumns('productCost', 'product_cost'),
    ...feeColumns('freight', 'freight'),
    ...feeColumns('compensation', 'compensation'),
    ...feeColumns('otherCost', 'other_cost'),
    /** 承担比例三组的工厂一侧（R-AS-02） */
    productFactoryPct: pct('product_factory_pct'),
    freightFactoryPct: pct('freight_factory_pct'),
    otherFactoryPct: pct('other_factory_pct'),
    // 取消时确认保留的已产生费用（一个费用项一列，键为 `${费用项}Kept`）：只在已取消的单上有值，没登记的项为空；
    // 保留的照常计入售后成本，没保留的不计（R-AS-08，售后成本视图随 22），原登记额仍在费用列里（悬停显示）
    productCostKept: boolean('product_cost_kept'),
    freightKept: boolean('freight_kept'),
    compensationKept: boolean('compensation_kept'),
    otherCostKept: boolean('other_cost_kept'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    /** 最近一次保存的人（姓名快照；系统写入为空），G7「这条记录刚被某人修改」用 */
    updatedByName: text('updated_by_name'),
    version: version(),
  },
  (t) => [
    unique('aftersales_number_key').on(t.number),
    index('aftersales_store_fee_date_idx').on(t.storeId, t.feeDate),
    // 当月登记完整率按完成时间取已完成的单（R-AS-08）
    index('aftersales_completed_at_idx').on(t.completedAt),
    pctCheck('aftersales_product_factory_pct_check', t.productFactoryPct),
    pctCheck('aftersales_freight_factory_pct_check', t.freightFactoryPct),
    pctCheck('aftersales_other_factory_pct_check', t.otherFactoryPct),
    check('aftersales_part_quantity_check', sql`${t.partQuantity} BETWEEN 1 AND 10`),
    // 6.5「第一阶段台账状态」：只有已完成的单有完成时间，只有已取消的单有取消原因、时刻与保留的费用项
    check(
      'aftersales_completed_at_check',
      sql`${t.status} = 'completed' OR ${t.completedAt} IS NULL`,
    ),
    check(
      'aftersales_cancellation_check',
      sql`${t.status} = 'cancelled' OR (${t.cancelReason} IS NULL AND ${t.cancelledAt} IS NULL
        AND ${t.productCostKept} IS NULL AND ${t.freightKept} IS NULL
        AND ${t.compensationKept} IS NULL AND ${t.otherCostKept} IS NULL)`,
    ),
    ...feeChecks('aftersales_product_cost', t, 'productCost'),
    ...feeChecks('aftersales_freight', t, 'freight'),
    ...feeChecks('aftersales_compensation', t, 'compensation'),
    ...feeChecks('aftersales_other_cost', t, 'otherCost'),
  ],
);

/** 视图里四个费用项的列名（与 feeItems 一一对应） */
const COST_COLUMNS: Record<FeeItem, string> = {
  productCost: 'product_cost_usd',
  freight: 'freight_usd',
  compensation: 'compensation_usd',
  otherCost: 'other_cost_usd',
};

/** 一个费用项计入售后成本的美元值：已取消的单只计确认保留的项（没保留的计 0），没登记的为空 */
function countedUsd(item: FeeItem): SQL {
  const usd = aftersales[`${item}Usd`];
  const kept = aftersales[`${item}Kept`];
  return sql`CASE WHEN ${aftersales.status} = 'cancelled' AND ${usd} IS NOT NULL AND ${kept} IS NOT TRUE THEN 0 ELSE ${usd} END AS ${sql.raw(COST_COLUMNS[item])}`;
}

/**
 * 售后成本视图（R-AS-08、AC-RP-01）：每张计入售后成本的售后单一行——全部非待确认的单（第一期没有「待确认」，即全部；
 * 第二期加了这个状态视图不用改），四个费用项按冻结的美元值，已取消的单只计取消时确认保留的部分，按费用发生日归期。
 * P13 的合计行（台账列表经它取每行计入的金额再求和）与 P17「售后成本按责任类型」（待办 25，report 经只读角色直读）
 * 共用这一个视图，两处的「费用合计」因此一致。只放售后成本的口径；承担金额按 contracts 的 costShares 逐行计算。
 * 读它的查询都要显式施加店铺范围（store_id；ADR 0010，报表绕过了仓储层的编译期保护）。
 */
export const aftersalesCost = aftersalesSchema
  .view('aftersales_cost', {
    aftersalesId: uuid('aftersales_id').notNull(),
    storeId: uuid('store_id').notNull(),
    feeDate: date('fee_date', { mode: 'string' }),
    responsibility: text('responsibility', { enum: responsibilities }),
    productCostUsd: amount('product_cost_usd'),
    freightUsd: amount('freight_usd'),
    compensationUsd: amount('compensation_usd'),
    otherCostUsd: amount('other_cost_usd'),
    /** 费用合计：四项计入的美元值之和（没登记的按 0） */
    totalUsd: amount('total_usd').notNull(),
  })
  .as(
    sql`SELECT aftersales_id, store_id, fee_date, responsibility,
  ${sql.raw(feeItems.map((item) => `${COST_COLUMNS[item]}::numeric(12, 2) AS ${COST_COLUMNS[item]}`).join(', '))},
  (${sql.raw(feeItems.map((item) => `coalesce(${COST_COLUMNS[item]}, 0)`).join(' + '))})::numeric(12, 2) AS total_usd
FROM (
  SELECT ${aftersales.id} AS aftersales_id, ${aftersales.storeId} AS store_id,
    ${aftersales.feeDate} AS fee_date, ${aftersales.responsibility} AS responsibility,
    ${sql.join(feeItems.map(countedUsd), sql`,\n    `)}
  FROM ${aftersales}
  WHERE ${aftersales.status} <> 'pending_confirmation'
) AS counted`,
  );

/**
 * 责任类型的默认承担比例（R-AS-02、D-19，客户确认 Q-03）：选责任类型后三组比例按它预填。
 * 参考数据，由迁移 0012 写入所有环境（ADR 0006 修订）；第二期 P23 维护（修改只影响新单）。
 */
export const responsibilityRatio = aftersalesSchema.table(
  'responsibility_ratio',
  {
    id: primaryId(),
    responsibility: text('responsibility', { enum: responsibilities }).notNull(),
    productFactoryPct: pct('product_factory_pct').notNull(),
    freightFactoryPct: pct('freight_factory_pct').notNull(),
    otherFactoryPct: pct('other_factory_pct').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: version(),
  },
  (t) => [
    unique('responsibility_ratio_responsibility_key').on(t.responsibility),
    pctCheck('responsibility_ratio_product_check', t.productFactoryPct),
    pctCheck('responsibility_ratio_freight_check', t.freightFactoryPct),
    pctCheck('responsibility_ratio_other_check', t.otherFactoryPct),
  ],
);
