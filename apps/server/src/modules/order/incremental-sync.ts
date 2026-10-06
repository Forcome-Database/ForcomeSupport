import type { AdapterMode, Platform } from '@forcome/contracts';
import { transaction, type DbExecutor, type Logger, type Runtime, type Tx } from '../core';
import { ClientNotConfiguredError, ExternalServiceError } from '../integration';
import { noWrites, type MirrorWrites } from './mirror';
import type { OrderSource } from './schema';
import { orderSyncWatermark, recordOrderSyncFailure, recordOrderSyncSuccess } from './sync-health';

/*
 * 按平台更新时间的增量同步（Shopify 待办 11、亚马逊待办 12 共用；ADR 0011 修订）：
 * 1. 从水位（已写进镜像的订单里最晚的平台更新时间）往前重叠一段起，分页取平台更新时间不早于它的订单（平台的搜索索引稍有延迟也不漏）；
 * 2. 每页在一个事务里写进镜像（只进不退、不产生重复行），全部写完后才推进水位并记同步成功（水位只在持久化成功后推进）；
 *    第一次同步从此刻起（之前的历史订单由回补导入，13）；
 * 3. 外部调用失败记进同步记录（sync-health.ts）：连续 3 次为连接异常（通知、审计、全站横幅），之后同步成功即恢复；
 * 4. 没配置凭据（ClientNotConfiguredError，用户 2026-10-04 口径）不算失败、什么也不记，店铺为未连接；
 * 5. 这一轮期间店铺换了数据源（同步记录已按新配置清掉）：旧配置的结果不记，下一轮按新配置从头同步。
 */

/** 订单同步要知道的店铺（channel 的店铺配置，由组装根注入，order 不依赖 channel） */
export interface OrderStore {
  readonly id: string;
  readonly name: string;
  readonly platform: Platform;
  /** 平台标识：亚马逊卖家 ID / Shopify 店铺域名（<名字>.myshopify.com） */
  readonly platformId: string;
  readonly adapterMode: AdapterMode;
}

/** 全部店铺（按建立先后）；组装根注入 channel 的查询 */
export type OrderStoreSource = (db: DbExecutor) => Promise<readonly OrderStore[]>;

/** 一个平台的增量取法 */
export interface IncrementalFeed<O> {
  readonly source: OrderSource;
  /** 日志里的平台名 */
  readonly label: string;
  /** 每次从水位往前多取这么久 */
  readonly overlapMs: number;
  /** 取一页：平台更新时间不早于 since 的订单；cursor 为上一页给的游标（第一页为 null） */
  page(
    since: Date,
    cursor: string | null,
  ): Promise<{ readonly orders: readonly O[]; readonly next: string | null }>;
  updatedAt(order: O): Date;
  mirror(tx: Tx, storeId: string, orders: readonly O[], writes: MirrorWrites): Promise<void>;
}

/** 某平台的店铺 */
export async function storesOf(
  db: DbExecutor,
  stores: OrderStoreSource,
  platform: Platform,
): Promise<OrderStore[]> {
  return (await stores(db)).filter((store) => store.platform === platform);
}

/** 店铺的平台、平台标识或数据来源与这一轮开始时不同了（或店铺已不在） */
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

/**
 * 外部调用的失败记进同步记录（连续 3 次为连接异常）。我们自己的错误不算；没配置凭据也不算（还没接通，6.9 的「未连接」）。
 * 记录本身出错只记日志，不盖掉原来的错误
 */
async function noteFailure(
  runtime: Runtime,
  store: OrderStore,
  source: OrderSource,
  label: string,
  error: unknown,
  logger: Logger,
): Promise<void> {
  if (!(error instanceof ExternalServiceError) || error instanceof ClientNotConfiguredError) {
    return;
  }
  try {
    const failures = await recordOrderSyncFailure(runtime, store, error, source);
    logger.warn({ err: error, store: store.name, failures }, `${label} 调用失败，已记入同步记录`);
  } catch (recordError) {
    logger.error({ err: recordError, store: store.name }, '记同步失败时出错');
  }
}

/** 同步一个店铺（增量）。外部调用失败记进同步记录后照常抛出（任务失败）；没配置凭据安静结束 */
export async function syncIncrementally<O>(
  runtime: Runtime,
  logger: Logger,
  stores: OrderStoreSource,
  store: OrderStore,
  feed: IncrementalFeed<O>,
): Promise<void> {
  const startedAt = runtime.clock.now();
  const watermark = await orderSyncWatermark(runtime.db, store.id, feed.source);
  const since = new Date((watermark ?? startedAt).getTime() - feed.overlapMs);
  const writes = noWrites();
  let newest = watermark;
  try {
    let cursor: string | null = null;
    do {
      const page = await feed.page(since, cursor);
      await transaction(runtime, (tx) => feed.mirror(tx, store.id, page.orders, writes));
      for (const order of page.orders) {
        const updatedAt = feed.updatedAt(order);
        if (!newest || updatedAt > newest) newest = updatedAt;
      }
      cursor = page.next;
    } while (cursor);
  } catch (error) {
    if (error instanceof ClientNotConfiguredError) {
      logger.debug(
        { store: store.name },
        `没有配置 ${feed.label} 凭据，订单不同步（店铺为未连接）`,
      );
      return;
    }
    if (await configChanged(runtime.db, stores, store)) throw error;
    await noteFailure(runtime, store, feed.source, feed.label, error, logger);
    throw error;
  }
  if (await configChanged(runtime.db, stores, store)) {
    logger.info({ store: store.name }, '同步期间店铺的数据源改了，这一轮的结果不记进同步记录');
    return;
  }
  // 第一次同步、一笔也没有：水位从开始同步的时刻起
  await transaction(runtime, (tx) =>
    recordOrderSyncSuccess(tx, store, newest ?? startedAt, writes, feed.source),
  );
}
