import { devMembersResponseSchema, roleByLabel, roles, type Role } from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import type { Hono } from 'hono';
import type { JobOptions } from 'pg-boss';
import { createApp } from '../src/app';
import { aftersales } from '../src/modules/aftersales/schema';
import type { ServerDeps } from '../src/deps';
import { fixtureSteps } from '../src/fixture-steps';
import { createFeeds, createJobHandlers } from '../src/jobs';
import {
  listReceivedMail,
  registerSenderRule,
  type ReceivedMail,
  type SenderRule,
} from '../src/modules/channel';
import { findAuditRecords, type AuditQuery, type AuditRecord } from '../src/modules/core/audit';
import {
  ensureQueues,
  loadFixtures,
  ManualClock,
  silentLogger,
  startRuntime,
  SYSTEM_STORE_SCOPE,
  transaction,
  type AnyJobHandler,
  type AppEnv,
  type Feed,
  type FixtureLoadReport,
  type JobDefinition,
  type Runtime,
} from '../src/modules/core';
import { IntegrationClients, type AnyClientDefinition } from '../src/modules/integration';
import {
  createMember,
  orgMembersFixtureStep,
  type AccessVariables,
  type NewMember,
} from '../src/modules/org';
import { resetInboundData, type InboundResetReport } from '../src/reset-inbound-data';
import { createApiClient, type ApiClient, type RequestHandler } from './api-client';
import { createTestDatabase } from './database';
import { runQueuedJobs, type JobRunReport, type RunJobsOptions } from './run-jobs';

/*
 * 主接缝的测试工具（规格「测试接缝」，待办 02）：每个测试文件一个独立的库（从迁移好的模板复制），
 * 在测试进程内直接调用 Hono 应用，外部客户端全部是 Fake，时间由手动时钟控制，后台任务由测试同步跑完。
 * 用法见 dev-login.int.test.ts（示范用例）与 harness.int.test.ts。
 */

/** 历史导入的售后单（单号、状态、店铺必给，其余按需；创建路径固定为历史导入） */
export type HistoryImportRow = Omit<
  typeof aftersales.$inferInsert,
  'origin' | 'createdAt' | 'updatedAt'
>;

/** 测试请求的来源 IP（经 X-Forwarded-For 传给应用，审计里记它） */
export const TEST_CLIENT_IP = '10.20.3.27';

/** 默认时刻：原型演示时刻 2026-09-11 周五 10:20 北京时间 */
export const DEMO_NOW = getDemoFixture().meta.now;

export interface StartTestHarnessOptions {
  /**
   * 运行环境，默认 test。设为 production 时应用按生产环境组装（不挂开发登录、外部客户端不给 Fake），
   * 用来验证「生产环境不允许」之类的行为；测试工具另用一个非生产的应用实例（同一个库）只为开发登录建会话，
   * 示例数据也按测试环境灌入——这些都是测试准备，被测的接口仍是生产配置的那一个。
   */
  readonly appEnv?: AppEnv;
  /** 时钟起点，默认演示时刻 */
  readonly now?: string;
  /** 后台任务处理器，默认 jobs.ts 组装的全部处理器；测试工具自己的测试会换成示范处理器 */
  readonly jobHandlers?: (deps: ServerDeps) => readonly AnyJobHandler[];
  /** 常驻拉取（Gmail 推送等），默认 jobs.ts 组装的全部拉取源 */
  readonly feeds?: (deps: ServerDeps) => readonly Feed[];
  /** 外部客户端清单，默认 integration 登记的全部客户端 */
  readonly clientDefinitions?: readonly AnyClientDefinition[];
  /**
   * 测试自己定义的示范接口（挂在应用上，与正式接口同一套会话与错误处理）：用来以「第一个使用者」的身份
   * 验证还没有业务接口使用的公共工具，例如店铺范围与财务字段过滤（access-tools.int.test.ts）
   */
  readonly routes?: (deps: ServerDeps) => Hono<{ Variables: AccessVariables }>;
}

/**
 * 以谁登录：角色（中文名如「客服主管」或标识如 supervisor，取示例数据里第一位有该角色的成员）、
 * 示例成员 key（如 { member: 'liting' }）或成员 id（如 t.addMember 返回的 { memberId }）
 */
