import type { Currency, Platform } from '@forcome/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import { storeScopeCondition, type DbExecutor, type StoreScope, type Tx } from '../core';
import type { ShopifyOrder } from '../integration';
import {
  platformOrder,
  type MirroredAddress,
  type MirroredLineItem,
  type MirroredTracking,
} from './schema';

/*
 * 订单镜像的写入与查询（规格 order「本地订单镜像」，待办 11）：
 * - 写入按「店铺 + 平台订单号」upsert，只进不退：拉到的版本的平台更新时间不比镜像里的新就不改（重复拉取、回补与增量交错都不产生
 *   重复行，也不会用旧版本盖掉新版本）；
 * - 查询都带店铺范围（ADR 0010）：系统操作（同步、归并）用 SYSTEM_STORE_SCOPE，接口里用成员的范围。
 */

/** 镜像里的一笔订单（对外的形状） */
export interface MirroredOrder {
  readonly id: string;
  readonly storeId: string;
  readonly platform: Platform;
  /** 平台订单号（Shopify 为 Admin API 的全局 ID） */
  readonly platformOrderId: string;
  /** 订单名（Shopify 如 #1063） */
  readonly name: string | null;
  /** 平台的订单状态（Shopify 为履约状态，如 FULFILLED） */
  readonly status: string;
  readonly financialStatus: string | null;
  readonly cancelledAt: Date | null;
  readonly lineItems: readonly MirroredLineItem[];
  readonly total: { readonly amount: string; readonly currency: Currency };
  readonly customerEmail: string | null;
  /** 收件国家代码（US / CA / MX…） */
  readonly shipCountry: string | null;
  readonly shipAddress: MirroredAddress | null;
  readonly tracking: readonly MirroredTracking[];
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
    total: { amount: row.totalAmount, currency: row.totalCurrency },
    customerEmail: row.customerEmail,
    shipCountry: row.shipCountry,
    shipAddress: row.shipAddress,
    tracking: row.tracking,
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

/** 列名 → excluded 里同名的值（upsert 时整行换成拉到的版本） */
const excluded = (column: string) => sql.raw(`excluded.${column}`);

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
    .onConflictDoUpdate({
      target: [platformOrder.storeId, platformOrder.platformOrderId],
      set: {
        name: excluded('name'),
        status: excluded('status'),
        financialStatus: excluded('financial_status'),
        cancelledAt: excluded('cancelled_at'),
        lineItems: excluded('line_items'),
        totalAmount: excluded('total_amount'),
        totalCurrency: excluded('total_currency'),
        customerEmail: excluded('customer_email'),
        shipCountry: excluded('ship_country'),
        shipAddress: excluded('ship_address'),
        tracking: excluded('tracking'),
        placedAt: excluded('placed_at'),
        platformUpdatedAt: excluded('platform_updated_at'),
        syncedAt: excluded('synced_at'),
      },
      // 只进不退：同一版本（平台更新时间相同）或更旧的版本不改
      setWhere: sql`${platformOrder.platformUpdatedAt} < excluded.platform_updated_at`,
    })
    .returning({ id: platformOrder.id });
  return rows.length > 0;
}

/** 写进镜像并累计这一轮的结果 */
export async function mirrorShopifyOrders(
  tx: Tx,
  storeId: string,
  orders: readonly ShopifyOrder[],
  writes: MirrorWrites,
): Promise<void> {
  for (const order of orders) {
    if (!(await upsertShopifyOrder(tx, storeId, order))) continue;
    writes.count += 1;
    if (!writes.from || order.updatedAt < writes.from) writes.from = order.updatedAt;
    if (!writes.to || order.updatedAt > writes.to) writes.to = order.updatedAt;
  }
}

/** 镜像里按订单名或平台订单号找一笔（店铺范围外的店铺找不到） */
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
    .limit(1);
  return row ? toMirrored(row) : null;
}

/** 按什么找订单：订单名（Shopify，如 #1063）或平台订单号 */
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
