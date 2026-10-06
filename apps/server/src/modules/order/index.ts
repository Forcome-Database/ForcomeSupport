// order：本地订单镜像：平台订单、发货与单号快照；镜像缺失时按订单号补拉（ADR 0011）（ADR 0005；第一期起）。
// 其他模块只能经本文件调用本模块，不能引用内部文件或读写本模块的表。
// 第一期：Shopify 订单镜像（待办 11）、亚马逊订单镜像（待办 12）、回补与夜间对账（待办 13）。order 不依赖 channel：店铺由调用方或组装根给出。
import { handleJob, type AnyJobHandler, type Feed } from '../core';
import type { IntegrationClients } from '../integration';
import {
  amazonOrderChangedJob,
  amazonPollJob,
  amazonSyncJob,
  createAmazonNotificationsFeed,
  fetchChangedOrder,
  pollAmazonStores,
  syncAmazonStore,
} from './amazon-sync';
import type { OrderStoreSource } from './incremental-sync';
import {
  pollShopifyStores,
  shopifyPollJob,
  shopifySyncJob,
  syncShopifyStore,
} from './shopify-sync';
import {
  orderReconcileJob,
  orderSweepPageJob,
  orderSweepResumeJob,
  resumeOrderSweeps,
  runOrderSweepPage,
  startOrderReconcile,
} from './sweep';

export {
  amazonOrderChangedJob,
  amazonPollJob,
  amazonSyncJob,
  queueAmazonSync,
  testAmazonConnection,
} from './amazon-sync';
export { type OrderStore, type OrderStoreSource } from './incremental-sync';
export { findOrder, normalizeShopifyOrderName } from './lookup';
export { findOrdersByEmail, type MirroredOrder, type OrderRef } from './mirror';
export { orderQueueState } from './queue-health';
export {
  queueShopifySync,
  shopifyPollJob,
  shopifySyncJob,
  testShopifyConnection,
} from './shopify-sync';
export {
  BACKFILL_DAYS,
  orderBackfills,
  orderReconcileJob,
  orderSweepPageJob,
  orderSweepResumeJob,
  startOrderBackfill,
  type BackfillStart,
  type OrderBackfill,
} from './sweep';
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
    handleJob(amazonPollJob, (_payload, { runtime, logger }) =>
      pollAmazonStores(runtime, deps.stores, logger),
    ),
    handleJob(amazonSyncJob, (payload, context) =>
      syncAmazonStore(deps.clients, deps.stores, payload, context),
    ),
    handleJob(amazonOrderChangedJob, (payload, context) =>
      fetchChangedOrder(deps.clients, deps.stores, payload, context),
    ),
    handleJob(orderSweepPageJob, (payload, context) =>
      runOrderSweepPage(deps.clients, deps.stores, payload, context),
    ),
    handleJob(orderSweepResumeJob, (_payload, { runtime }) => resumeOrderSweeps(runtime)),
    handleJob(orderReconcileJob, (_payload, { runtime, logger }) =>
      startOrderReconcile(runtime, deps.stores, logger),
    ),
  ];
}

/** order 的常驻拉取：亚马逊订单变化通知（SQS，独占） */
export function createOrderFeeds(deps: {
  clients: IntegrationClients;
  stores: OrderStoreSource;
}): Feed[] {
  return [createAmazonNotificationsFeed(deps.clients, deps.stores)];
}
