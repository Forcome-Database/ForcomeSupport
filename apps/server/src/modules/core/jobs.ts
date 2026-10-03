import { PgBoss, type QueueOptions } from 'pg-boss';
import type { z } from 'zod';
import type { Logger } from './logger';
import type { Runtime } from './runtime';

/*
 * 后台任务（ADR 0008）：pg-boss，任务表即发件箱。
 * - 领域事件在业务事务里经 tx.enqueue 插入任务，与业务数据同一事务提交或回滚；
 * - worker 进程按注册的处理器消费；api 进程只插入、不消费。
 * 任务名用「模块.任务」形式，如 ticket.merge_inbound；载荷用 zod 模式在发送与消费两端校验。
 */

export interface JobDefinition<T extends object> {
  readonly name: string;
  readonly payload: z.ZodType<T>;
  /** 队列级的重试、过期与保留设置；不填用 pg-boss 默认值 */
  readonly queue?: QueueOptions;
}

const JOB_NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function defineJob<T extends object>(
  name: string,
  payload: z.ZodType<T>,
  queue?: QueueOptions,
): JobDefinition<T> {
  if (!JOB_NAME.test(name)) {
    throw new Error(`任务名必须是「模块.任务」形式的小写 snake_case：${name}`);
  }
  return queue ? { name, payload, queue } : { name, payload };
}

export interface JobContext {
  readonly jobId: string;
  readonly runtime: Runtime;
  readonly logger: Logger;
  /** 任务过期或 worker 停止时触发 */
  readonly signal: AbortSignal;
}

export interface JobHandler<T extends object> {
  readonly job: JobDefinition<T>;
  handle(payload: T, context: JobContext): Promise<void>;
}

export function handleJob<T extends object>(
  job: JobDefinition<T>,
  handle: (payload: T, context: JobContext) => Promise<void>,
): JobHandler<T> {
  return { job, handle };
}

// 处理器集合里各任务的载荷类型不同，这里只关心任务名与队列设置
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyJobHandler = JobHandler<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyJobDefinition = JobDefinition<any>;

export type JobQueueRole = 'api' | 'worker' | 'migrate';

export interface JobQueueOptions {
  role: JobQueueRole;
  logger: Logger;
}

/**
 * 按进程角色创建 pg-boss 实例：只有 migrate 安装与升级 pg-boss 自己的表，
 * 只有 worker 做维护与定时；api 只插入任务。
 */
export function createJobQueue(databaseUrl: string, options: JobQueueOptions): PgBoss {
  const isWorker = options.role === 'worker';
  const isMigrate = options.role === 'migrate';
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: 'pgboss',
    application_name: `forcome-${options.role}-pgboss`,
    max: isWorker ? 10 : 3,
    migrate: isMigrate,
    createSchema: isMigrate,
    supervise: isWorker,
    schedule: isWorker,
    registerInstance: !isMigrate,
    instanceName: options.role,
  });
  // 未监听的 error 事件会让进程崩溃；pg-boss 的内部错误（如维护任务失败）记日志即可
  boss.on('error', (error) => options.logger.error({ err: error }, 'pg-boss 内部错误'));
  return boss;
}

/** 确保各任务的队列存在（幂等）；migrate 与 worker 启动时调用 */
export async function ensureQueues(boss: PgBoss, jobs: readonly AnyJobDefinition[]): Promise<void> {
  for (const job of jobs) {
    await boss.createQueue(job.name, job.queue ?? {});
  }
}

export interface WorkerOptions {
  logger: Logger;
  /** 空闲时的轮询间隔（秒），pg-boss 要求 ≥ 0.5；默认 2 */
  pollingIntervalSeconds?: number;
}

/** 启动 worker：为每个处理器订阅它的队列，逐个取任务、校验载荷后处理 */
export async function startWorker(
  runtime: Runtime,
  handlers: readonly AnyJobHandler[],
  options: WorkerOptions,
): Promise<void> {
  await ensureQueues(
    runtime.boss,
    handlers.map((h) => h.job),
  );
  for (const handler of handlers) {
    await runtime.boss.work(
      handler.job.name,
      { batchSize: 1, pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 },
      async (jobs) => {
        for (const job of jobs) {
          const logger = options.logger.child({ job: handler.job.name, jobId: job.id });
          // 载荷不符合模式说明发送端与消费端版本不一致：抛错让任务失败，留待排查
          const payload: unknown = handler.job.payload.parse(job.data);
          await handler.handle(payload, { jobId: job.id, runtime, logger, signal: job.signal });
        }
      },
    );
  }
}
