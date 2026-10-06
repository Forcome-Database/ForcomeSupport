import { ORDER_BACKFILL_DAYS, type OrderBackfillProgress, type Platform } from '@forcome/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  defineJob,
  toMilliseconds,
  transaction,
  type DbExecutor,
  type JobContext,
  type Logger,
  type Runtime,
  type Tx,
} from '../core';
import {
  ClientNotConfiguredError,
  HistoryLimitedError,
  type IntegrationClients,
} from '../integration';
import { amazonFor } from './amazon-sync';
import type { OrderStore, OrderStoreSource } from './incremental-sync';
import { mirrorAmazonOrders, mirrorShopifyOrders, noWrites, type MirrorWrites } from './mirror';
import { orderSweep, orderSweepKinds, type OrderSweepKind } from './schema';
import { shopifyFor } from './shopify-sync';

/*
 * 订单回补与夜间对账（规格 order「回补 90 天（Shopify 61–90 天依赖 read_all_orders，否则 60 天并由报表注明）；每天夜间对账近 7 天」，
 * ADR 0008、0011 修订，待办 13）：
 * 1. 回补：管理员用部署子命令 order-backfill 开始（按店铺；已完成的跳过，--again 重来；协调者 2026-10-06 决定 Q1），按下单时间从
 *    90 天前起分页取订单写进镜像（只进不退，与增量交错不产生重复行、不回退）。Shopify 没开通 read_all_orders 时第一页被拒
 *    （HistoryLimitedError），窗口改为 60 天并记下（historyLimited：P18 写「未开通 read_all_orders」，报表注明）；
 * 2. 夜间对账：每天 03:30（上海）给每个订单店铺从头开始一次，按平台更新时间取近 7 天的订单写进镜像——镜像漏了的补上，同一版本而
 *    内容不一致的以平台为准改正（mirror.ts）；
 * 3. 一页一个任务（order.sweep_page）：取一页、写镜像、推进游标、排下一页在同一个事务里，中断（失败、worker 重启、任务过期）后从游标
 *    接着取，不重不漏；同一店铺同一种只有一个在跑（stately），推进游标时再核对一次游标没被别人推进过。失败按 1 分钟起退避重试 3 次，
 *    之后由每 10 分钟的 order.sweep_resume 接着排。亚马逊的分页令牌 24 小时过期：拿到超过 23 小时的从第一页重来（镜像写入是幂等的）；
 * 4. 让路：调用一律走低优先级（SP-API 令牌桶、Shopify 查询成本配额里增量先走），一页一个任务，每页之间增量照常插进来；
 *    失败不算进连接状态（连接状态只看增量同步）；
 * 5. 没配置凭据或卖家授权（ClientNotConfiguredError）不算失败：这一页先不取，配好后 sweep_resume 接着排（P18 只汇总已连接的店铺）。
 */

/**
 * 两种的不同之处：取近几天（规格「回补 90 天」「夜间对账近 7 天」）、按什么时间取（回补按下单时间，订单之后再变也不在分页里挪位置；
 * 对账按平台更新时间，覆盖近 7 天下的单与近 7 天里变过的老订单）、做完时的日志
 */
const SWEEPS = {
  backfill: { days: ORDER_BACKFILL_DAYS, by: 'created', done: '订单回补完成' },
  reconcile: { days: 7, by: 'updated', done: '夜间订单对账完成' },
} as const satisfies Record<
  OrderSweepKind,
  { days: number; by: 'created' | 'updated'; done: string }
>;
/**
 * 窗口因平台权限缩短时往里收一点：平台按「此刻往前 N 天」判断，回补从第一页重来时比那一刻晚了几毫秒也不会再被拒
 */
const NARROW_MARGIN_MS = toMilliseconds({ hours: 1 });
/** 分页游标多久以后不再用（亚马逊的分页令牌 24 小时过期，留 1 小时余量；Shopify 的游标不过期） */
const CURSOR_TTL_MS: Readonly<Record<Platform, number | null>> = {
  amazon: toMilliseconds({ hours: 23 }),
  shopify: null,
};
/** 每个 worker 同时取几页（不同店铺；回补与对账都是低优先级，同一卖家的调用本来就在令牌桶里排队） */
export const SWEEP_CONCURRENCY = 2;

