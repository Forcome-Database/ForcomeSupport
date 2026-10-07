import { fulfillmentChannels, platforms } from '@forcome/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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

/**
 * 镜像里的收件地址：Shopify 有街道与邮编；亚马逊非受限角色只有城市、州、国家（加拿大、墨西哥另有邮编），其余为 null（待办 12）
 */
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
 * （Shopify 为 Admin API 的全局 ID，亚马逊为 AmazonOrderId，来信里写的就是它），Shopify 另存订单名（平台保证店铺内唯一，来信里写的是它）。
 * 订单名只建普通索引、不加唯一约束：万一平台那边改名撞名，也不能让整页写入失败、同步卡住；按订单名查时取平台更新时间最新的一笔。
 * 同步按平台更新时间只进不退：拉到的版本比镜像里的旧就不改。亚马逊另有履约方（MFN/AFN）与承诺时效（待办 12）；
 * 亚马逊待付款等订单还没有金额，金额与币种可以为空（两列要么都有要么都没有）。
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
    /**
     * 平台的订单状态：Shopify 为履约状态（displayFulfillmentStatus，如 FULFILLED），亚马逊为 fulfillmentStatus（如 SHIPPED、CANCELLED）
     */
    status: text('status').notNull(),
    /** 付款状态（Shopify displayFinancialStatus，如 PAID、REFUNDED） */
    financialStatus: text('financial_status'),
    cancelledAt: timestamptz('cancelled_at'),
    lineItems: jsonb('line_items').$type<MirroredLineItem[]>().notNull(),
    /** 订单金额（Shopify 订单总额；亚马逊 proceeds.grandTotal，待付款的还没有，为空） */
    totalAmount: amount('total_amount'),
    totalCurrency: currency('total_currency'),
    /** 客户邮箱（小写；亚马逊非受限角色读不到，为空）：Shopify 来信按它反查订单（R-TK-02，14） */
    customerEmail: text('customer_email'),
    /** 收件国家代码（US / CA / MX…）：Shopify 工单按它定站点（14） */
    shipCountry: text('ship_country'),
    shipAddress: jsonb('ship_address').$type<MirroredAddress>(),
    /** 履约单号（承运商 + 单号；亚马逊为 MFN 包裹的单号，O-2 待实测） */
    tracking: jsonb('tracking').$type<MirroredTracking[]>().notNull(),
    /** 亚马逊的履约方 MFN 自发货 / AFN 亚马逊配送（PRD 1.4，待办 12；取值在 contracts，P05 订单卡同用）；Shopify 为空 */
    fulfillmentChannel: text('fulfillment_channel', { enum: fulfillmentChannels }),
    /** 亚马逊的承诺发货时限（shipByWindow 的最晚时刻）；Shopify 为空 */
    promisedShipBy: timestamptz('promised_ship_by'),
    /** 亚马逊的承诺送达时限（deliverByWindow 的最晚时刻）；Shopify 为空 */
    promisedDeliveryBy: timestamptz('promised_delivery_by'),
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
    index('platform_order_store_name_idx')
      .on(t.storeId, t.name)
      .where(sql`${t.name} is not null`),
    index('platform_order_store_email_idx').on(t.storeId, t.customerEmail),
    check(
      'platform_order_total_pair',
      sql`(${t.totalAmount} is null) = (${t.totalCurrency} is null)`,
    ),
  ],
);

/** 数据源：Shopify 订单（11）、亚马逊订单（12） */
export const orderSources = ['shopify_orders', 'amazon_orders'] as const;
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

/** 订单回补（按下单时间取近 90 天）与夜间对账（按平台更新时间取近 7 天），待办 13 */
export const orderSweepKinds = ['backfill', 'reconcile'] as const;
export type OrderSweepKind = (typeof orderSweepKinds)[number];

/**
 * 订单回补与夜间对账的进度（规格 order「回补 90 天…每天夜间对账近 7 天」，待办 13）：每个店铺 × 种类一行。
 * 回补按下单时间从 since 起分页取（90 天；Shopify 没开通 read_all_orders 时 60 天，historyLimited），对账按平台更新时间从 since 起
 * 分页取（近 7 天，每晚重来一次）；每取到一页，写进镜像与推进游标在同一个事务里——中断后从游标接着取，不重不漏。
 * completedAt 有值为已完成。按店铺 ID 关联、不设外键（同订单同步记录）；店铺换了数据源时清掉（resetOrderSync）。
 */
export const orderSweep = orderSchema.table(
  'order_sweep',
  {
    id: primaryId(),
    storeId: uuid('store_id').notNull(),
    kind: text('kind', { enum: orderSweepKinds }).notNull(),
    /** 窗口天数：回补 90（Shopify 没开通 read_all_orders 时 60），对账 7 */
    windowDays: integer('window_days').notNull(),
    /** 回补窗口因平台权限缩短了（Shopify 没开通 read_all_orders）：P18 写「未开通 read_all_orders」，报表注明（24） */
    historyLimited: boolean('history_limited').notNull().default(false),
    /** 从哪个时刻起取：回补为下单时间，对账为平台更新时间 */
    since: timestamptz('since').notNull(),
    /** 下一页的游标（平台的分页令牌）；null 为从第一页起 */
    cursor: text('cursor'),
    /** 拿到游标的时刻（亚马逊的分页令牌 24 小时过期，过期了从第一页重来） */
    cursorAt: timestamptz('cursor_at'),
    /** 已取的页数（排错用：docs/部署说明.md 15.3） */
    pages: integer('pages').notNull().default(0),
    /** 取到并写进镜像（只进不退）的订单数：P18「已回补 N 笔」 */
    orders: integer('orders').notNull().default(0),
    /** 镜像因此新增或改了的订单数（排错用：日志与 docs/部署说明.md 15.3；对账时即补上与改正的笔数） */
    changed: integer('changed').notNull().default(0),
    startedAt: timestamptz('started_at').notNull(),
    completedAt: timestamptz('completed_at'),
    /** 最近一次失败的原因（排错用；不算进连接状态） */
    lastError: text('last_error'),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [unique('order_sweep_store_kind_key').on(t.storeId, t.kind)],
);

/** 订单通知队列：亚马逊 ORDER_CHANGE 经 SQS（待办 12） */
export const orderQueues = ['amazon_orders'] as const;
export type OrderQueueName = (typeof orderQueues)[number];

/**
 * 订单通知队列的拉取与检查记录（PRD P18「第一阶段」亚马逊卡的 SQS 行，待办 12）：整个环境一个队列一行。长轮询拉取的连续失败次数
 * （连续 3 次为「拉取失败」，拉取成功清零）与每分钟检查一次的等待拉取的通知数（达到 10 条为「积压」）；只影响卡上的这一行，
 * 不进连接状态（contracts 的 orderQueueStatus）。
 */
export const orderQueue = orderSchema.table('order_queue', {
  id: primaryId(),
  name: text('name', { enum: orderQueues }).notNull().unique('order_queue_name_key'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  /** 这一串连续拉取失败的第 1 次 */
  failingSince: timestamptz('failing_since'),
  lastError: text('last_error'),
  /** 最近一次检查时等待拉取的通知数（SQS 的 ApproximateNumberOfMessages） */
  backlog: integer('backlog'),
  checkedAt: timestamptz('checked_at'),
  updatedAt: timestamptz('updated_at').notNull(),
});
