import { isStoreInScope, type Runtime, type StoreScope } from '../core';
import { ClientNotConfiguredError, type IntegrationClients } from '../integration';
import { AMAZON_ORDER_ID, backfillAmazonOrder } from './amazon-sync';
import type { OrderStore } from './incremental-sync';
import { mirroredOrder, type MirroredOrder, type OrderRef } from './mirror';
import { backfillShopifyOrder } from './shopify-sync';

/*
 * 在某店铺内查订单（规格 order 对外接口，ADR 0011 修订；Shopify 待办 11、亚马逊待办 12）：先查镜像，镜像没有时按需补拉并入库——
 * - Shopify 按订单名（只写数字的补上 #，如来信里的「order 1063」）；按平台订单号（全局 ID）只查镜像；
 * - 亚马逊按订单号（3-7-7，给成 name 或 platformOrderId 都行）getOrder；不像亚马逊订单号的不调平台。
 * 店铺不在范围内返回 null、也不补拉（ADR 0010）；没配置凭据或还没录入卖家授权时只查镜像。补拉的外部调用失败照常抛出（调用方，
 * 14 的归并，决定稍后重试）；补拉的失败不计进连接状态（连接状态只看增量同步）。
 */

/** Shopify 订单名的规范写法：只写了数字的补上 #（来信里常写成「order 1063」） */
export function normalizeShopifyOrderName(name: string): string {
  const trimmed = name.trim();
  return /^\d+$/.test(trimmed) ? `#${trimmed}` : trimmed;
}

/** 按平台写成镜像里的查法：亚马逊的订单号就是平台订单号 */
function lookupOf(store: OrderStore, ref: OrderRef): OrderRef {
  if (!('name' in ref)) return { platformOrderId: ref.platformOrderId.trim() };
  return store.platform === 'shopify'
    ? { name: normalizeShopifyOrderName(ref.name) }
    : { platformOrderId: ref.name.trim() };
}

/** 镜像没有时去平台补拉：返回平台上有没有（补拉到就已写进镜像） */
async function backfill(
  runtime: Runtime,
  clients: IntegrationClients,
  store: OrderStore,
  lookup: OrderRef,
): Promise<boolean> {
  if (store.platform === 'shopify') {
    return 'name' in lookup && backfillShopifyOrder(runtime, clients, store, lookup.name);
  }
  return (
    'platformOrderId' in lookup &&
    AMAZON_ORDER_ID.test(lookup.platformOrderId) &&
    backfillAmazonOrder(runtime, clients, store, lookup.platformOrderId)
  );
}

export async function findOrder(
  runtime: Runtime,
  clients: IntegrationClients,
  scope: StoreScope,
  store: OrderStore,
  ref: OrderRef,
): Promise<MirroredOrder | null> {
  if (!isStoreInScope(scope, store.id)) return null;
  const lookup = lookupOf(store, ref);
  const mirrored = await mirroredOrder(runtime.db, scope, store.id, lookup);
  if (mirrored) return mirrored;
  try {
    if (!(await backfill(runtime, clients, store, lookup))) return null;
  } catch (error) {
    if (error instanceof ClientNotConfiguredError) return null;
    throw error;
  }
  return mirroredOrder(runtime.db, scope, store.id, lookup);
}