/**
 * 取一页：同一店铺同一种最多一个排队、一个在跑。失败 1 分钟起退避重试 3 次；低优先级的一页可能要在 SP-API 令牌桶里等十几分钟，
 * 过期时间放宽到 1 小时（过期了也只是重取这一页）
 */
export const orderSweepPageJob = defineJob(
  'order.sweep_page',
  z.object({ storeId: z.uuid(), kind: z.enum(orderSweepKinds) }),
  { policy: 'stately', retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 3600 },
  undefined,
  SWEEP_CONCURRENCY,
);

/** 每 10 分钟（worker 启动时也一次）：给没做完的回补与对账接着排一页（重试用完的、没配置凭据时停下的） */
export const orderSweepResumeJob = defineJob(
  'order.sweep_resume',
  z.object({}),
  { policy: 'stately', retryLimit: 0 },
  { cron: '*/10 * * * *', tz: 'Asia/Shanghai', runAtStartup: true },
);

/** 每天 03:30（上海时间，业务低峰）：给每个订单店铺开始一次对账 */
export const orderReconcileJob = defineJob(
  'order.reconcile',
  z.object({}),
  { policy: 'stately', retryLimit: 0 },
  { cron: '30 3 * * *', tz: 'Asia/Shanghai' },
);

type SweepRow = typeof orderSweep.$inferSelect;

async function sweepOf(
  db: DbExecutor,
  storeId: string,
  kind: OrderSweepKind,
): Promise<SweepRow | null> {
  const [row] = await db
    .select()
    .from(orderSweep)
    .where(and(eq(orderSweep.storeId, storeId), eq(orderSweep.kind, kind)))
    .limit(1);
  return row ?? null;
}

/** 在事务里排下一页；已在排队的不重复排 */
async function queueSweepPage(tx: Tx, storeId: string, kind: OrderSweepKind): Promise<void> {
  await tx.enqueue(orderSweepPageJob, { storeId, kind }, { singletonKey: `${storeId}:${kind}` });
}

/** 从头开始一次（回补 90 天、对账 7 天）：覆盖这个店铺这一种以前的进度，排第一页 */
async function restartSweep(tx: Tx, storeId: string, kind: OrderSweepKind): Promise<void> {
  const days = SWEEPS[kind].days;
  const fresh = {
    windowDays: days,
    historyLimited: false,
    since: new Date(tx.now.getTime() - toMilliseconds({ days })),
    cursor: null,
    cursorAt: null,
    pages: 0,
    orders: 0,
    changed: 0,
    startedAt: tx.now,
    completedAt: null,
    lastError: null,
    updatedAt: tx.now,
  };
  await tx.db
    .insert(orderSweep)
    .values({ storeId, kind, ...fresh })
    .onConflictDoUpdate({ target: [orderSweep.storeId, orderSweep.kind], set: fresh });
  await queueSweepPage(tx, storeId, kind);
}

/** 开始回补的结果：started 从头开始了，resumed 还没做完、接着做，completed 已完成、跳过 */
export interface BackfillStart {
  readonly store: OrderStore;
  readonly result: 'started' | 'resumed' | 'completed';
}

/**
 * 开始订单回补（部署子命令 order-backfill，协调者 2026-10-06 决定 Q1）：给选中的店铺（不给为全部订单店铺）开始 90 天回补。
 * 已完成的跳过（again 时从头重来），还没做完的接着做
 */
export async function startOrderBackfill(
  runtime: Runtime,
  stores: OrderStoreSource,
  options: { readonly storeIds?: readonly string[]; readonly again?: boolean } = {},
): Promise<BackfillStart[]> {
  const targets = (await stores(runtime.db)).filter(
    (store) => !options.storeIds || options.storeIds.includes(store.id),
  );
  return transaction(runtime, async (tx) => {
    const results: BackfillStart[] = [];
    for (const store of targets) {
      const existing = await sweepOf(tx.db, store.id, 'backfill');
      if (existing && !options.again) {
        if (existing.completedAt) {
          results.push({ store, result: 'completed' });
        } else {
          await queueSweepPage(tx, store.id, 'backfill');
          results.push({ store, result: 'resumed' });
        }
        continue;
      }
      await restartSweep(tx, store.id, 'backfill');
      results.push({ store, result: 'started' });
    }
    return results;
  });
}

