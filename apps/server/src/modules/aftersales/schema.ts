import {
  aftersalesOrigins,
  aftersalesStatuses,
  claimStatuses,
  claimTargets,
  handlingMethods,
  responsibilities,
  shippers,
  sites,
} from '@forcome/contracts';
import { sql } from 'drizzle-orm';
import {
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
import { amount, currency, primaryId, timestamptz, version } from '../core';

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
 * 费用项先保存原币金额与币种；汇率、汇率日期与来源、冻结的美元值随待办 20 加列。
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
    /** 完成时间：设为已完成时记（21），完整率按它归月 */
    completedAt: timestamptz('completed_at'),
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
    productCost: amount('product_cost'),
    productCostCurrency: currency('product_cost_currency'),
    freight: amount('freight'),
    freightCurrency: currency('freight_currency'),
    compensation: amount('compensation'),
    compensationCurrency: currency('compensation_currency'),
    otherCost: amount('other_cost'),
    otherCostCurrency: currency('other_cost_currency'),
    /** 承担比例三组的工厂一侧（R-AS-02） */
    productFactoryPct: pct('product_factory_pct'),
    freightFactoryPct: pct('freight_factory_pct'),
    otherFactoryPct: pct('other_factory_pct'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: version(),
  },
  (t) => [
    unique('aftersales_number_key').on(t.number),
    index('aftersales_store_fee_date_idx').on(t.storeId, t.feeDate),
    pctCheck('aftersales_product_factory_pct_check', t.productFactoryPct),
    pctCheck('aftersales_freight_factory_pct_check', t.freightFactoryPct),
    pctCheck('aftersales_other_factory_pct_check', t.otherFactoryPct),
    check('aftersales_part_quantity_check', sql`${t.partQuantity} BETWEEN 1 AND 10`),
  ],
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
