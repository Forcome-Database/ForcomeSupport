import { sql } from 'drizzle-orm';
import type { JobWithMetadata } from 'pg-boss';
import { runJob, type AnyJobHandler } from './jobs';
import type { Logger } from './logger';
import type { Runtime } from './runtime';

/*
 * 单线程把几个队列跑到空闲（ADR 0008「待办 26 落地」）：历史邮件回放每推进一封邮件，就把它引起的任务（归并、回复识别）在回放的
 * 运行时里跑完，再推进下一封——标记跟着运行时走、不跟着任务走，所以这些任务不能留给实时 worker（回放期间 worker 必须停，命令检查）。
 * 与 worker 同一个处理路径（runJob）；与测试工具的「跑完任务」（test/run-jobs.ts）不同的是这里尊重重试间隔：失败的任务交给 pg-boss
 * 记失败，还有重试次数的按队列的退避延后，等到点再跑（真实时间），重试用完的算失败、继续往下（与实时 worker 一样，不卡住回放）。
 */

export interface DrainJobsOptions {
  /** 等重试时的睡眠（测试换成不真等的） */
  readonly sleep?: (ms: number) => Promise<void>;
  /** 等重试时最长一次睡多久，到点前醒来再看一次；默认 30 秒 */
  readonly maxWaitMs?: number;
}

export interface FailedDrainJob {
  readonly name: string;
  readonly id: string;
  readonly error: string;
}

export interface DrainJobsReport {
  /** 成功的任务个数 */
  readonly completed: number;
  /** 重试用完、最终失败的任务 */
  readonly failed: readonly FailedDrainJob[];
}

const BATCH_SIZE = 100;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 把这些处理器的队列跑到没有排队的任务（含等着重试的） */
export async function drainJobs(
  runtime: Runtime,
  handlers: readonly AnyJobHandler[],
  logger: Logger,
  options: DrainJobsOptions = {},
): Promise<DrainJobsReport> {
  const sleep = options.sleep ?? defaultSleep;
  const maxWaitMs = options.maxWaitMs ?? 30_000;
  const byName = new Map(handlers.map((h) => [h.job.name, h]));
  let completed = 0;
  const failed: FailedDrainJob[] = [];
  for (;;) {
    const batch: JobWithMetadata<unknown>[] = [];
    for (const name of byName.keys()) {
      batch.push(
        ...(await runtime.boss.fetch(name, { batchSize: BATCH_SIZE, includeMetadata: true })),
      );
    }
    if (batch.length > 0) {
      batch.sort(
        (a, b) =>
          a.startAfter.getTime() - b.startAfter.getTime() ||
          a.createdOn.getTime() - b.createdOn.getTime(),
      );
      for (const job of batch) {
        const handler = byName.get(job.name)!;
        try {
          await runJob(runtime, handler, job, logger);
          await runtime.boss.complete(job.name, job.id);
          completed += 1;
        } catch (error) {
          await runtime.boss.fail(job.name, job.id, { message: errorText(error) });
          const final = job.retryCount >= job.retryLimit;
          logger[final ? 'error' : 'warn'](
            { err: error, job: job.name, jobId: job.id, retryCount: job.retryCount },
            final ? '任务失败，重试已用完' : '任务失败，稍后重试',
          );
          if (final) failed.push({ name: job.name, id: job.id, error: errorText(error) });
        }
      }
      continue;
    }
    // 没有到点的：还有等着重试（或延后开始）的就等到点
    const queued: JobWithMetadata<unknown>[] = [];
    for (const name of byName.keys()) {
      queued.push(...(await runtime.boss.findJobs(name, { queued: true })));
    }
    if (queued.length === 0) break;
    const next = Math.min(...queued.map((job) => job.startAfter.getTime()));
    await sleep(Math.min(Math.max(next - Date.now(), 100), maxWaitMs));
  }
  return { completed, failed };
}

/**
 * 上次中断时还在处理中的任务（进程退出前没来得及完成或记失败，pg-boss 里停在 active）交回重试：没有 worker 时没有维护进程替它们
 * 过期，留着的话 worker 起来后会在实时的运行时里重跑。只在确认没有别的进程消费这些队列时调用（回放命令持锁、worker 已停）。
 * 返回交回了几个
 */
export async function requeueInterruptedJobs(
  runtime: Runtime,
  handlers: readonly AnyJobHandler[],
): Promise<number> {
  const names = handlers.map((h) => h.job.name);
  // pg-boss 没有按状态列任务的接口：直接查它的任务表（按队列名分区的父表）
  const { rows } = await runtime.db.execute<{ id: string; name: string }>(
    sql`SELECT id, name FROM pgboss.job WHERE state = 'active' AND name IN ${names}`,
  );
  for (const row of rows) {
    await runtime.boss.fail(row.name, row.id, { message: '回放中断时还在处理，交回重试' });
  }
  return rows.length;
}
