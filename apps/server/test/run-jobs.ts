import { sql } from 'drizzle-orm';
import type { JobWithMetadata } from 'pg-boss';
import {
  runJob,
  type AnyJobHandler,
  type Feed,
  type Logger,
  type Runtime,
} from '../src/modules/core';

/** 一次「跑完任务」里处理过的一个任务 */
export interface JobRun {
  readonly name: string;
  readonly id: string;
  readonly data: unknown;
}

export interface FailedJobRun extends JobRun {
  readonly error: unknown;
}

export interface JobRunReport {
  /** 按处理顺序列出成功的任务 */
  readonly completed: readonly JobRun[];
  readonly failed: readonly FailedJobRun[];
}

/** 要跑到空闲的 worker：任务处理器与常驻拉取（ADR 0008 修订） */
export interface WorkerUnderTest {
  readonly handlers: readonly AnyJobHandler[];
  readonly feeds: readonly Feed[];
}

export interface RunJobsOptions {
  /** 有任务失败时不抛错，只在报告里列出（测试故障场景时用）；默认失败即抛错 */
  readonly allowFailures?: boolean;
  /** 最多跑几轮，防止任务互相触发、永远跑不完；默认 50 */
  readonly maxRounds?: number;
  /**
   * 同一轮取到的任务同时处理（像几个 worker 并行），用来验证并发场景：同一客户或同一订单的几封来信同时归并、
   * 同一封邮件的几份副本在几个邮箱同时入库（规格「需要覆盖的场景·并发」）。默认按先后逐个处理
   */
  readonly concurrently?: boolean;
  /**
   * 按历史回放跑（待办 26）：拉取与任务都在回放的运行时里跑（Runtime.replay），提醒与通知关闭。
   * 回放的真正入口随 26 号待办，这里只是让测试能在回放模式下跑同一条流水线
   */
  readonly replay?: boolean;
  /** 只跑这几个队列（按任务名），其余的留在队列里：例如只同步邮箱、先不归并（待办 33 的同步与归并滞后） */
  readonly only?: readonly string[];
  /**
   * 这次最多跑几个任务，跑满就返回、其余留在队列里（常驻拉取照常每轮拉一次）：一个一个地推进 worker，在任意两个任务之间插入别的动作
   * （例如每分钟的时限扫描落在两封来信的归并之间，待办 33）。跨队列按创建先后取（像 worker 各队列同时在取），不是一个队列取完再取下一个
   */
  readonly limit?: number;
}

const BATCH_SIZE = 100;

/** 有待跑任务的队列，按各自最早的任务的创建时间排（pg-boss 没有偷看队列的接口，直接查它的任务表，同 drainJobs） */
async function oldestFirst(runtime: Runtime, queues: readonly string[]): Promise<string[]> {
  if (queues.length === 0) return [];
  const { rows } = await runtime.db.execute<{ name: string }>(sql`
    SELECT name FROM pgboss.job WHERE state IN ('created', 'retry') AND name IN ${queues}
    GROUP BY name ORDER BY min(created_on)`);
  return rows.map((row) => row.name);
}

/** 本次处理失败的任务这时才交给 pg-boss 记失败（还有重试次数的进入 retry） */
async function failAll(runtime: Runtime, failed: readonly FailedJobRun[]): Promise<void> {
  for (const f of failed) {
    await runtime.boss.fail(f.name, f.id, { message: String(f.error) });
  }
}

/**
 * 同步把 worker 跑到空闲（规格「测试接缝」主接缝）：每轮先把各常驻拉取源拉一次（不等待，拉到的通知在拉取源里转成任务），
 * 再取出这些处理器队列里的全部任务，按计划开始时间（同时按创建时间）先后，经与 worker 相同的 runJob 处理；
 * 处理中新排进来的任务也一并跑完，直到拉不到新东西、也没有任务。
 * - 常驻拉取出错时照常抛出（测试要看到它），不重试；
 * - 不管任务的 startAfter（延后开始、失败后的重试间隔）：测试时间由手动时钟控制，排上了就跑；
 * - 失败的任务在本次不再重试，跑完后才交给 pg-boss 记失败（还有重试次数的进入 retry，下次再跑）。
 *   这样「回复先于来信到达、来信归并后重试成功」这类场景可以分两次 runJobs 写出来；
 * - 不跑 pg-boss 的定时（cron）：定时扫描在测试里用 t.enqueue 显式排一次再跑。
 */
export async function runQueuedJobs(
  liveRuntime: Runtime,
  { handlers, feeds }: WorkerUnderTest,
  logger: Logger,
  options: RunJobsOptions = {},
): Promise<JobRunReport> {
  const runtime: Runtime = options.replay ? { ...liveRuntime, replay: true } : liveRuntime;
  const byName = new Map(handlers.map((h) => [h.job.name, h]));
  const signal = new AbortController().signal;
  const completed: JobRun[] = [];
  const failed: FailedJobRun[] = [];
  const maxRounds = options.maxRounds ?? 50;
  const queues = [...byName.keys()].filter((name) => !options.only || options.only.includes(name));
  const ran = () => completed.length + failed.length;

  for (let round = 0; ; round += 1) {
    if (options.limit !== undefined && ran() >= options.limit) break;
    let pulled = 0;
    for (const feed of feeds) {
      pulled += await feed.pull({ runtime, logger, signal, waitSeconds: 0 });
    }
    const batch: JobWithMetadata<unknown>[] = [];
    for (const name of options.limit === undefined ? queues : await oldestFirst(runtime, queues)) {
      const room = options.limit === undefined ? BATCH_SIZE : options.limit - ran() - batch.length;
      if (room <= 0) break;
      batch.push(
        ...(await runtime.boss.fetch(name, {
          batchSize: Math.min(BATCH_SIZE, room),
          ignoreStartAfter: true,
          includeMetadata: true,
        })),
      );
    }
    if (batch.length === 0 && pulled === 0) break;
    if (round >= maxRounds) {
      for (const job of batch) {
        await runtime.boss.fail(job.name, job.id, { message: '测试中止：任务一直没有跑完' });
      }
      await failAll(runtime, failed);
      throw new Error(
        `跑了 ${maxRounds} 轮任务仍未空闲，可能有任务在循环产生新任务：${[
          ...new Set(batch.map((j) => j.name)),
        ].join('、')}`,
      );
    }
    batch.sort(
      (a, b) =>
        a.startAfter.getTime() - b.startAfter.getTime() ||
        a.createdOn.getTime() - b.createdOn.getTime(),
    );
    const run = async (job: JobWithMetadata<unknown>) => {
      const handler = byName.get(job.name);
      if (!handler) return; // 只取了这些处理器的队列，不会发生
      try {
        await runJob(runtime, handler, job, logger);
        await runtime.boss.complete(job.name, job.id);
        completed.push({ name: job.name, id: job.id, data: job.data });
      } catch (error) {
        failed.push({ name: job.name, id: job.id, data: job.data, error });
      }
    };
    if (options.concurrently) {
      await Promise.all(batch.map(run));
    } else {
      for (const job of batch) await run(job);
    }
  }

  await failAll(runtime, failed);
  if (failed.length > 0 && !options.allowFailures) {
    throw new AggregateError(
      failed.map((f) => f.error),
      `有 ${failed.length} 个任务失败：${failed
        .map((f) => `${f.name}（${(f.error as Error).message ?? String(f.error)}）`)
        .join('；')}`,
    );
  }
  return { completed, failed };
}
