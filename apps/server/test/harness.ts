import { devMembersResponseSchema } from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import type { JobOptions } from 'pg-boss';
import { createApp } from '../src/app';
import type { ServerDeps } from '../src/deps';
import { fixtureSteps } from '../src/fixture-steps';
import { createJobHandlers } from '../src/jobs';
import { findAuditRecords, type AuditQuery, type AuditRecord } from '../src/modules/core/audit';
import {
  ensureQueues,
  loadFixtures,
  ManualClock,
  silentLogger,
  startRuntime,
  transaction,
  type AnyJobHandler,
  type AppEnv,
  type FixtureLoadReport,
  type JobDefinition,
  type Runtime,
} from '../src/modules/core';
import { IntegrationClients, type AnyClientDefinition } from '../src/modules/integration';
import { createApiClient, type ApiClient } from './api-client';
import { createTestDatabase } from './database';
import { runQueuedJobs, type JobRunReport, type RunJobsOptions } from './run-jobs';

/*
 * 主接缝的测试工具（规格「测试接缝」，待办 02）：每个测试文件一个独立的库（从迁移好的模板复制），
 * 在测试进程内直接调用 Hono 应用，外部客户端全部是 Fake，时间由手动时钟控制，后台任务由测试同步跑完。
 * 用法见 dev-login.int.test.ts（示范用例）与 harness.int.test.ts。
 */

/** 测试请求的来源 IP（经 X-Forwarded-For 传给应用，审计里记它） */
export const TEST_CLIENT_IP = '10.20.3.27';

/** 默认时刻：原型演示时刻 2026-09-11 周五 10:20 北京时间 */
export const DEMO_NOW = getDemoFixture().meta.now;

export interface StartTestHarnessOptions {
  /** 运行环境，默认 test；验证「生产不允许」之类的行为时可改 */
  readonly appEnv?: Exclude<AppEnv, 'production'>;
  /** 时钟起点，默认演示时刻 */
  readonly now?: string;
  /** 后台任务处理器，默认 jobs.ts 组装的全部处理器；测试工具自己的测试会换成示范处理器 */
  readonly jobHandlers?: (deps: ServerDeps) => readonly AnyJobHandler[];
  /** 外部客户端清单，默认 integration 登记的全部客户端 */
  readonly clientDefinitions?: readonly AnyClientDefinition[];
}

/** 以谁登录：角色名（取示例数据里第一位有该角色的成员）或成员 key（如 liting） */
export type LoginTarget = string | { readonly member: string };

export interface TestHarness {
  /** 手动时钟：set 设到任意时刻，advance 向前推进；接口与任务里的「当前时间」都取它 */
  readonly clock: ManualClock;
  /** 本测试的外部客户端：clients.fake(定义) 拿到 Fake，往里放数据、注入故障 */
  readonly clients: IntegrationClients;
  /** 未登录的进程内 HTTP 客户端 */
  readonly api: ApiClient;
  /** 底层运行时；只给测试工具自己与少数需要直接排任务的场景用，业务断言走接口 */
  readonly runtime: Runtime;
  /** 经开发登录以某个角色或成员登录，返回带会话的客户端；每次调用都是一个新会话 */
  loginAs(target: LoginTarget, options?: { ip?: string }): Promise<ApiClient>;
  /** 同步把已排队的后台任务跑到空闲（见 run-jobs.ts）；有任务失败默认抛错 */
  runJobs(options?: RunJobsOptions): Promise<JobRunReport>;
  /** 直接排一个任务（例如模拟每分钟扫描的定时触发），随后用 runJobs 跑 */
  enqueue<T extends object>(
    job: JobDefinition<T>,
    payload: T,
    options?: JobOptions,
  ): Promise<string | null>;
  /** 把 Fake 全部重置到初始状态（数据、故障、调用记录） */
  resetFakes(): void;
  /** 灌示例数据夹具（按各模块登记的加载步骤） */
  loadFixtures(): Promise<FixtureLoadReport>;
  /** 按动作或对象取审计记录（P27 的查询接口随 30 号待办；在那之前用它核对审计） */
  auditRecords(query?: AuditQuery): Promise<AuditRecord[]>;
  /** 关闭连接并删除本测试的库 */
  close(): Promise<void>;
}

export async function startTestHarness(
  options: StartTestHarnessOptions = {},
): Promise<TestHarness> {
  const appEnv = options.appEnv ?? 'test';
  const database = await createTestDatabase();
  const clock = new ManualClock(options.now ?? DEMO_NOW);
  const started = await startRuntime(database.url, {
    role: 'api',
    logger: silentLogger,
    clock,
    poolMax: 5,
  }).catch(async (error: unknown) => {
    await database.drop();
    throw error;
  });
  const { runtime } = started;
  async function close(): Promise<void> {
    try {
      await started.stop({ graceful: false });
    } finally {
      await database.drop();
    }
  }

  const clients = new IntegrationClients({ appEnv, definitions: options.clientDefinitions });
  const deps: ServerDeps = {
    runtime,
    logger: silentLogger,
    config: { appEnv, devLoginEnabled: true },
    clients,
  };
  let app: ReturnType<typeof createApp>;
  let handlers: readonly AnyJobHandler[];
  try {
    app = createApp(deps);
    handlers = (options.jobHandlers ?? createJobHandlers)(deps);
    // 模板库只建了 jobs.ts 登记的队列；测试自己的处理器在这里补建
    await ensureQueues(
      runtime.boss,
      handlers.map((h) => h.job),
    );
  } catch (error) {
    await close();
    throw error;
  }
  const api = createApiClient(app, { ip: TEST_CLIENT_IP });

  async function memberId(target: LoginTarget): Promise<string> {
    if (typeof target !== 'string') {
      const member = getDemoFixture().members.find((m) => m.key === target.member);
      if (!member) throw new Error(`示例数据里没有成员 ${target.member}`);
      return member.id;
    }
    const res = await api.get('/api/dev/members');
    const { members } = devMembersResponseSchema.parse(await res.json());
    const member = members.find((m) => m.roles.includes(target));
    if (!member) throw new Error(`没有角色为「${target}」的成员可以登录`);
    return member.id;
  }

  return {
    clock,
    clients,
    api,
    runtime,

    async loginAs(target, loginOptions = {}) {
      const id = await memberId(target);
      const client = createApiClient(app, { ip: loginOptions.ip ?? TEST_CLIENT_IP });
      const res = await client.post('/api/dev/login', { memberId: id });
      if (res.status !== 200) {
        throw new Error(`开发登录失败（${res.status}）：${await res.text()}`);
      }
      return client;
    },

    runJobs: (runOptions) => runQueuedJobs(runtime, handlers, silentLogger, runOptions),

    enqueue: (job, payload, jobOptions) =>
      transaction(runtime, (tx) => tx.enqueue(job, payload, jobOptions)),

    resetFakes: () => clients.resetFakes(),

    loadFixtures: () =>
      loadFixtures(runtime, { appEnv, fixture: getDemoFixture(), steps: fixtureSteps }),

    auditRecords: (query) => findAuditRecords(runtime.db, query),

    close,
  };
}
