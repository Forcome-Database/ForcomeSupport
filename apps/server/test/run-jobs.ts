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
}

const BATCH_SIZE = 100;

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

  for (let round = 0; ; round += 1) {
    let pulled = 0;
    for (const feed of feeds) {
      pulled += await feed.pull({ runtime, logger, signal, waitSeconds: 0 });
    }
    const batch: JobWithMetadata<unknown>[] = [];
    for (const name of byName.keys()) {
      batch.push(
        ...(await runtime.boss.fetch(name, {
          batchSize: BATCH_SIZE,
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
