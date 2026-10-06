import type { AdapterMode, Platform } from '@forcome/contracts';
import { z } from 'zod';
import {
  defineJob,
  isStoreInScope,
  transaction,
  type DbExecutor,
  type JobContext,
  type Logger,
  type Runtime,
  type StoreScope,
  type Tx,
} from '../core';
import {
  ClientNotConfiguredError,
  ExternalServiceError,
  shopifyClient,
  type IntegrationClients,
  type ShopifyClient,
} from '../integration';
import {
  mirroredOrder,
  mirrorShopifyOrders,
  noWrites,
  upsertShopifyOrder,
  type MirroredOrder,
  type OrderRef,
} from './mirror';
import { orderSyncWatermark, recordOrderSyncFailure, recordOrderSyncSuccess } from './sync-health';

/*
 * Shopify 订单同步（规格 order「Shopify：Admin GraphQL，每 1–2 分钟 updated_at 增量」，ADR 0008、0011，待办 11）：
 * 1. 定时任务 order.shopify_poll：每分钟给每个 Shopify 店铺排一次同步（worker 启动时也一次）；
 * 2. 任务 order.shopify_sync：从水位前 2 分钟起按平台更新时间分页取订单（重叠一段，平台的搜索索引稍有延迟也不漏），
 *    每页在一个事务里写进镜像（只进不退、不产生重复行），全部写完后才推进水位并记同步成功（水位只在持久化成功后推进）；
 *    第一次同步从此刻起（之前的历史订单由回补导入，13）；
 * 3. 外部调用失败记进同步记录（sync-health.ts）：连续 3 次为连接异常（通知、审计、全站横幅），之后同步成功即恢复；
 *    任务本身不重试，下一分钟的同步就是重试；
 * 4. 没配置 Shopify 凭据（ClientNotConfiguredError，用户 2026-10-04 口径）不算失败、什么也不记，店铺为未连接。
 * 镜像缺失时按订单名补拉（findOrder）；「测试连接」逐个店铺读店铺信息、测完排一次同步（testShopifyConnection）。
 */

/** 订单同步要知道的店铺（channel 的店铺配置，由组装根注入，order 不依赖 channel） */
export interface OrderStore {
  readonly id: string;
  readonly name: string;
  readonly platform: Platform;
  /** 平台标识：Shopify 店铺域名（<名字>.myshopify.com） */
  readonly platformId: string;
  readonly adapterMode: AdapterMode;
}

/** 全部店铺（按建立先后）；组装根注入 channel 的查询 */
export type OrderStoreSource = (db: DbExecutor) => Promise<readonly OrderStore[]>;

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

function shopifyFor(clients: IntegrationClients, store: OrderStore): ShopifyClient {
  return clients.forStore(shopifyClient, {
    id: store.id,
    adapterMode: store.adapterMode,
    platformId: store.platformId,
  });
}

async function shopifyStores(db: DbExecutor, stores: OrderStoreSource): Promise<OrderStore[]> {
  return (await stores(db)).filter((store) => store.platform === 'shopify');
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

/**
 * 外部调用的失败记进同步记录（连续 3 次为连接异常）。我们自己的错误不算；没配置凭据也不算（还没接通，6.9 的「未连接」）。
 * 记录本身出错只记日志，不盖掉原来的错误
 */
async function noteFailure(
  runtime: Runtime,
  store: OrderStore,
  error: unknown,
  logger: Logger,
): Promise<void> {
  if (!(error instanceof ExternalServiceError) || error instanceof ClientNotConfiguredError) {
    return;
  }
  try {
    const failures = await recordOrderSyncFailure(runtime, store, error);
    logger.warn({ err: error, store: store.name, failures }, 'Shopify 调用失败，已记入同步记录');
  } catch (recordError) {
    logger.error({ err: recordError, store: store.name }, '记同步失败时出错');
  }
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
  const shopify = shopifyFor(clients, store);
  const startedAt = runtime.clock.now();
  const watermark = await orderSyncWatermark(runtime.db, store.id);
  const since = new Date((watermark ?? startedAt).getTime() - SHOPIFY_SYNC_OVERLAP_MS);
  const writes = noWrites();
  let newest = watermark;
  try {
    let cursor: string | null = null;
    do {
      const page = await shopify.listOrders({ updatedSince: since, after: cursor });
      await transaction(runtime, (tx) => mirrorShopifyOrders(tx, store.id, page.orders, writes));
      for (const order of page.orders) {
        if (!newest || order.updatedAt > newest) newest = order.updatedAt;
      }
      cursor = page.nextCursor;
    } while (cursor);
  } catch (error) {
    if (error instanceof ClientNotConfiguredError) {
      logger.debug({ store: store.name }, '没有配置 Shopify 凭据，订单不同步（店铺为未连接）');
      return;
    }
    if (await configChanged(runtime.db, stores, store)) throw error;
    await noteFailure(runtime, store, error, logger);
    throw error;
  }
  // 这一轮期间店铺换了数据源（同步记录已按新配置清掉）：旧配置的结果不记，下一轮按新配置从头同步
  if (await configChanged(runtime.db, stores, store)) {
    logger.info({ store: store.name }, '同步期间店铺的数据源改了，这一轮的结果不记进同步记录');
    return;
  }
  // 第一次同步、一笔也没有：水位从开始同步的时刻起
  await transaction(runtime, (tx) =>
    recordOrderSyncSuccess(tx, store, newest ?? startedAt, writes),
  );
}

/** 店铺的平台、平台标识或数据来源与这一轮开始时不同了（或店铺已不是 Shopify 店铺） */
async function configChanged(
  db: DbExecutor,
  stores: OrderStoreSource,
  started: OrderStore,
): Promise<boolean> {
  const now = (await stores(db)).find((s) => s.id === started.id);
  return (
    !now ||
    now.platform !== started.platform ||
    now.platformId !== started.platformId ||
    now.adapterMode !== started.adapterMode
  );
}

/** Shopify 订单名的规范写法：只写了数字的补上 #（来信里常写成「order 1063」） */
export function normalizeShopifyOrderName(name: string): string {
  const trimmed = name.trim();
  return /^\d+$/.test(trimmed) ? `#${trimmed}` : trimmed;
}

/**
 * 在某店铺内按订单名或平台订单号查订单（规格 order 对外接口）：先查镜像；镜像没有、给的是订单名、店铺是 Shopify 时按订单名补拉并入库。
 * 店铺不在范围内、补拉也没有返回 null；没配置 Shopify 凭据时只查镜像。补拉的外部调用失败照常抛出（调用方决定稍后重试）
 */
export async function findOrder(
  runtime: Runtime,
  clients: IntegrationClients,
  scope: StoreScope,
  store: OrderStore,
  ref: OrderRef,
): Promise<MirroredOrder | null> {
  if (!isStoreInScope(scope, store.id)) return null;
  const lookup: OrderRef =
    'name' in ref && store.platform === 'shopify'
      ? { name: normalizeShopifyOrderName(ref.name) }
      : ref;
  const mirrored = await mirroredOrder(runtime.db, scope, store.id, lookup);
  if (mirrored || !('name' in lookup) || store.platform !== 'shopify') return mirrored;
  let fetched;
  try {
    fetched = await shopifyFor(clients, store).findOrderByName(lookup.name);
  } catch (error) {
    if (error instanceof ClientNotConfiguredError) return null;
    throw error;
  }
  if (!fetched) return null;
  await transaction(runtime, (tx) => upsertShopifyOrder(tx, store.id, fetched));
  return mirroredOrder(runtime.db, scope, store.id, lookup);
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
