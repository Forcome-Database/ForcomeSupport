import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import type { Logger } from './logger';
import type { Runtime } from './runtime';

/*
 * 常驻拉取（ADR 0008「轮询与长连接」）：外部系统推来的变化（Gmail 的 Pub/Sub 通知；以后 SQS 的订单变化、
 * 钉钉 Stream 的通讯录事件）由 worker 常驻循环拉取，拉到的东西在事务里转成后台任务，再确认。
 * - worker 用 startFeeds 为每个拉取源起一个循环：长轮询等新通知，拉空了歇一会儿，出错按指数退避；
 * - 独占的拉取源（exclusive，钉钉 Stream 这类常驻长连接，一个组织只该有一条）在多个 worker 之间用 PostgreSQL 会话级
 *   咨询锁选主：拿到锁的 worker 拉，其他的每 30 秒试一次；持有者退出或数据库连接断开时锁自动释放，由别的 worker 接手；
 * - 测试的「跑完任务」（t.runJobs）每轮先把各拉取源拉一次（不等待、不选主），再跑任务，直到都空闲——
 *   测试里「Fake 来信 → 跑完任务」走的就是生产的拉取与任务处理路径。
 */

export interface FeedContext {
  readonly runtime: Runtime;
  readonly logger: Logger;
  /** worker 停止（或独占的拉取源失去持有权）时触发 */
  readonly signal: AbortSignal;
  /** 长轮询最多等多久（秒）；0 为有就拿、没有立即返回（测试） */
  readonly waitSeconds: number;
}

export interface Feed {
  /** `模块.拉取源`，如 channel.gmail_push */
  readonly name: string;
  /** 只能有一个 worker 在拉（常驻长连接）：多个 worker 时按咨询锁选主 */
  readonly exclusive: boolean;
  /** 拉一次并处理，返回这次拉到的条数（0 为暂时没有新的） */
  pull(context: FeedContext): Promise<number>;
  /** 停止拉取时（worker 停止、独占的拉取源失去持有权）调用：断开长连接等 */
  release(): Promise<void>;
}

const FEED_NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export interface FeedOptions {
  /** 独占（见 Feed.exclusive），默认否 */
  readonly exclusive?: boolean;
  /** 停止拉取时调用，默认什么也不做 */
  readonly release?: () => Promise<void>;
}

export function defineFeed(
  name: string,
  pull: (context: FeedContext) => Promise<number>,
  options: FeedOptions = {},
): Feed {
  if (!FEED_NAME.test(name)) {
    throw new Error(`拉取源名必须是「模块.名称」形式的小写 snake_case：${name}`);
  }
  return {
    name,
    exclusive: options.exclusive ?? false,
    pull,
    release: options.release ?? (() => Promise.resolve()),
  };
}

export interface StartFeedsOptions {
  readonly logger: Logger;
  /** 间隔都可调，只给测试用 */
  readonly timing?: Partial<FeedTiming>;
}

interface FeedTiming {
  /** 长轮询最多等多久（秒） */
  readonly waitSeconds: number;
  /** 拉空后歇多久再拉：Fake 不做长轮询，靠它免得空转 */
  readonly idleMs: number;
  /** 出错后第一次重试前等多久，之后翻倍，最多 maxBackoffMs */
  readonly errorBackoffMs: number;
  readonly maxBackoffMs: number;
  /** 没拿到独占持有权时隔多久再试 */
  readonly standbyMs: number;
  /** 持有期间隔多久确认一次锁所在的数据库连接还在 */
  readonly heartbeatMs: number;
}

const DEFAULT_TIMING: FeedTiming = {
  waitSeconds: 20,
  idleMs: 1_000,
  errorBackoffMs: 2_000,
  maxBackoffMs: 60_000,
  standbyMs: 30_000,
  heartbeatMs: 30_000,
};

export interface RunningFeeds {
  /** 停止全部循环并等它们结束（正在进行的那次拉取完成后退出） */
  stop(): Promise<void>;
}

async function pause(ms: number, signal: AbortSignal): Promise<void> {
  await sleep(ms, undefined, { signal }).catch(() => undefined);
}

/** 拉取源的咨询锁键（与事务级锁的「模块.用途:对象」区分开） */
function lockKey(feed: Feed): string {
  return `core.feed:${feed.name}`;
}

