import type { Currency, Platform } from '@forcome/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { storeScopeCondition, type DbExecutor, type StoreScope, type Tx } from '../core';
import type { AmazonOrder, ShopifyOrder } from '../integration';
import {
  platformOrder,
  type FulfillmentChannel,
  type MirroredAddress,
  type MirroredLineItem,
  type MirroredTracking,
} from './schema';

/*
 * 订单镜像的写入与查询（规格 order「本地订单镜像」，待办 11；亚马逊订单待办 12）：
 * - 写入按「店铺 + 平台订单号」upsert，只进不退：拉到的版本的平台更新时间不比镜像里的新就不改（重复拉取、回补与增量交错都不产生
 *   重复行，也不会用旧版本盖掉新版本）；同一版本（平台更新时间相同）而内容不一样时以平台为准改正（夜间对账靠它改正镜像，待办 13）；
 * - 查询都带店铺范围（ADR 0010）：系统操作（同步、归并）用 SYSTEM_STORE_SCOPE，接口里用成员的范围。
 */

/** 镜像里的一笔订单（对外的形状） */
export interface MirroredOrder {
  readonly id: string;
  readonly storeId: string;
  readonly platform: Platform;
  /** 平台订单号（Shopify 为 Admin API 的全局 ID，亚马逊为 AmazonOrderId） */
  readonly platformOrderId: string;
  /** 订单名（Shopify 如 #1063） */
  readonly name: string | null;
  /** 平台的订单状态（Shopify 为履约状态，如 FULFILLED；亚马逊为 fulfillmentStatus，如 SHIPPED） */
  readonly status: string;
  readonly financialStatus: string | null;
  readonly cancelledAt: Date | null;
  readonly lineItems: readonly MirroredLineItem[];
  /** 订单金额；亚马逊待付款的订单还没有，为 null */
  readonly total: { readonly amount: string; readonly currency: Currency } | null;
  readonly customerEmail: string | null;
  /** 收件国家代码（US / CA / MX…） */
  readonly shipCountry: string | null;
  readonly shipAddress: MirroredAddress | null;
  readonly tracking: readonly MirroredTracking[];
  /** 亚马逊的履约方 MFN / AFN；Shopify 为 null */
  readonly fulfillmentChannel: FulfillmentChannel | null;
  /** 亚马逊的承诺发货、送达时限；Shopify 为 null */
  readonly promisedShipBy: Date | null;
  readonly promisedDeliveryBy: Date | null;
  readonly placedAt: Date;
  readonly platformUpdatedAt: Date;
  readonly syncedAt: Date;
}

type Row = typeof platformOrder.$inferSelect;

function toMirrored(row: Row): MirroredOrder {
  return {
    id: row.id,
    storeId: row.storeId,
    platform: row.platform,
    platformOrderId: row.platformOrderId,
    name: row.name,
    status: row.status,
    financialStatus: row.financialStatus,
    cancelledAt: row.cancelledAt,
    lineItems: row.lineItems,
    total:
      row.totalAmount !== null && row.totalCurrency !== null
        ? { amount: row.totalAmount, currency: row.totalCurrency }
        : null,
    customerEmail: row.customerEmail,
    shipCountry: row.shipCountry,
    shipAddress: row.shipAddress,
    tracking: row.tracking,
    fulfillmentChannel: row.fulfillmentChannel,
    promisedShipBy: row.promisedShipBy,
    promisedDeliveryBy: row.promisedDeliveryBy,
    placedAt: row.placedAt,
    platformUpdatedAt: row.platformUpdatedAt,
    syncedAt: row.syncedAt,
  };
}

/** 这一轮写入镜像的结果：新增或改了几笔、平台更新时间的起止（恢复通知与审计「补拉 N 笔订单」） */
export interface MirrorWrites {
  count: number;
  from: Date | null;
  to: Date | null;
}

export const noWrites = (): MirrorWrites => ({ count: 0, from: null, to: null });

/** upsert 时这一列换成拉到的版本（excluded 里同名的值；按列对象取列名，写错列编译不过） */
const excluded = (column: AnyPgColumn) => sql.raw(`excluded.${column.name}`);

type OrderField = keyof typeof platformOrder.$inferSelect;

