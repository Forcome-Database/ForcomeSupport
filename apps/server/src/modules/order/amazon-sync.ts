import { ORDER_QUEUE_NAME } from '@forcome/contracts';
import { z } from 'zod';
import {
  defineFeed,
  defineJob,
  transaction,
  type DbExecutor,
  type Feed,
  type JobContext,
  type Logger,
  type Runtime,
  type Tx,
} from '../core';
import {
  amazonOrdersClient,
  amazonSqsClient,
  ClientNotConfiguredError,
  ExternalServiceError,
  type AmazonNotificationsClient,
  type AmazonOrder,
  type AmazonOrdersClient,
  type IntegrationClients,
} from '../integration';
import {
  storesOf,
  syncIncrementally,
  type IncrementalFeed,
  type OrderStore,
  type OrderStoreSource,
} from './incremental-sync';
import { mirrorAmazonOrders, upsertAmazonOrder } from './mirror';
import {
  clearQueueRecord,
  recordQueueBacklog,
  recordQueueReceiveFailure,
  recordQueueReceiveSuccess,
} from './queue-health';

/*
 * 亚马逊订单同步（规格 order「亚马逊：SP-API Orders v2026-01-01，ORDER_CHANGE → SQS 长轮询 + 每 3–5 分钟 lastUpdatedAfter 增量兜底」，
 * ADR 0008、0011，待办 12）：
 * 1. 常驻拉取 order.amazon_notifications（独占，咨询锁选主）：长轮询 SQS，每条 ORDER_CHANGE 按卖家 ID 找到亚马逊店铺、排一个
 *    order.amazon_order_changed（按「店铺 + 订单号」去重），事务提交后才删除消息（至少一次，处理是幂等的）；别的通知与坏消息照样删掉。
 *    每分钟最多检查一次队列里等待拉取的通知数（卡上的「积压 N 条」），拉取失败记次数（连续 3 次为「拉取失败」），都只影响卡上的 SQS 行；
 * 2. 任务 order.amazon_order_changed：getOrder 取这笔订单的最新样子写进镜像（只进不退）；失败按 30 秒起退避重试，
 *    不算进连接状态（通知只是加速通道，漏了由增量兜底补上）；
 * 3. 定时任务 order.amazon_poll 每 4 分钟（worker 启动时也一次）给每个亚马逊店铺排 order.amazon_sync：从水位前 5 分钟起按
 *    lastUpdatedAfter 分页（共用 incremental-sync.ts），连接状态（连续 3 次失败为连接异常，超过 10 分钟没成功为同步延迟）只看它；
 *    searchOrders 默认配额约 3 分钟 1 次，每 4 分钟一轮给回补与对账（13）留出余量，排队按优先级（增量为高）；
 * 4. 没配置 SP-API 凭据或该店铺还没录入卖家授权（ClientNotConfiguredError）不算失败，店铺为未连接；没配置 SQS 时拉取源安静跳过，
 *    SQS 行为未连接（用户 2026-10-04 口径）。
 * 镜像缺失时按订单号补拉（backfillAmazonOrder，经 lookup.ts 的 findOrder）；「测试连接」逐个店铺读卖家参与的站点、探一次 SQS，
 * 测完排一次同步（testAmazonConnection）。
 */

/** 每次从水位往前多取这么久（SP-API 搜索结果有几分钟的延迟：lastUpdatedBefore 要早于请求时刻至少 2 分钟） */
export const AMAZON_SYNC_OVERLAP_MS = 5 * 60_000;

/** 亚马逊订单号（3-7-7）：来信里抽到的就是它（规格「订单号抽取」） */
export const AMAZON_ORDER_ID = /^\d{3}-\d{7}-\d{7}$/;

/** 每个 worker 同时处理几个同步、几个通知触发的拉取（同一店铺、同一笔订单仍由 stately + singletonKey 保证只跑一个） */
export const AMAZON_JOB_CONCURRENCY = 5;

/** 同步一个店铺：每个店铺最多一个在排队、一个在跑；不重试，下一轮（4 分钟后）的同步就是重试 */
export const amazonSyncJob = defineJob(
  'order.amazon_sync',
  z.object({ storeId: z.uuid() }),
  { policy: 'stately', retryLimit: 0 },
  undefined,
  AMAZON_JOB_CONCURRENCY,
);

/** 每 4 分钟给每个亚马逊店铺排一次增量同步（规格「每 3–5 分钟」）；worker 启动时也一次 */
export const amazonPollJob = defineJob(
  'order.amazon_poll',
  z.object({}),
  { policy: 'stately', retryLimit: 0 },
  { cron: '*/4 * * * *', tz: 'Asia/Shanghai', runAtStartup: true },
);