export type LoginTarget = string | { readonly member: string } | { readonly memberId: string };

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
  /**
   * 新增一位成员（多角色、店铺范围受限等示例数据里没有的情形），返回成员 id。
   * 钉钉通讯录同步与 P20 成员管理（05、06 号待办）上线前，测试经 org 的 createMember 建成员。
   */
  addMember(member: Omit<NewMember, 'id'>): Promise<string>;
  /**
   * 同步把 worker 跑到空闲（见 run-jobs.ts）：先拉常驻拉取源（如 Fake Gmail 的推送通知），再跑已排队的任务，
   * 反复直到都空闲；有任务失败默认抛错
   */
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
  /**
   * 登记一条来源规则（第一期没有维护页面，规则随迁移与示例数据登记；测试里登记示例数据没有的，例如其他供应商）
   */
  addSenderRule(rule: SenderRule & { readonly label: string }): Promise<void>;
  /** 收取的邮件（含归档的平台通知与营销，按到达时间先后；第一期没有查看页面，用它核对「归档不丢信」） */
  receivedMail(filter?: { readonly mailbox?: string }): Promise<ReceivedMail[]>;
  /** 重放来信（运维命令 reset-inbound 的同一个函数，按本测试的运行环境：生产环境拒绝） */
  resetInbound(): Promise<InboundResetReport>;
  /**
   * 写一张历史导入的售后单（AC-P1-07 等）：售后登记表的导入命令随待办 27，在那之前测试工具直接写售后单表（与 t.addMember
   * 同理，是测试准备；断言仍经接口）。27 落地后改调导入命令。
   */
  addHistoryImport(row: HistoryImportRow): Promise<void>;
  /** 关闭连接并删除本测试的库 */
  close(): Promise<void>;
}

export async function startTestHarness(
  options: StartTestHarnessOptions = {},
): Promise<TestHarness> {
  const appEnv = options.appEnv ?? 'test';
  // 测试准备（灌示例数据、开发登录建会话）用的环境：生产配置下也按测试环境做
  const setupEnv: AppEnv = appEnv === 'production' ? 'test' : appEnv;
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
    config: { appEnv, devLoginEnabled: appEnv !== 'production' },
    clients,
  };
  let app: RequestHandler;
  let handlers: readonly AnyJobHandler[];
  let feeds: readonly Feed[];
  try {
    const main = createApp(deps);
    if (options.routes) main.route('/', options.routes(deps));
    app = main;
    if (appEnv === 'production') {
      // 生产配置的应用没有开发登录：/api/dev/* 交给同一个库上的非生产实例，换出的会话两边通用
      const login = createApp({ ...deps, config: { appEnv: setupEnv, devLoginEnabled: true } });
      app = {
        request: (input, init) =>
          input.startsWith('/api/dev/') ? login.request(input, init) : main.request(input, init),
      };
    }
    // 开发登录从成员表选人：每个测试库先灌示例成员（与 pnpm db:seed 同一个加载步骤）
    await loadFixtures(runtime, {
      appEnv: setupEnv,
      fixture: getDemoFixture(),
      steps: [orgMembersFixtureStep],
    });
    handlers = (options.jobHandlers ?? createJobHandlers)(deps);
    feeds = (options.feeds ?? createFeeds)(deps);
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

  function roleOf(name: string): Role {
    const role = roleByLabel(name) ?? roles.find((r) => r === name);
    if (!role) throw new Error(`没有角色「${name}」`);
    return role;
  }

  /** 都以开发登录接口列出的成员（成员表里的在职成员）为准 */
  async function memberId(target: LoginTarget): Promise<string> {
    if (typeof target === 'object' && 'memberId' in target) return target.memberId;
    const res = await api.get('/api/dev/members');
    const { members } = devMembersResponseSchema.parse(await res.json());
    if (typeof target === 'string') {
      // 优先取示例数据里第一位有该角色的成员（坐席是李婷），其次是测试里新增的成员
      const role = roleOf(target);
      const candidates = members.filter((m) => m.roles.includes(role));
      const fixtureOrder = getDemoFixture().members.map((m) => m.id);
      const rank = (id: string) =>
        fixtureOrder.includes(id) ? fixtureOrder.indexOf(id) : fixtureOrder.length;
      const member = candidates.sort((a, b) => rank(a.id) - rank(b.id))[0];
      if (!member) throw new Error(`没有角色为「${target}」的成员可以登录`);
      return member.id;
    }
    const fixture = getDemoFixture().members.find((m) => m.key === target.member);
    if (!fixture) throw new Error(`示例数据里没有成员 ${target.member}`);
    if (!members.some((m) => m.id === fixture.id)) {
      throw new Error(`成员 ${target.member}（${fixture.role}）不在开发登录的可选成员里`);
    }
    return fixture.id;
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

    addMember: (member) => transaction(runtime, (tx) => createMember(tx, member)),

    runJobs: (runOptions) => runQueuedJobs(runtime, { handlers, feeds }, silentLogger, runOptions),

    enqueue: (job, payload, jobOptions) =>
      transaction(runtime, (tx) => tx.enqueue(job, payload, jobOptions)),

    resetFakes: () => clients.resetFakes(),

    loadFixtures: () =>
      loadFixtures(runtime, { appEnv: setupEnv, fixture: getDemoFixture(), steps: fixtureSteps }),

    auditRecords: (query) => findAuditRecords(runtime.db, query),

    addSenderRule: (rule) => transaction(runtime, (tx) => registerSenderRule(tx, rule)),

    receivedMail: (filter) => listReceivedMail(runtime.db, SYSTEM_STORE_SCOPE, filter),

    resetInbound: () => resetInboundData(runtime, appEnv),

    async addHistoryImport(row) {
      const now = clock.now();
      await runtime.db
        .insert(aftersales)
        .values({ origin: 'history_import', createdAt: now, updatedAt: now, ...row });
    },

    close,
  };
}