/** 每晚：给每个订单店铺从头开始一次对账（上一晚没做完的也从头来，窗口跟着此刻走） */
export async function startOrderReconcile(
  runtime: Runtime,
  stores: OrderStoreSource,
  logger: Logger,
): Promise<void> {
  const targets = await stores(runtime.db);
  await transaction(runtime, async (tx) => {
    for (const store of targets) await restartSweep(tx, store.id, 'reconcile');
  });
  logger.info({ stores: targets.length }, '已开始夜间订单对账');
}

/** 每 10 分钟：没做完的回补与对账接着排一页（已在排队或在跑的不重复排） */
export async function resumeOrderSweeps(runtime: Runtime): Promise<void> {
  const pending = await runtime.db
    .select({ storeId: orderSweep.storeId, kind: orderSweep.kind })
    .from(orderSweep)
    .where(isNull(orderSweep.completedAt));
  if (pending.length === 0) return;
  await transaction(runtime, async (tx) => {
    for (const row of pending) await queueSweepPage(tx, row.storeId, row.kind);
  });
}

/** 取到的一页：多少笔、下一页的游标、怎么写进镜像 */
interface SweepPage {
  readonly count: number;
  readonly next: string | null;
  mirror(tx: Tx, writes: MirrorWrites): Promise<void>;
}

/** 取一页（低优先级）：回补按下单时间，对账按平台更新时间 */
async function fetchPage(
  clients: IntegrationClients,
  store: OrderStore,
  kind: OrderSweepKind,
  since: Date,
  cursor: string | null,
): Promise<SweepPage> {
  switch (store.platform) {
    case 'amazon': {
      const page = await amazonFor(clients, store).searchOrders({
        ...(SWEEPS[kind].by === 'created' ? { createdAfter: since } : { lastUpdatedAfter: since }),
        paginationToken: cursor,
        priority: 'low',
      });
      return {
        count: page.orders.length,
        next: page.nextToken,
        mirror: (tx, writes) => mirrorAmazonOrders(tx, store.id, page.orders, writes),
      };
    }
    case 'shopify': {
      const page = await shopifyFor(clients, store).listOrders({
        ...(SWEEPS[kind].by === 'created' ? { createdSince: since } : { updatedSince: since }),
        after: cursor,
        priority: 'low',
      });
      return {
        count: page.orders.length,
        next: page.nextCursor,
        mirror: (tx, writes) => mirrorShopifyOrders(tx, store.id, page.orders, writes),
      };
    }
  }
}

/** 从第一页重来（窗口因平台权限缩短、分页令牌过期）：进度清零，返回新的样子 */
async function restartPaging(
  runtime: Runtime,
  row: SweepRow,
  changes: Partial<Pick<SweepRow, 'windowDays' | 'historyLimited' | 'since'>> = {},
): Promise<SweepRow> {
  const now = runtime.clock.now();
  const [updated] = await runtime.db
    .update(orderSweep)
    .set({ ...changes, cursor: null, cursorAt: null, pages: 0, orders: 0, updatedAt: now })
    .where(eq(orderSweep.id, row.id))
    .returning();
  return updated ?? row;
}

/** 失败的原因记下来（排错用；记录本身出错只记日志，不盖掉原来的错误） */
async function noteSweepFailure(
  runtime: Runtime,
  row: SweepRow,
  error: unknown,
  logger: Logger,
): Promise<void> {
  const text = error instanceof Error ? error.message : String(error);
  try {
    await runtime.db
      .update(orderSweep)
      .set({ lastError: text.slice(0, 500), updatedAt: runtime.clock.now() })
      .where(eq(orderSweep.id, row.id));
  } catch (recordError) {
    logger.error({ err: recordError }, '记订单回补或对账的失败时出错');
  }
}

/**
 * 取一页并写进镜像（任务 order.sweep_page）。外部调用失败记下原因后照常抛出（任务退避重试）；没配置凭据安静结束；
 * 店铺不在了、已完成的不做
 */