/** 通知说某笔订单变了：取它的最新样子。同一笔最多一个排队、一个在跑；失败 30 秒起退避重试 3 次 */
export const amazonOrderChangedJob = defineJob(
  'order.amazon_order_changed',
  z.object({ storeId: z.uuid(), orderId: z.string().regex(AMAZON_ORDER_ID) }),
  { policy: 'stately', retryLimit: 3, retryDelay: 30, retryBackoff: true },
  undefined,
  AMAZON_JOB_CONCURRENCY,
);

function amazonFor(clients: IntegrationClients, store: OrderStore): AmazonOrdersClient {
  return clients.forStore(amazonOrdersClient, {
    id: store.id,
    adapterMode: store.adapterMode,
    platformId: store.platformId,
  });
}

function amazonStores(db: DbExecutor, stores: OrderStoreSource): Promise<OrderStore[]> {
  return storesOf(db, stores, 'amazon');
}

/** 在事务里排一次某店铺的增量同步（新增或编辑店铺后立即同步）；已在排队的不重复排 */
export async function queueAmazonSync(tx: Tx, storeId: string): Promise<void> {
  await tx.enqueue(amazonSyncJob, { storeId }, { singletonKey: storeId });
}

/** 每 4 分钟：给每个亚马逊店铺排一次增量同步 */
export async function pollAmazonStores(
  runtime: Runtime,
  stores: OrderStoreSource,
  logger: Logger,
): Promise<void> {
  const targets = await amazonStores(runtime.db, stores);
  await transaction(runtime, async (tx) => {
    for (const store of targets) await queueAmazonSync(tx, store.id);
  });
  logger.debug({ stores: targets.length }, '已排亚马逊订单同步');
}

/** 亚马逊的增量取法：searchOrders 按 lastUpdatedAfter 分页，高优先级（回补与对账让路） */
function amazonFeed(client: AmazonOrdersClient): IncrementalFeed<AmazonOrder> {
  return {
    source: 'amazon_orders',
    label: 'SP-API',
    overlapMs: AMAZON_SYNC_OVERLAP_MS,
    page: async (since, cursor) => {
      const page = await client.searchOrders({
        lastUpdatedAfter: since,
        paginationToken: cursor,
        priority: 'high',
      });
      return { orders: page.orders, next: page.nextToken };
    },
    updatedAt: (order) => order.updatedAt,
    mirror: mirrorAmazonOrders,
  };
}

/** 增量同步一个亚马逊店铺。外部调用失败记进同步记录后照常抛出；没配置凭据或授权安静结束 */
export async function syncAmazonStore(
  clients: IntegrationClients,
  stores: OrderStoreSource,
  { storeId }: { storeId: string },
  { runtime, logger }: JobContext,
): Promise<void> {
  const store = (await amazonStores(runtime.db, stores)).find((s) => s.id === storeId);
  if (!store) {
    logger.warn({ storeId }, '不是亚马逊店铺（或已不存在），跳过订单同步');
    return;
  }
  await syncIncrementally(runtime, logger, stores, store, amazonFeed(amazonFor(clients, store)));
}

/**
 * 按订单号从 SP-API 补拉一笔并写进镜像（通知触发的拉取，与镜像缺失时 lookup.ts 的 findOrder）；平台也没有返回 false。
 * 没配置凭据以 ClientNotConfiguredError 失败，其余外部调用失败照常抛出
 */
export async function backfillAmazonOrder(
  runtime: Runtime,
  clients: IntegrationClients,
  store: OrderStore,
  orderId: string,
): Promise<boolean> {
  const fetched = await amazonFor(clients, store).getOrder(orderId, { priority: 'high' });
  if (!fetched) return false;
  await transaction(runtime, (tx) => upsertAmazonOrder(tx, store.id, fetched));
  return true;
}

/** 通知说某笔订单变了：取最新的写进镜像。没配置凭据安静结束；平台没有这笔（通知早于订单可见等）只记日志 */
export async function fetchChangedOrder(
  clients: IntegrationClients,
  stores: OrderStoreSource,
  { storeId, orderId }: { storeId: string; orderId: string },
  { runtime, logger }: JobContext,
): Promise<void> {
  const store = (await amazonStores(runtime.db, stores)).find((s) => s.id === storeId);
  if (!store) return;
  try {
    if (!(await backfillAmazonOrder(runtime, clients, store, orderId))) {
      logger.info({ store: store.name, orderId }, '通知里的订单在平台上取不到，等增量兜底');
    }
  } catch (error) {
    if (error instanceof ClientNotConfiguredError) return;
    throw error;
  }
}

/** 拉取源每分钟最多检查一次等待拉取的通知数 */
const BACKLOG_CHECK_MS = 60_000;

/**
 * 常驻拉取：SQS 的 ORDER_CHANGE 通知 → 按「店铺 + 订单号」排拉取任务。独占（ADR 0008）：多个 worker 时只有拿到咨询锁的那个拉
 */
