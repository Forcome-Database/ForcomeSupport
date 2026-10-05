import { setTimeout as sleep } from 'node:timers/promises';
import type { Logger } from './logger';
import type { Runtime } from './runtime';

/*
 * 常驻拉取（ADR 0008「轮询与长连接」）：外部系统推来的变化（Gmail 的 Pub/Sub 通知；以后 SQS 的订单变化、
 * 钉钉 Stream 的通讯录事件）由 worker 常驻循环拉取，拉到的东西在事务里转成后台任务，再确认。
 * - worker 用 startFeeds 为每个拉取源起一个循环：长轮询等新通知，拉空了歇一会儿，出错按指数退避；
 * - 测试的「跑完任务」（t.runJobs）每轮先把各拉取源拉一次（不等待），再跑任务，直到都空闲——
 *   测试里「Fake 来信 → 跑完任务」走的就是生产的拉取与任务处理路径。
 * 多个 worker 时常驻连接用 advisory lock 选主（09 号待办）。
 */

export interface FeedContext {
  readonly runtime: Runtime;
  readonly logger: Logger;
  /** worker 停止时触发 */
  readonly signal: AbortSignal;
  /** 长轮询最多等多久（秒）；0 为有就拿、没有立即返回（测试） */
  readonly waitSeconds: number;
}

export interface Feed {
  /** `模块.拉取源`，如 channel.gmail_push */
  readonly name: string;
  /** 拉一次并处理，返回这次拉到的条数（0 为暂时没有新的） */
  pull(context: FeedContext): Promise<number>;
}

const FEED_NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function defineFeed(name: string, pull: (context: FeedContext) => Promise<number>): Feed {
  if (!FEED_NAME.test(name)) {
    throw new Error(`拉取源名必须是「模块.名称」形式的小写 snake_case：${name}`);
  }
  return { name, pull };
}

export interface StartFeedsOptions {
  readonly logger: Logger;
  /** 长轮询最多等多久（秒），默认 20 */
  readonly waitSeconds?: number;
  /** 拉空后歇多久再拉（毫秒），默认 1000；Fake 不做长轮询，靠它免得空转 */
  readonly idleMs?: number;
  /** 出错后第一次重试前等多久（毫秒），之后翻倍，最多 60 秒；默认 2000 */
  readonly errorBackoffMs?: number;
}

export interface RunningFeeds {
  /** 停止全部循环并等它们结束（正在进行的那次拉取完成后退出） */
  stop(): Promise<void>;
}

const MAX_BACKOFF_MS = 60_000;

async function pause(ms: number, signal: AbortSignal): Promise<void> {
  await sleep(ms, undefined, { signal }).catch(() => undefined);
}

/** 为每个拉取源起一个常驻循环（worker 用） */
export function startFeeds(
  runtime: Runtime,
  feeds: readonly Feed[],
  options: StartFeedsOptions,
): RunningFeeds {
  const controller = new AbortController();
  const { signal } = controller;
  const waitSeconds = options.waitSeconds ?? 20;
  const idleMs = options.idleMs ?? 1_000;
  const errorBackoffMs = options.errorBackoffMs ?? 2_000;

  const loops = feeds.map(async (feed) => {
    const logger = options.logger.child({ feed: feed.name });
    let failures = 0;
    while (!signal.aborted) {
      try {
        const count = await feed.pull({ runtime, logger, signal, waitSeconds });
        failures = 0;
        if (count === 0) await pause(idleMs, signal);
      } catch (error) {
        failures += 1;
        const backoff = Math.min(errorBackoffMs * 2 ** (failures - 1), MAX_BACKOFF_MS);
        logger.error({ err: error, failures, retryInMs: backoff }, '常驻拉取出错，稍后重试');
        await pause(backoff, signal);
      }
    }
  });

  return {
    async stop() {
      controller.abort();
      await Promise.all(loops);
    },
  };
}