/**
 * 一种平台的 upsert 规则：要与平台一致的字段（不含平台更新时间与写入时间）同时决定改哪些列与什么时候改——
 * 平台更新时间更新的照改；同一版本、但这些列与镜像里的不一样的也改（以平台为准，待办 13 的夜间对账）；更旧的版本一律不改（只进不退），
 * 同一版本内容一样也不改。一张清单生成两处，加列时不会只改了一边
 */
function upsertRule(fields: readonly OrderField[]) {
  const columns = fields.map((field) => platformOrder[field]);
  return {
    target: [platformOrder.storeId, platformOrder.platformOrderId],
    set: {
      ...Object.fromEntries(fields.map((field) => [field, excluded(platformOrder[field])])),
      platformUpdatedAt: excluded(platformOrder.platformUpdatedAt),
      syncedAt: excluded(platformOrder.syncedAt),
    },
    setWhere: sql`${platformOrder.platformUpdatedAt} < excluded.platform_updated_at or (
      ${platformOrder.platformUpdatedAt} = excluded.platform_updated_at
      and (${sql.join(columns, sql`, `)}) is distinct from (${sql.join(columns.map(excluded), sql`, `)})
    )`,
  };
}

/** Shopify 订单的 upsert：订单名、状态、付款、金额、邮箱、收件与单号 */
const SHOPIFY_UPSERT = upsertRule([
  'name',
  'status',
  'financialStatus',
  'cancelledAt',
  'lineItems',
  'totalAmount',
  'totalCurrency',
  'customerEmail',
  'shipCountry',
  'shipAddress',
  'tracking',
  'placedAt',
]);

/** 亚马逊订单的 upsert：状态、金额、收件、单号、履约方与承诺时效 */
const AMAZON_UPSERT = upsertRule([
  'status',
  'lineItems',
  'totalAmount',
  'totalCurrency',
  'shipCountry',
  'shipAddress',
  'tracking',
  'fulfillmentChannel',
  'promisedShipBy',
  'promisedDeliveryBy',
  'placedAt',
]);

/**
 * 把一笔 Shopify 订单写进镜像（只进不退）；返回是否新增或改了。邮箱存小写（R-ST-03 反查不分大小写）
 */
export async function upsertShopifyOrder(
  tx: Tx,
  storeId: string,
  order: ShopifyOrder,
): Promise<boolean> {
  const address = order.shippingAddress;
  const rows = await tx.db
    .insert(platformOrder)
    .values({
      storeId,
      platform: 'shopify',
      platformOrderId: order.id,
      name: order.name,
      status: order.fulfillmentStatus,
      financialStatus: order.financialStatus,
      cancelledAt: order.cancelledAt,
      lineItems: order.lineItems.map((item) => ({ ...item })),
      totalAmount: order.total.amount,
      totalCurrency: order.total.currency,
      customerEmail: order.email?.trim().toLowerCase() || null,
      shipCountry: address?.country ?? null,
      shipAddress: address ? { ...address } : null,
      tracking: order.tracking.map((t) => ({ ...t })),
      placedAt: order.createdAt,
      platformUpdatedAt: order.updatedAt,
      syncedAt: tx.now,
      createdAt: tx.now,
    })
    .onConflictDoUpdate(SHOPIFY_UPSERT)
    .returning({ id: platformOrder.id });
  return rows.length > 0;
}

/** 累计这一轮写入的一笔（平台更新时间的起止） */
function noteWrite(writes: MirrorWrites, updatedAt: Date): void {
  writes.count += 1;
  if (!writes.from || updatedAt < writes.from) writes.from = updatedAt;
  if (!writes.to || updatedAt > writes.to) writes.to = updatedAt;
}

/** 写进镜像并累计这一轮的结果 */
export async function mirrorShopifyOrders(
  tx: Tx,
  storeId: string,
  orders: readonly ShopifyOrder[],
  writes: MirrorWrites,
): Promise<void> {
  for (const order of orders) {
    if (await upsertShopifyOrder(tx, storeId, order)) noteWrite(writes, order.updatedAt);
  }
}

/** 履约方：MERCHANT 为 MFN（自发货），AMAZON 为 AFN（亚马逊配送） */
const FULFILLMENT_CHANNELS = { MERCHANT: 'MFN', AMAZON: 'AFN' } as const;