/** 拿到的独占持有权：锁在这条专用的数据库连接上，连接断了锁就没了（lost 触发） */
interface FeedLease {
  readonly lost: AbortSignal;
  release(): Promise<void>;
}

/**
 * 试着拿独占持有权（不等待）：从连接池借一条专用连接，在它上面 pg_try_advisory_lock。拿到了就一直借着，
 * 定时确认连接还在；拿不到就还回连接、返回 null。
 */
async function tryLease(
  runtime: Runtime,
  feed: Feed,
  timing: FeedTiming,
  logger: Logger,
): Promise<FeedLease | null> {
  const client: pg.PoolClient = await runtime.db.$client.connect();
  let broken = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [lockKey(feed)],
    );
    if (!rows[0]?.locked) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release(error instanceof Error ? error : true);
    throw error;
  }

  const lost = new AbortController();
  const loseLease = (error: unknown) => {
    if (lost.signal.aborted) return;
    broken = true;
    logger.error({ err: error }, '独占持有权所在的数据库连接断开，停止拉取，稍后重新选主');
    lost.abort();
  };
  client.on('error', loseLease);
  const heartbeat = setInterval(() => {
    client.query('SELECT 1').catch(loseLease);
  }, timing.heartbeatMs);

  return {
    lost: lost.signal,
    async release() {
      clearInterval(heartbeat);
      client.off('error', loseLease);
      if (broken) {
        client.release(true);
        return;
      }
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey(feed)]);
        client.release();
      } catch (error) {
        // 解锁失败就把连接丢掉：连接关闭时锁一并释放
        client.release(error instanceof Error ? error : true);
      }
    },
  };
}

/** 一个拉取源的循环：一直拉，直到 signal 触发 */
async function pullUntil(
  runtime: Runtime,
  feed: Feed,
  signal: AbortSignal,
  logger: Logger,
  timing: FeedTiming,
): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const count = await feed.pull({ runtime, logger, signal, waitSeconds: timing.waitSeconds });
      failures = 0;
      if (count === 0) await pause(timing.idleMs, signal);
    } catch (error) {
      failures += 1;
      const backoff = Math.min(timing.errorBackoffMs * 2 ** (failures - 1), timing.maxBackoffMs);
      logger.error({ err: error, failures, retryInMs: backoff }, '常驻拉取出错，稍后重试');
      await pause(backoff, signal);
    }
  }
}

/** 独占的拉取源：拿到持有权才拉，失去（连接断开）或 worker 停止时断开长连接、交还持有权 */
async function pullWhenLeader(
  runtime: Runtime,
  feed: Feed,
  signal: AbortSignal,
  logger: Logger,
  timing: FeedTiming,
): Promise<void> {
  while (!signal.aborted) {
    let lease: FeedLease | null;
    try {
      lease = await tryLease(runtime, feed, timing, logger);
    } catch (error) {
      logger.error({ err: error }, '选主时数据库出错，稍后再试');
      lease = null;
    }
    if (!lease) {
      await pause(timing.standbyMs, signal);
      continue;
    }
    logger.info('拿到独占持有权，开始拉取');
    try {
      await pullUntil(runtime, feed, AbortSignal.any([signal, lease.lost]), logger, timing);
    } finally {
      await feed.release().catch((error: unknown) => {
        logger.error({ err: error }, '断开常驻连接出错');
      });
      await lease.release();
    }
    logger.info('交还独占持有权');
  }
}

/** 为每个拉取源起一个常驻循环（worker 用） */
export function startFeeds(
  runtime: Runtime,
  feeds: readonly Feed[],
  options: StartFeedsOptions,
): RunningFeeds {
  const controller = new AbortController();
  const { signal } = controller;
  const timing: FeedTiming = { ...DEFAULT_TIMING, ...options.timing };

  const loops = feeds.map(async (feed) => {
    const logger = options.logger.child({ feed: feed.name });
    if (feed.exclusive) {
      await pullWhenLeader(runtime, feed, signal, logger, timing);
      return;
    }
    try {
      await pullUntil(runtime, feed, signal, logger, timing);
    } finally {
      await feed.release().catch((error: unknown) => {
        logger.error({ err: error }, '断开常驻连接出错');
      });
    }
  });

  return {
    async stop() {
      controller.abort();
      await Promise.all(loops);
    },
  };
}
