import { z } from 'zod';
import {
  defineJob,
  transaction,
  type DbExecutor,
  type JobContext,
  type Logger,
  type Runtime,
  type Tx,
} from '../core';
import {
  shopifyClient,
  type IntegrationClients,
  type ShopifyClient,
  type ShopifyOrder,
} from '../integration';
import {
  storesOf,
  syncIncrementally,
  type IncrementalFeed,
  type OrderStore,
  type OrderStoreSource,
} from './incremental-sync';
import { mirrorShopifyOrders, upsertShopifyOrder } from './mirror';

/*
 * Shopify 订单同步（规格 order「Shopify：Admin GraphQL，每 1–2 分钟 updated_at 增量」，ADR 0008、0011，待办 11）：
 * 1. 定时任务 order.shopify_poll：每分钟给每个 Shopify 店铺排一次同步（worker 启动时也一次）；
 * 2. 任务 order.shopify_sync：从水位前 2 分钟起按平台更新时间分页取订单（重叠一段，平台的搜索索引稍有延迟也不漏），
 *    每页在一个事务里写进镜像（只进不退、不产生重复行），全部写完后才推进水位并记同步成功（水位只在持久化成功后推进）；
 *    第一次同步从此刻起（之前的历史订单由回补导入，13）；
 * 3. 外部调用失败记进同步记录（sync-health.ts）：连续 3 次为连接异常（通知、审计、全站横幅），之后同步成功即恢复；
 *    任务本身不重试，下一分钟的同步就是重试；
 * 4. 没配置 Shopify 凭据（ClientNotConfiguredError，用户 2026-10-04 口径）不算失败、什么也不记，店铺为未连接。
 * 镜像缺失时按订单名补拉（pullShopifyOrder，经 lookup.ts 的 findOrder）；「测试连接」逐个店铺读店铺信息、测完排一次同步
 * （testShopifyConnection）。增量的取法交给共用的 incremental-sync.ts。
 */

/** 每次从水位往前多取这么久（平台搜索索引的延迟、两边时钟的偏差） */
export const SHOPIFY_SYNC_OVERLAP_MS = 2 * 60_000;

/**
 * 同步一个店铺：每个店铺最多一个在排队、一个在跑（stately）；不重试，下一分钟的同步就是重试。每分钟给每个店铺各排一个，
 * 每个 worker 同时处理 5 个（店铺多时不排成长队，新编辑的店铺也能及时同步）
 */
export const SHOPIFY_SYNC_CONCURRENCY = 5;
export const shopifySyncJob = defineJob(
  'order.shopify_sync',
  z.object({ storeId: z.uuid() }),
  { policy: 'stately', retryLimit: 0 },
  undefined,
  SHOPIFY_SYNC_CONCURRENCY,
);

/** 每分钟给每个 Shopify 店铺排一次同步（规格「每 1–2 分钟」）；worker 启动时也一次 */
export const shopifyPollJob = defineJob(
  'order.shopify_poll',
  z.object({}),
  { policy: 'stately', retryLimit: 0 },
  { cron: '* * * * *', tz: 'Asia/Shanghai', runAtStartup: true },
);

/** 某 Shopify 店铺的 Admin API 客户端（回补与对账 sweep.ts 也用） */
export function shopifyFor(clients: IntegrationClients, store: OrderStore): ShopifyClient {
  return clients.forStore(shopifyClient, {
    id: store.id,
    adapterMode: store.adapterMode,
    platformId: store.platformId,
  });
}

function shopifyStores(db: DbExecutor, stores: OrderStoreSource): Promise<OrderStore[]> {
  return storesOf(db, stores, 'shopify');
}

/** 在事务里排一次某店铺的同步（新增或编辑店铺后立即同步，不等每分钟的定时）；已在排队的不重复排 */
export async function queueShopifySync(tx: Tx, storeId: string): Promise<void> {
  await tx.enqueue(shopifySyncJob, { storeId }, { singletonKey: storeId });
}

/** 每分钟：给每个 Shopify 店铺排一次同步 */
export async function pollShopifyStores(
  runtime: Runtime,
  stores: OrderStoreSource,
  logger: Logger,
): Promise<void> {
  const targets = await shopifyStores(runtime.db, stores);
  await transaction(runtime, async (tx) => {
    for (const store of targets) await queueShopifySync(tx, store.id);
  });
  logger.debug({ stores: targets.length }, '已排 Shopify 订单同步');
}

/** Shopify 的增量取法：按 updated_at 分页（sortKey UPDATED_AT），从水位前 2 分钟起 */
function shopifyFeed(shopify: ShopifyClient): IncrementalFeed<ShopifyOrder> {
  return {
    source: 'shopify_orders',
    label: 'Shopify',
    overlapMs: SHOPIFY_SYNC_OVERLAP_MS,
    page: async (since, cursor) => {
      const page = await shopify.listOrders({ updatedSince: since, after: cursor });
      return { orders: page.orders, next: page.nextCursor };
    },
    updatedAt: (order) => order.updatedAt,
    mirror: mirrorShopifyOrders,
  };
}

/** 同步一个店铺（增量）。外部调用失败记进同步记录后照常抛出（任务失败）；没配置凭据安静结束 */
export async function syncShopifyStore(
  clients: IntegrationClients,
  stores: OrderStoreSource,
  { storeId }: { storeId: string },
  { runtime, logger }: JobContext,
): Promise<void> {
  const store = (await shopifyStores(runtime.db, stores)).find((s) => s.id === storeId);
  if (!store) {
    logger.warn({ storeId }, '不是 Shopify 店铺（或已不存在），跳过订单同步');
    return;
  }
  await syncIncrementally(runtime, logger, stores, store, shopifyFeed(shopifyFor(clients, store)));
}

/**
 * 按订单名从 Shopify 补拉一笔并写进镜像（镜像缺失时，lookup.ts 的 findOrder 调用）；平台也没有返回 false。
 * 没配置凭据以 ClientNotConfiguredError 失败，其余外部调用失败照常抛出（调用方决定稍后重试）
 */
export async function pullShopifyOrder(
  runtime: Runtime,
  clients: IntegrationClients,
  store: OrderStore,
  name: string,
): Promise<boolean> {
  const fetched = await shopifyFor(clients, store).findOrderByName(name);
  if (!fetched) return false;
  await transaction(runtime, (tx) => upsertShopifyOrder(tx, store.id, fetched));
  return true;
}

/**
 * 「测试连接」（K20，协调者 2026-10-06 决定，套用 Gmail 的写法）：逐个 Shopify 店铺读店铺信息，看能不能访问；不改连接状态
 * （状态只看同步记录），测完立即给每个店铺排一次同步（「重新检测」立即重测并补拉）。返回能与不能访问的店铺名
 */
export async function testShopifyConnection(
  runtime: Runtime,
  clients: IntegrationClients,
  stores: OrderStoreSource,
  logger: Logger,
): Promise<{ reachable: string[]; unreachable: string[] }> {
  const reachable: string[] = [];
  const unreachable: string[] = [];
  for (const store of await shopifyStores(runtime.db, stores)) {
    try {
      await shopifyFor(clients, store).shop();
      reachable.push(store.name);
    } catch (error) {
      logger.warn({ err: error, store: store.name }, '测试连接：Shopify 店铺无法访问');
      unreachable.push(store.name);
    }
  }
  await pollShopifyStores(runtime, stores, logger);
  return { reachable, unreachable };
}
