import { platforms } from '@forcome/contracts';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { amount, currency, primaryId, timestamptz } from '../core';

/**
 * order 模块的数据库 schema（一个模块一个 schema，ADR 0006）；表随各期待办加入。
 * 注意 order 是 SQL 保留字：drizzle 会自动加引号，手写 SQL（如报表视图）必须写成 "order"。
 */
export const orderSchema = pgSchema('order');

/** 镜像里的一个商品行 */
export interface MirroredLineItem {
  readonly title: string;
  readonly sku: string | null;
  readonly quantity: number;
}

/** 镜像里的收件地址（Shopify 有街道与邮编；亚马逊非受限角色只有城市、州、国家，随 12） */
export interface MirroredAddress {
  readonly name: string | null;
  readonly address1: string | null;
  readonly address2: string | null;
  readonly city: string | null;
  readonly province: string | null;
  readonly zip: string | null;
  readonly country: string | null;
  readonly phone: string | null;
}

/** 镜像里的一个履约单号 */
export interface MirroredTracking {
  readonly company: string | null;
  readonly number: string | null;
}

/**
 * 本地订单镜像（规格 order、ADR 0011，待办 11 起）：平台订单的快照，一笔订单一行，以「店铺 + 平台订单号」为关联键
 * （Shopify 为 Admin API 的全局 ID），Shopify 另存订单名（店铺内唯一，来信里写的是它）。同步按平台更新时间只进不退：
 * 拉到的版本比镜像里的旧就不改。亚马逊（MFN/AFN、承诺时效等）随 12 加列。
 */
export const platformOrder = orderSchema.table(
  'platform_order',
  {
    id: primaryId(),
    storeId: uuid('store_id').notNull(),
    platform: text('platform', { enum: platforms }).notNull(),
    /** 平台订单号：Shopify 的 gid://shopify/Order/<数字>，亚马逊的 AmazonOrderId（12） */
    platformOrderId: text('platform_order_id').notNull(),
    /** 订单名（Shopify 如 #1063）；亚马逊没有 */
    name: text('name'),
    /** 平台的订单状态：Shopify 为履约状态（displayFulfillmentStatus，如 FULFILLED） */
    status: text('status').notNull(),
    /** 付款状态（Shopify displayFinancialStatus，如 PAID、REFUNDED） */
    financialStatus: text('financial_status'),
    cancelledAt: timestamptz('cancelled_at'),
    lineItems: jsonb('line_items').$type<MirroredLineItem[]>().notNull(),
    totalAmount: amount('total_amount').notNull(),
    totalCurrency: currency('total_currency').notNull(),
    /** 客户邮箱（小写；亚马逊非受限角色读不到，为空）：Shopify 来信按它反查订单（R-TK-02，14） */
    customerEmail: text('customer_email'),
    /** 收件国家代码（US / CA / MX…）：Shopify 工单按它定站点（14） */
    shipCountry: text('ship_country'),
    shipAddress: jsonb('ship_address').$type<MirroredAddress>(),
    /** 履约单号（承运商 + 单号） */
    tracking: jsonb('tracking').$type<MirroredTracking[]>().notNull(),
    /** 下单时间（平台） */
    placedAt: timestamptz('placed_at').notNull(),
    /** 平台更新时间：增量同步的水位，镜像只进不退 */
    platformUpdatedAt: timestamptz('platform_updated_at').notNull(),
    /** 最近一次写入镜像的时间 */
    syncedAt: timestamptz('synced_at').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('platform_order_store_order_key').on(t.storeId, t.platformOrderId),
    uniqueIndex('platform_order_store_name_key')
      .on(t.storeId, t.name)
      .where(sql`${t.name} is not null`),
    index('platform_order_store_email_idx').on(t.storeId, t.customerEmail),
  ],
);

/** 数据源：Shopify 订单（11）；亚马逊订单随 12 */
export const orderSources = ['shopify_orders'] as const;
export type OrderSource = (typeof orderSources)[number];

/**
 * 订单同步记录（PRD 6.9，待办 11）：每个店铺 × 数据源一行。增量水位（平台更新时间，只在这一轮全部写进镜像后才推进）、
 * 最近一次同步成功的时间与连续失败的次数——连接状态按它算（contracts 的 syncConnectionStatus：连续 3 次失败为连接异常，
 * 从没成功过为未连接，超过 10 分钟没同步成功为同步延迟）。按店铺 ID 关联、不设外键（同 Gmail 的同步记录）。
 */
export const orderSync = orderSchema.table(
  'order_sync',
  {
    id: primaryId(),
    storeId: uuid('store_id').notNull(),
    source: text('source', { enum: orderSources }).notNull(),
    /** 增量水位：已写进镜像的订单里最晚的平台更新时间；第一次同步从开始同步的时刻起 */
    watermark: timestamptz('watermark'),
    lastSuccessAt: timestamptz('last_success_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** 这一串连续失败的第 1 次（卡片「10:05 起连续 3 次」、横幅的时刻） */
    failingSince: timestamptz('failing_since'),
    /** 最近一次失败的原因（排错用） */
    lastError: text('last_error'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [unique('order_sync_store_source_key').on(t.storeId, t.source)],
);
