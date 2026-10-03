import { sql } from 'drizzle-orm';
import { fromDrizzle, type JobOptions, type PgBoss } from 'pg-boss';
import type { Clock } from './clock';
import type { Database, DbTransaction } from './db';
import type { JobDefinition } from './jobs';

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
   * 只有带 singletonKey 去重且已有同键任务时返回 null；其余情况插不进去一律报错，不静默丢事件。
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
        if (id === null && options?.singletonKey === undefined) {
          throw new Error(`任务未插入：${job.name}`);
        }
        return id;
      },
    };
    return fn(tx);
  });
}