/**
 * 把一笔亚马逊订单写进镜像（只进不退，待办 12）；返回是否新增或改了。订单号就是平台订单号（来信里写的就是它），没有订单名；
 * 非受限角色读不到买家邮箱与姓名、街道，收件地址只写城市、州、邮编（美国站没有）、国家
 */
export async function upsertAmazonOrder(
  tx: Tx,
  storeId: string,
  order: AmazonOrder,
): Promise<boolean> {
  const shipTo = order.shipTo;
  const rows = await tx.db
    .insert(platformOrder)
    .values({
      storeId,
      platform: 'amazon',
      platformOrderId: order.orderId,
      name: null,
      status: order.status,
      financialStatus: null,
      cancelledAt: null,
      lineItems: order.items.map((item) => ({
        title: item.title,
        sku: item.sku,
        quantity: item.quantity,
      })),
      totalAmount: order.total?.amount ?? null,
      totalCurrency: order.total?.currency ?? null,
      customerEmail: null,
      shipCountry: shipTo?.countryCode ?? null,
      shipAddress: shipTo
        ? {
            name: null,
            address1: null,
            address2: null,
            city: shipTo.city,
            province: shipTo.stateOrRegion,
            zip: shipTo.postalCode,
            country: shipTo.countryCode,
            phone: null,
          }
        : null,
      tracking: order.packages.map((p) => ({ company: p.carrier, number: p.trackingNumber })),
      fulfillmentChannel: order.fulfilledBy ? FULFILLMENT_CHANNELS[order.fulfilledBy] : null,
      promisedShipBy: order.shipBy,
      promisedDeliveryBy: order.deliverBy,
      placedAt: order.createdAt,
      platformUpdatedAt: order.updatedAt,
      syncedAt: tx.now,
      createdAt: tx.now,
    })
    .onConflictDoUpdate(AMAZON_UPSERT)
    .returning({ id: platformOrder.id });
  return rows.length > 0;
}

/** 亚马逊订单写进镜像并累计这一轮的结果 */
export async function mirrorAmazonOrders(
  tx: Tx,
  storeId: string,
  orders: readonly AmazonOrder[],
  writes: MirrorWrites,
): Promise<void> {
  for (const order of orders) {
    if (await upsertAmazonOrder(tx, storeId, order)) noteWrite(writes, order.updatedAt);
  }
}

/** 镜像里按订单名或平台订单号找一笔（店铺范围外的店铺找不到；同名的取平台更新时间最新的一笔） */
export async function mirroredOrder(
  db: DbExecutor,
  scope: StoreScope,
  storeId: string,
  ref: OrderRef,
): Promise<MirroredOrder | null> {
  const [row] = await db
    .select()
    .from(platformOrder)
    .where(
      and(
        eq(platformOrder.storeId, storeId),
        storeScopeCondition(scope, platformOrder.storeId),
        'name' in ref
          ? eq(platformOrder.name, ref.name)
          : eq(platformOrder.platformOrderId, ref.platformOrderId),
      ),
    )
    .orderBy(desc(platformOrder.platformUpdatedAt))
    .limit(1);
  return row ? toMirrored(row) : null;
}

/** 按什么找订单：订单名（Shopify，如 #1063）或平台订单号（亚马逊的订单号 3-7-7） */
export type OrderRef = { readonly name: string } | { readonly platformOrderId: string };

/**
 * 在某店铺内按客户邮箱反查订单（R-ST-03：只在指定店铺内匹配，不分大小写），按下单时间从新到旧。只查镜像，不补拉
 */
export async function findOrdersByEmail(
  db: DbExecutor,
  scope: StoreScope,
  query: { readonly storeId: string; readonly email: string },
): Promise<MirroredOrder[]> {
  const email = query.email.trim().toLowerCase();
  if (!email) return [];
  const rows = await db
    .select()
    .from(platformOrder)
    .where(
      and(
        eq(platformOrder.storeId, query.storeId),
        storeScopeCondition(scope, platformOrder.storeId),
        eq(platformOrder.customerEmail, email),
      ),
    )
    .orderBy(desc(platformOrder.placedAt), desc(platformOrder.id));
  return rows.map(toMirrored);
}