export function createAmazonNotificationsFeed(
  clients: IntegrationClients,
  stores: OrderStoreSource,
): Feed {
  /** 上次记下的拉取是成功的（成功时只在由失败转成功时写一次库） */
  let healthy = false;
  let lastCheckAt: number | null = null;
  let reportedNotConfigured = false;

  async function checkBacklog(
    runtime: Runtime,
    sqs: AmazonNotificationsClient,
    logger: Logger,
  ): Promise<void> {
    const now = runtime.clock.now().getTime();
    if (lastCheckAt !== null && now - lastCheckAt < BACKLOG_CHECK_MS) return;
    lastCheckAt = now;
    try {
      await recordQueueBacklog(runtime, await sqs.backlog());
    } catch (error) {
      // 没配置交给外面处理；检查本身失败只记日志（拉取失败另由拉取记次数）
      if (error instanceof ClientNotConfiguredError) throw error;
      logger.warn({ err: error }, '检查订单通知队列的积压失败');
    }
  }

  return defineFeed(
    'order.amazon_notifications',
    async ({ runtime, logger, waitSeconds }) => {
      const sqs = clients.global(amazonSqsClient);
      let messages: Awaited<ReturnType<AmazonNotificationsClient['receive']>>;
      try {
        await checkBacklog(runtime, sqs, logger);
        messages = await sqs.receive({ maxMessages: 10, waitSeconds });
      } catch (error) {
        // 生产上线初期没有 SQS（用户 2026-10-04 口径）：安静跳过，不当作拉取出错去退避；清掉旧记录，卡上为未连接
        if (error instanceof ClientNotConfiguredError) {
          if (!reportedNotConfigured) {
            await clearQueueRecord(runtime);
            logger.info('没有配置订单通知队列（SQS），不拉取；订单靠增量兜底');
            reportedNotConfigured = true;
          }
          return 0;
        }
        if (error instanceof ExternalServiceError) {
          healthy = false;
          try {
            const failures = await recordQueueReceiveFailure(runtime, error);
            logger.warn({ err: error, failures }, '拉取订单通知队列失败');
          } catch (recordError) {
            logger.error({ err: recordError }, '记订单通知队列的拉取失败时出错');
          }
        }
        throw error;
      }
      if (!healthy) {
        await recordQueueReceiveSuccess(runtime);
        healthy = true;
      }
      if (messages.length === 0) return 0;
      const bySeller = new Map<string, OrderStore[]>();
      for (const store of await amazonStores(runtime.db, stores)) {
        bySeller.set(store.platformId, [...(bySeller.get(store.platformId) ?? []), store]);
      }
      await transaction(runtime, async (tx) => {
        for (const message of messages) {
          const change = message.notification;
          if (!change || !AMAZON_ORDER_ID.test(change.orderId)) {
            logger.info({ receiptHandle: message.receiptHandle }, '不是 ORDER_CHANGE 通知，删除');
            continue;
          }
          const targets = bySeller.get(change.sellerId) ?? [];
          if (targets.length === 0) {
            logger.info({ sellerId: change.sellerId }, '通知的卖家没有登记亚马逊店铺，删除');
          }
          for (const store of targets) {
            await tx.enqueue(
              amazonOrderChangedJob,
              { storeId: store.id, orderId: change.orderId },
              { singletonKey: `${store.id}:${change.orderId}` },
            );
          }
        }
      });
      // 任务入队（事务提交）后才删除；删除失败消息会重投，拉取任务按订单号取最新的写镜像，重投无害
      await sqs.delete(messages.map((m) => m.receiptHandle));
      return messages.length;
    },
    { exclusive: true },
  );
}

/**
 * 「测试连接」（K20，待办 12 Q6，协调者 2026-10-06 决定）：逐个亚马逊店铺读卖家参与的站点（不占订单接口的配额），再探一次订单通知队列；
 * 不改连接状态（状态只看同步记录），测完立即给每个店铺排一次同步。返回能与不能访问的店铺名（访问不了的队列写在店铺之后）
 */
export async function testAmazonConnection(
  runtime: Runtime,
  clients: IntegrationClients,
  stores: OrderStoreSource,
  logger: Logger,
): Promise<{ reachable: string[]; unreachable: string[] }> {
  const reachable: string[] = [];
  const unreachable: string[] = [];
  for (const store of await amazonStores(runtime.db, stores)) {
    try {
      await amazonFor(clients, store).marketplaceParticipations();
      reachable.push(store.name);
    } catch (error) {
      logger.warn({ err: error, store: store.name }, '测试连接：亚马逊店铺无法访问');
      unreachable.push(store.name);
    }
  }
  try {
    await clients.global(amazonSqsClient).backlog();
  } catch (error) {
    logger.warn({ err: error }, '测试连接：订单通知队列无法访问');
    unreachable.push(ORDER_QUEUE_NAME);
  }
  await pollAmazonStores(runtime, stores, logger);
  return { reachable, unreachable };
}
