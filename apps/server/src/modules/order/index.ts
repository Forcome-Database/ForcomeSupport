// order：本地订单镜像：平台订单、发货与单号快照；镜像缺失时按订单号补拉（ADR 0011）（ADR 0005；第一期起）。
// 其他模块只能经本文件调用本模块，不能引用内部文件或读写本模块的表。
// 第一期：Shopify 订单镜像（待办 11）；亚马逊订单随 12，回补与夜间对账随 13。order 不依赖 channel：店铺由调用方或组装根给出。
import { handleJob, type AnyJobHandler } from '../core';
import type { IntegrationClients } from '../integration';
import {
  pollShopifyStores,
  shopifyPollJob,
  shopifySyncJob,
  syncShopifyStore,
  type OrderStoreSource,
} from './shopify-sync';

export { findOrdersByEmail, type MirroredOrder, type OrderRef } from './mirror';
export {
  findOrder,
  normalizeShopifyOrderName,
  queueShopifySync,
  shopifyPollJob,
  shopifySyncJob,
  testShopifyConnection,
  type OrderStore,
  type OrderStoreSource,
} from './shopify-sync';
export {
  orderSyncHealths,
  orderSyncStatus,
  resetOrderSync,
  type OrderSyncHealth,
} from './sync-health';

/** order 的后台任务处理器（由 apps/server/src/jobs.ts 汇总）；店铺由组装根注入 channel 的查询 */
export function createOrderJobHandlers(deps: {
  clients: IntegrationClients;
  stores: OrderStoreSource;
}): AnyJobHandler[] {
  return [
    handleJob(shopifyPollJob, (_payload, { runtime, logger }) =>
      pollShopifyStores(runtime, deps.stores, logger),
    ),
    handleJob(shopifySyncJob, (payload, context) =>
      syncShopifyStore(deps.clients, deps.stores, payload, context),
    ),
  ];
}
