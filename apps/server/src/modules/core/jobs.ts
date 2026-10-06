import { PgBoss, type JobOptions, type Queue } from 'pg-boss';
import type { z } from 'zod';
import type { Logger } from './logger';
import type { Runtime } from './runtime';

/*
 * 后台任务（ADR 0008）：pg-boss，任务表即发件箱。
 * - 领域事件在业务事务里经 tx.enqueue 插入任务，与业务数据同一事务提交或回滚；
 * - worker 进程按注册的处理器消费；api 进程只插入、不消费。
 * 任务名用「模块.任务」形式，如 ticket.merge_inbound；载荷用 zod 模式在发送与消费两端校验。
 */

/**
 * 定时任务（ADR 0008）：worker 启动时按 cron 登记到 pg-boss（只有 worker 跑定时），到点排一个载荷为 `{}` 的任务；
 * 停机期间错过的时点在恢复后补排一次。测试不跑定时，用 t.enqueue 显式排。
 */
export interface JobSchedule {
  /** cron 表达式，按 tz 解释 */
  readonly cron: string;
  readonly tz: string;
  /** worker 启动时也排一次（首次部署、或停机后不用等到下一个时点） */
  readonly runAtStartup?: boolean;
}

export interface JobDefinition<T extends object> {
  readonly name: string;
  readonly payload: z.ZodType<T>;
  /** 队列策略与重试、过期、保留设置；不填用 pg-boss 默认值（standard 策略） */
  readonly queue?: Omit<Queue, 'name'>;
  /** 定时；载荷模式要接受 `{}` */
  readonly schedule?: JobSchedule;
  /**
   * 每个 worker 进程同时处理几个（pg-boss 的 localConcurrency，默认 1）。每个处理者取一个、处理完等轮询间隔（2 秒）再取，
   * 一次要处理很多个的队列（每分钟给每个店铺排一次的同步）调大，免得排成长队（待办 11）
   */
  readonly concurrency?: number;
}

const JOB_NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function defineJob<T extends object>(
  name: string,
  payload: z.ZodType<T>,
  queue?: Omit<Queue, 'name'>,
  schedule?: JobSchedule,
  concurrency?: number,
): JobDefinition<T> {
  if (!JOB_NAME.test(name)) {
    throw new Error(`任务名必须是「模块.任务」形式的小写 snake_case：${name}`);
  }
  if (schedule && !payload.safeParse({}).success) {
    throw new Error(`定时任务的载荷要接受 {}：${name}`);
  }
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
    throw new Error(`任务的并发数必须是正整数：${name}`);
  }
  return {
    name,
    payload,
    ...(queue ? { queue } : {}),
    ...(schedule ? { schedule } : {}),
    ...(concurrency ? { concurrency } : {}),
  };
}

export interface JobContext {
  readonly jobId: string;
  readonly runtime: Runtime;
  readonly logger: Logger;
  /** 任务过期或 worker 停止时触发 */
  readonly signal: AbortSignal;
  /**
   * 这是最后一次尝试：再失败就不再重试（pg-boss 的 retryCount 已到 retryLimit）。外部系统一直不可用时，处理器可以据此
   * 退而求其次把事情做完，而不是让任务就此失败（例如按订单归并在订单平台一直连不上时不关联订单照常建单，待办 14）
   */
  readonly lastAttempt: boolean;
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

/**
 * 这次发送是否按 pg-boss 的去重规则可能不插入：带 singletonKey、singletonSeconds，
 * 或队列策略不是 standard（singleton、stately 等）。只有这时 send 返回 null 才是正常的。
 */
export function mayBeDeduplicated(job: AnyJobDefinition, options: JobOptions | undefined): boolean {
  return (
    options?.singletonKey !== undefined ||
    options?.singletonSeconds !== undefined ||
    (job.queue?.policy ?? 'standard') !== 'standard'
  );
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

/** 已从队列取到的一个任务（pg-boss 的 JobWithMetadata 的子集） */
export interface FetchedJob {
  readonly id: string;
  readonly data: unknown;
  readonly signal: AbortSignal;
  /** 已重试了几次、最多重试几次 */
  readonly retryCount: number;
  readonly retryLimit: number;
}

/**
 * 处理一个已取到的任务：校验载荷后交给处理器。worker 与测试的「跑完已排队任务」
 * （apps/server/test/harness.ts）共用这一段，测试走的就是生产的处理路径。
 */
export async function runJob(
  runtime: Runtime,
  handler: AnyJobHandler,
  job: FetchedJob,
  logger: Logger,
): Promise<void> {
  const log = logger.child({ job: handler.job.name, jobId: job.id });
  // 载荷不符合模式说明发送端与消费端版本不一致：抛错让任务失败，留待排查
  const payload: unknown = handler.job.payload.parse(job.data);
  await handler.handle(payload, {
    jobId: job.id,
    runtime,
    logger: log,
    signal: job.signal,
    lastAttempt: job.retryCount >= job.retryLimit,
  });
}

/**
 * 启动 worker：为每个处理器订阅它的队列，逐个取任务、校验载荷后处理；定时任务按 cron 登记（重复登记即更新），
 * 要求启动时就跑的再排一次（队列有去重策略时已在排队的不再重复）
 */
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
      {
        batchSize: 1,
        // 带上重试次数（retryCount、retryLimit），处理器据此知道是不是最后一次尝试
        includeMetadata: true,
        localConcurrency: handler.job.concurrency ?? 1,
        pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
      },
      async (jobs) => {
        for (const job of jobs) {
          await runJob(runtime, handler, job, options.logger);
        }
      },
    );
  }
  for (const { job } of handlers) {
    if (!job.schedule) continue;
    await runtime.boss.schedule(
      job.name,
      job.schedule.cron,
      {},
      {
        tz: job.schedule.tz,
        missed: 'once',
      },
    );
    if (job.schedule.runAtStartup) await runtime.boss.send(job.name, {});
  }
}
