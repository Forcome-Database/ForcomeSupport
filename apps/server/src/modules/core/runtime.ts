import { sql } from 'drizzle-orm';
import { fromDrizzle, type JobOptions, type PgBoss } from 'pg-boss';
import { systemClock, type Clock } from './clock';
import { closeDatabase, createDatabase, type Database, type DbTransaction } from './db';
import { createJobQueue, type JobDefinition, type JobQueueRole } from './jobs';
import type { Logger } from './logger';

/** 进程级依赖：数据库、任务队列与时钟。由入口组装，测试里换成测试库与手动时钟 */
export interface Runtime {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly clock: Clock;
}

/** 一个业务事务：所有写入、审计与发出的任务同时提交或同时回滚 */
export interface Tx {
  readonly db: DbTransaction;
  /** 本事务的「当前时间」：事务开始时从时钟取一次，事务内所有写入共用 */
  readonly now: Date;
  /**
   * 在本事务内插入后台任务（发件箱），返回任务 ID。
   * 有意去重（singletonKey、singletonSeconds，或队列策略不是 standard）且已有同类任务时返回 null；
   * 其余情况插不进去一律报错，不静默丢事件。
   */
  enqueue<T extends object>(
    job: JobDefinition<T>,
    payload: T,
    options?: JobOptions,
  ): Promise<string | null>;
}

export async function transaction<T>(runtime: Runtime, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runtime.db.transaction(async (db) => {
    const tx: Tx = {
      db,
      now: runtime.clock.now(),
      async enqueue(job, payload, options) {
        const data = job.payload.parse(payload);
        const id = await runtime.boss.send(job.name, data, {
          ...options,
          db: fromDrizzle(db, sql),
        });
        const deduplicates =
          options?.singletonKey !== undefined ||
          options?.singletonSeconds !== undefined ||
          (job.queue?.policy ?? 'standard') !== 'standard';
        if (id === null && !deduplicates) {
          throw new Error(`任务未插入：${job.name}`);
        }
        return id;
      },
    };
    return fn(tx);
  });
}

export interface RuntimeOptions {
  role: JobQueueRole;
  logger: Logger;
  /** 默认系统时钟；测试与回放传手动时钟 */
  clock?: Clock;
  /** 数据库连接池上限，默认 10 */
  poolMax?: number;
}

export interface RunningRuntime {
  readonly runtime: Runtime;
  /** 停止任务队列（graceful 时等正在处理的任务结束）并关闭数据库连接 */
  readonly stop: (options?: { graceful?: boolean; timeoutMs?: number }) => Promise<void>;
}

/** 按进程角色组装并启动运行时：数据库连接池 + pg-boss（api、worker、migrate 与测试共用） */
export async function startRuntime(
  databaseUrl: string,
  options: RuntimeOptions,
): Promise<RunningRuntime> {
  const db = createDatabase(databaseUrl, {
    max: options.poolMax ?? 10,
    applicationName: `forcome-${options.role}`,
  });
  const boss = createJobQueue(databaseUrl, { role: options.role, logger: options.logger });
  try {
    await boss.start();
  } catch (error) {
    await closeDatabase(db);
    throw error;
  }
  return {
    runtime: { db, boss, clock: options.clock ?? systemClock },
    async stop({ graceful = true, timeoutMs } = {}) {
      try {
        await boss.stop({ graceful, close: true, ...(timeoutMs ? { timeout: timeoutMs } : {}) });
      } finally {
        await closeDatabase(db);
      }
    },
  };
}