export async function runOrderSweepPage(
  clients: IntegrationClients,
  stores: OrderStoreSource,
  { storeId, kind }: { storeId: string; kind: OrderSweepKind },
  { runtime, logger }: JobContext,
): Promise<void> {
  let row = await sweepOf(runtime.db, storeId, kind);
  if (!row || row.completedAt) return;
  const store = (await stores(runtime.db)).find((s) => s.id === storeId);
  if (!store) {
    logger.info({ storeId, kind }, '店铺已不在，不再回补或对账');
    return;
  }
  const ttl = CURSOR_TTL_MS[store.platform];
  if (row.cursor && row.cursorAt && ttl !== null) {
    if (runtime.clock.now().getTime() - row.cursorAt.getTime() > ttl) {
      logger.info({ store: store.name, kind }, '分页令牌已过期，从第一页重来');
      row = await restartPaging(runtime, row);
    }
  }

  let page: SweepPage;
  try {
    try {
      page = await fetchPage(clients, store, kind, row.since, row.cursor);
    } catch (error) {
      // Shopify 没开通 read_all_orders：窗口缩短到平台允许的天数，记下来（P18、报表注明），从第一页重来
      if (!(error instanceof HistoryLimitedError) || kind !== 'backfill' || row.cursor !== null) {
        throw error;
      }
      row = await restartPaging(runtime, row, {
        windowDays: Math.min(row.windowDays, error.days),
        historyLimited: true,
        since: new Date(
          runtime.clock.now().getTime() - toMilliseconds({ days: error.days }) + NARROW_MARGIN_MS,
        ),
      });
      logger.info(
        { store: store.name, days: error.days },
        `${error.message}：回补窗口改为 ${error.days} 天`,
      );
      page = await fetchPage(clients, store, kind, row.since, null);
    }
  } catch (error) {
    if (error instanceof ClientNotConfiguredError) {
      logger.debug({ store: store.name, kind }, '没有配置凭据，先不回补或对账（配好后接着做）');
      return;
    }
    await noteSweepFailure(runtime, row, error, logger);
    throw error;
  }

  const current = row;
  const writes = noWrites();
  await transaction(runtime, async (tx) => {
    // 推进游标：只在还是这一轮（没被夜间对账或 --again 从头重开）、游标还是这一页开始时的样子时（同一页被并发取了两次时只认一次）
    const [claimed] = await tx.db
      .update(orderSweep)
      .set({
        cursor: page.next,
        cursorAt: page.next ? tx.now : null,
        pages: sql`${orderSweep.pages} + 1`,
        orders: sql`${orderSweep.orders} + ${page.count}`,
        completedAt: page.next ? null : tx.now,
        lastError: null,
        updatedAt: tx.now,
      })
      .where(
        and(
          eq(orderSweep.id, current.id),
          eq(orderSweep.startedAt, current.startedAt),
          isNull(orderSweep.completedAt),
          current.cursor === null
            ? isNull(orderSweep.cursor)
            : eq(orderSweep.cursor, current.cursor),
        ),
      )
      .returning({ id: orderSweep.id });
    if (!claimed) {
      logger.info({ store: store.name, kind }, '这一页已由别的任务写过，跳过');
      return;
    }
    await page.mirror(tx, writes);
    if (writes.count > 0) {
      await tx.db
        .update(orderSweep)
        .set({ changed: sql`${orderSweep.changed} + ${writes.count}` })
        .where(eq(orderSweep.id, current.id));
    }
    if (page.next) await queueSweepPage(tx, store.id, kind);
  });
  if (!page.next) {
    logger.info(
      { store: store.name, kind, orders: current.orders + page.count, changed: writes.count },
      SWEEPS[kind].done,
    );
  }
}

/** 一个店铺的订单回补（P18 回补行，contracts 的 orderBackfillSummary 汇总） */
export interface OrderBackfill extends OrderBackfillProgress {
  readonly storeId: string;
}

/** 全部店铺的订单回补（还没开始过的店铺没有） */
export async function orderBackfills(db: DbExecutor): Promise<Map<string, OrderBackfill>> {
  const rows = await db
    .select({
      storeId: orderSweep.storeId,
      windowDays: orderSweep.windowDays,
      historyLimited: orderSweep.historyLimited,
      orders: orderSweep.orders,
      completedAt: orderSweep.completedAt,
    })
    .from(orderSweep)
    .where(eq(orderSweep.kind, 'backfill'));
  return new Map(
    rows.map((row) => [
      row.storeId,
      {
        storeId: row.storeId,
        windowDays: row.windowDays,
        historyLimited: row.historyLimited,
        orders: row.orders,
        completed: row.completedAt !== null,
      },
    ]),
  );
}
