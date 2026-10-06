import {
  devDingtalkScanResponseSchema,
  devMembersResponseSchema,
  dingtalkLoginStartSchema,
  roleByLabel,
  roles,
  type Role,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import type { Hono } from 'hono';
import type { JobOptions } from 'pg-boss';
import { createApp } from '../src/app';
import type { ServerDeps } from '../src/deps';
import { fixtureSteps } from '../src/fixture-steps';
import { runImportAftersalesCommand } from '../src/import-aftersales-command';
import { createFeeds, createJobHandlers } from '../src/jobs';
import {
  importAftersalesHistory,
  parseHistoryMapping,
  readHistorySheet,
  type HistoryCell,
  type HistoryImportReport,
  type HistoryMapping,
  type HistorySheet,
} from '../src/modules/aftersales';
import {
  listOrderStores,
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
import {
  databaseCredentialVault,
  IntegrationClients,
  type AnyClientDefinition,
} from '../src/modules/integration';
import {
  findOrder,
  findOrdersByEmail,
  type MirroredOrder,
  type OrderRef,
} from '../src/modules/order';
import {
  createMember,
  orgMembersFixtureStep,
  type AccessVariables,
  type NewMember,
} from '../src/modules/org';
import { resetInboundData, type InboundResetReport } from '../src/reset-inbound-data';
import { createApiClient, type ApiClient, type RequestHandler } from './api-client';
import { createTestDatabase } from './database';
import sampleMappingJson from './fixtures/history-import/mapping.json' with { type: 'json' };
import { runQueuedJobs, type JobRunReport, type RunJobsOptions } from './run-jobs';

/*
 * 主接缝的测试工具（规格「测试接缝」，待办 02）：每个测试文件一个独立的库（从迁移好的模板复制），
 * 在测试进程内直接调用 Hono 应用，外部客户端全部是 Fake，时间由手动时钟控制，后台任务由测试同步跑完。
 * 用法见 dev-login.int.test.ts（示范用例）与 harness.int.test.ts。
 */

/** 售后登记表的合成样本的映射表（test/fixtures/history-import/mapping.json），t.importAftersales 默认用它 */
export const SAMPLE_HISTORY_MAPPING = parseHistoryMapping(sampleMappingJson, 'mapping.json');

/** 要导入的售后登记表：一个文件（.xlsx / .csv），或测试里现造的几行（按表头给值，没给的列为空） */
export type HistoryImportSource =
  { readonly file: string } | { readonly rows: readonly Readonly<Record<string, HistoryCell>>[] };

export interface HistoryImportRunOptions {
  /** 默认是合成样本的映射表 */
  readonly mapping?: HistoryMapping;
  readonly dryRun?: boolean;
}

/** 现造的几行 → 一张表：表头是映射表用到的全部列加上各行出现过的列，第 1 行是表头，数据从第 2 行起 */
function sheetOfRows(
  rows: readonly Readonly<Record<string, HistoryCell>>[],
  mapping: HistoryMapping,
): HistorySheet {
  const mapped = Object.values(mapping.columns).flatMap((names) =>
    names === undefined ? [] : Array.isArray(names) ? names : [names],
  );
  const header = [
    ...new Set([...mapping.rowKey, ...mapped, ...rows.flatMap((row) => Object.keys(row))]),
  ];
  return {
    name: '测试数据',
    header,
    rows: rows.map((row, index) => ({ row: index + 2, cells: header.map((h) => row[h] ?? null) })),
  };
}

/** 测试库里加密动态凭据的主密钥（32 字节；只在测试里，真实环境是 CREDENTIAL_MASTER_KEY） */
export const TEST_CREDENTIAL_MASTER_KEY = Buffer.alloc(32, 0x5a);

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
   * 钉钉扫码登录（Fake 钉钉，待办 05）：像浏览器一样开一次登录（拿到 state 的 Cookie）→ 模拟这位钉钉用户在手机上扫码确认
   * （开发工具 /api/dev/dingtalk/scan）→ 带着授权码与 state 换会话。返回这个浏览器与换会话的响应（被拒、失败也照常返回）。
   * 示例成员的钉钉用户 ID 是夹具的 key（如 liting）；通讯录里的人见 Fake 钉钉（t.clients.fake(dingtalkClient)）
   */
  scanLogin(
    dingtalkUserId: string,
    options?: { ip?: string },
  ): Promise<{ client: ApiClient; response: Response }>;
  /**
   * 新增一位成员（多角色、店铺范围受限等示例数据里没有的情形），返回成员 id。经 org 的 createMember 直接建（P20 成员管理随 06）；
   * 要扫码登录的给出 dingtalkUserId，并在 Fake 钉钉的通讯录里放一个同 ID 的人（否则对账会把他当成离职）。
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
  /**
   * 按动作或对象取原始审计记录（core.audit_log 的行，不经查看范围与财务字段过滤），核对写入了什么。
   * P27 看到的样子（10.2 过滤、写成中文、「已隐藏」）经接口 GET /api/audit 断言，见 audit-log.int.test.ts
   */
  auditRecords(query?: AuditQuery): Promise<AuditRecord[]>;
  /**
   * 登记一条来源规则（第一期没有维护页面，规则随迁移与示例数据登记；测试里登记示例数据没有的，例如其他供应商）
   */
  addSenderRule(rule: SenderRule & { readonly label: string }): Promise<void>;
  /** 收取的邮件（含归档的平台通知与营销，按到达时间先后；第一期没有查看页面，用它核对「归档不丢信」） */
  receivedMail(filter?: { readonly mailbox?: string }): Promise<ReceivedMail[]>;
  /**
   * 在某店铺内按订单名或平台订单号查订单（order 的 findOrder，系统操作的范围：归并等后台流程就这样调用，待办 11）：
   * 镜像没有、给的是订单名时按订单名补拉并入库。第一期没有查订单的页面，订单镜像的效果经它核对
   */
  findOrder(storeId: string, ref: OrderRef): Promise<MirroredOrder | null>;
  /** 在某店铺内按客户邮箱反查订单（order 的 findOrdersByEmail，只查镜像，R-ST-03） */
  ordersByEmail(storeId: string, email: string): Promise<MirroredOrder[]>;
  /** 重放来信（运维命令 reset-inbound 的同一个函数，按本测试的运行环境：生产环境拒绝） */
  resetInbound(): Promise<InboundResetReport>;
  /**
   * 售后登记表导入（运维命令 import-aftersales 的同一个函数，待办 27）：历史导入的售后单都经它进库，效果经主接缝核对
   * （ADR 0005 修订：运维命令经测试工具调用，同 t.resetInbound）。映射表默认是合成样本的。
   */
  importAftersales(
    source: HistoryImportSource,
    options?: HistoryImportRunOptions,
  ): Promise<HistoryImportReport>;
  /**
   * 按命令行参数执行售后登记表导入命令（入口 import-aftersales 的同一个函数，连的是本测试的库），返回退出码与输出；
   * 核对参数、退出码与随镜像打包的默认映射表
   */
  runImportCommand(
    argv: readonly string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
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

  const clients = new IntegrationClients({
    appEnv,
    definitions: options.clientDefinitions,
    // 真实现的「当前时间」也走手动时钟；动态凭据用测试主密钥加密存进本测试的库（Shopify 凭据没配置，真实接口为未连接）
    clock,
    credentialVault: databaseCredentialVault(runtime, TEST_CREDENTIAL_MASTER_KEY),
  });
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

    async scanLogin(dingtalkUserId, loginOptions = {}) {
      const client = createApiClient(app, { ip: loginOptions.ip ?? TEST_CLIENT_IP });
      const start = await client.post('/api/auth/dingtalk/start');
      if (start.status !== 200)
        throw new Error(`开始扫码登录失败（${start.status}）：${await start.text()}`);
      const { state } = dingtalkLoginStartSchema.parse(await start.json());
      const scan = await client.post('/api/dev/dingtalk/scan', { userId: dingtalkUserId });
      if (scan.status !== 200)
        throw new Error(`模拟扫码失败（${scan.status}）：${await scan.text()}`);
      const { authCode } = devDingtalkScanResponseSchema.parse(await scan.json());
      const response = await client.post('/api/auth/dingtalk/login', { authCode, state });
      return { client, response };
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

    async findOrder(storeId, ref) {
      const store = (await listOrderStores(runtime.db)).find((s) => s.id === storeId);
      if (!store) throw new Error(`没有店铺 ${storeId}`);
      return findOrder(runtime, clients, SYSTEM_STORE_SCOPE, store, ref);
    },

    ordersByEmail: (storeId, email) =>
      findOrdersByEmail(runtime.db, SYSTEM_STORE_SCOPE, { storeId, email }),

    resetInbound: () => resetInboundData(runtime, appEnv),

    async importAftersales(source, importOptions = {}) {
      const mapping = importOptions.mapping ?? SAMPLE_HISTORY_MAPPING;
      const sheet =
        'file' in source
          ? await readHistorySheet(source.file, {
              sheet: mapping.sheet,
              headerRow: mapping.headerRow,
            })
          : sheetOfRows(source.rows, mapping);
      return importAftersalesHistory(runtime, sheet, mapping, { dryRun: importOptions.dryRun });
    },

    async runImportCommand(argv) {
      let stdout = '';
      let stderr = '';
      const exitCode = await runImportAftersalesCommand(
        argv,
        () => Promise.resolve({ runtime, stop: () => Promise.resolve() }),
        {
          stdout: (text) => {
            stdout += text;
          },
          stderr: (text) => {
            stderr += text;
          },
        },
      );
      return { exitCode, stdout, stderr };
    },

    close,
  };
}
