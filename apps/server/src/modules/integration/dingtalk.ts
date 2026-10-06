import type { DemoFixture } from '@forcome/fixtures';
import { z } from 'zod';
import type { DingtalkCredentials } from '../core';
import { defineClient, type FakeClient } from './definition';
import { fixtureDirectory } from './dingtalk-replay';
import { createDingtalkStream, type DingtalkStream } from './dingtalk-stream';
import { ExternalCallFailedError, ExternalServiceError, FaultInjector } from './faults';
import { createHttpClient, type HttpClient } from './http';

/*
 * 钉钉企业内部应用（规格 org「钉钉 Stream 通讯录事件 + 每小时全量对账」「钉钉扫码登录」、core「钉钉工作通知」，
 * PRD D-16、11.4，待办 05）。全局客户端，按 CLIENT_MODE_DINGTALK 选择：开发与测试默认 Fake，生产默认真实接口。
 * 一个接口覆盖四件事：
 * - 通讯录：全量读取（每小时对账）、按 ID 取一个成员或部门（处理变更事件时）；
 * - 通讯录变更事件：Stream 长连接推来，worker 的常驻拉取取走、转成后台任务后确认（同 Gmail 推送）；
 * - 扫码登录：用浏览器带回的授权码换出扫码人的钉钉用户 ID；
 * - 工作通知：发一条文本给几个人。
 * 真实现经出站 HTTP 客户端工厂（境内域名按 NO_PROXY 直连，ADR 0003）；接口细节见各函数的注释，真实环境验收见待办 29。
 */

/** 钉钉部门（PRD 11.1 Department：钉钉部门 ID、名称、上级部门） */
export interface DingtalkDepartment {
  /** 钉钉部门 ID（数字，按字符串存）；根部门是 1（组织本身） */
  readonly id: string;
  readonly name: string;
  /** 上级部门；根部门为 null */
  readonly parentId: string | null;
}

/** 通讯录里的一位成员 */
export interface DingtalkUser {
  /** 钉钉用户 ID（userid，组织内唯一） */
  readonly userId: string;
  readonly name: string;
  /** 所在部门，第一个是主部门（显示「FSH / 客服部」取它） */
  readonly departmentIds: readonly string[];
  /** 企业邮箱，没有取个人邮箱；都没有为 null */
  readonly email: string | null;
}

/** 通讯录的全量快照（每小时对账用） */
export interface DingtalkDirectory {
  readonly departments: readonly DingtalkDepartment[];
  readonly users: readonly DingtalkUser[];
}

/** Stream 推来的一条通讯录事件 */
export interface DingtalkEvent {
  /** Stream 消息 ID：处理完（转成后台任务）后用它确认；不确认的，钉钉稍后重推 */
  readonly messageId: string;
  /** 事件类型，如 user_add_org、user_modify_org、user_leave_org、org_dept_create、org_dept_modify、org_dept_remove */
  readonly type: string;
  /** 事件 ID（同一事件重推时不变），记日志排错用 */
  readonly eventId: string | null;
  /** 涉及的成员（用户事件） */
  readonly userIds: readonly string[];
  /** 涉及的部门（部门事件） */
  readonly departmentIds: readonly string[];
}

export interface DingtalkClient {
  /** 扫码登录用的 client_id（真实接口的 Client ID；Fake 为 null，登录页画示意二维码） */
  readonly loginClientId: string | null;
  /** 全量读取通讯录：全部部门（从根部门逐层往下）与各部门的成员（分页取完），成员按用户 ID 去重 */
  readDirectory(): Promise<DingtalkDirectory>;
  /** 取一位成员；不在通讯录里（已离职）为 null */
  getUser(userId: string): Promise<DingtalkUser | null>;
  /** 取一个部门；已删除为 null */
  getDepartment(departmentId: string): Promise<DingtalkDepartment | null>;
  /** 扫码登录：授权码换出扫码人的钉钉用户 ID。授权码无效、已用过或不是本组织的人抛 DingtalkAuthCodeError */
  userIdByAuthCode(authCode: string): Promise<string>;
  /** 发一条文本工作通知给几个人（每次最多 100 人），返回钉钉的任务 ID */
  sendWorkNotification(input: {
    readonly userIds: readonly string[];
    readonly text: string;
  }): Promise<{ taskId: string }>;
  /** 取 Stream 推来的通讯录事件；waitSeconds 为 0 时立即返回，否则最多等这么久。连不上时抛 ConnectionLostError 等 */
  pullEvents(options: { readonly waitSeconds: number }): Promise<DingtalkEvent[]>;
  /** 确认已处理（已转成后台任务）的事件 */
  acknowledgeEvents(messageIds: readonly string[]): Promise<void>;
  /** 断开 Stream（worker 停止、或不再是持有长连接的那一个时）；下次 pullEvents 重新连 */
  closeEvents(): Promise<void>;
}

/** 扫码登录的授权码无效、已用过或已过期，或扫码人不是本组织的成员（不可重试，界面提示重新扫码） */
export class DingtalkAuthCodeError extends ExternalServiceError {
  override name = 'DingtalkAuthCodeError';

  constructor(message = '授权码无效或已使用') {
    super('dingtalk', 'login', message, false);
  }
}

// ---------------------------------------------------------------- 真实现

const OAPI = 'https://oapi.dingtalk.com';
const API = 'https://api.dingtalk.com';
/** 根部门 ID（组织本身） */
export const DINGTALK_ROOT_DEPARTMENT = '1';
/** 成员列表每页条数（接口上限 100） */
const PAGE_SIZE = 100;
/** 工作通知每次最多发给的人数（接口上限 100） */
export const WORK_NOTIFICATION_MAX_USERS = 100;
/** 访问凭证有效期 2 小时，提前 5 分钟换新 */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

/** 旧版服务端接口（oapi）的错误码：访问凭证失效（换新后重试一次）、限流（可重试）、对象不存在 */
const TOKEN_INVALID = new Set([40001, 40014, 42001]);
const THROTTLED = new Set([88, 90002, 90018, 92004]);
const USER_NOT_FOUND = 60121;
const DEPARTMENT_NOT_FOUND = 60003;

const oapiEnvelope = z.looseObject({ errcode: z.number(), errmsg: z.string().optional() });

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number() });

const departmentSchema = z.object({
  dept_id: z.number(),
  name: z.string(),
  parent_id: z.number().optional(),
});

const userSchema = z.object({
  userid: z.string(),
  name: z.string(),
  dept_id_list: z.array(z.number()).default([]),
  org_email: z.string().optional(),
  email: z.string().optional(),
});

const userPageSchema = z.object({
  has_more: z.boolean(),
  next_cursor: z.number().optional(),
  list: z.array(userSchema),
});

function toDepartment(row: z.infer<typeof departmentSchema>): DingtalkDepartment {
  const id = String(row.dept_id);
  return {
    id,
    name: row.name,
    parentId:
      id === DINGTALK_ROOT_DEPARTMENT || row.parent_id === undefined ? null : String(row.parent_id),
  };
}

function toUser(row: z.infer<typeof userSchema>): DingtalkUser {
  return {
    userId: row.userid,
    name: row.name,
    departmentIds: row.dept_id_list.map(String),
    email: row.org_email || row.email || null,
  };
}

function unrecognized(operation: string, error: z.ZodError): ExternalCallFailedError {
  return new ExternalCallFailedError('dingtalk', operation, {
    message: `返回内容不认识：${error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('；')}`,
    retryable: false,
  });
}

function parse<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw unrecognized(operation, parsed.error);
  return parsed.data;
}

/**
 * 钉钉的真实现：旧版服务端接口（oapi.dingtalk.com，通讯录、unionid 换 userid、工作通知）用应用的访问凭证；
 * 新版接口（api.dingtalk.com）用于扫码登录换用户凭证与取个人信息。Stream 另由 dingtalk-stream.ts 维持长连接。
 * 时钟只用于访问凭证的缓存（真实时间，不是业务时间）。
 */
export function createRealDingtalkClient(
  http: HttpClient,
  credentials: DingtalkCredentials,
  stream: DingtalkStream,
  now: () => number = Date.now,
): DingtalkClient {
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - TOKEN_REFRESH_MARGIN_MS > now()) return token.value;
    const query = new URLSearchParams({
      appkey: credentials.clientId,
      appsecret: credentials.clientSecret,
    });
    const body = await http.getJson(`${OAPI}/gettoken?${query.toString()}`, {
      operation: 'gettoken',
    });
    const envelope = checked(parse(oapiEnvelope, body, 'gettoken'), 'gettoken');
    const parsed = parse(tokenSchema, envelope, 'gettoken');
    token = { value: parsed.access_token, expiresAt: now() + parsed.expires_in * 1000 };
    return token.value;
  }

  /** 旧版接口返回 HTTP 200，错误在 errcode 里：翻译成 faults.ts 的那一套错误 */
  function checked(
    envelope: z.infer<typeof oapiEnvelope>,
    operation: string,
  ): z.infer<typeof oapiEnvelope> {
    if (envelope.errcode === 0) return envelope;
    throw new ExternalCallFailedError('dingtalk', operation, {
      message: `errcode ${envelope.errcode}：${envelope.errmsg ?? ''}`,
      retryable: THROTTLED.has(envelope.errcode),
    });
  }

  /** 调一个旧版接口：访问凭证失效时换新再试一次；返回 errcode 为 0 的整个返回体，或 allowed 里允许的错误码 */
  async function oapi(
    path: string,
    body: unknown,
    allowed: readonly number[] = [],
  ): Promise<z.infer<typeof oapiEnvelope>> {
    const operation = path.replace(/^\/topapi\//, '');
    for (let attempt = 0; ; attempt += 1) {
      const url = `${OAPI}${path}?access_token=${encodeURIComponent(await accessToken())}`;
      const envelope = parse(
        oapiEnvelope,
        await http.postJson(url, body, { operation }),
        operation,
      );
      if (TOKEN_INVALID.has(envelope.errcode) && attempt === 0) {
        token = null;
        continue;
      }
      if (allowed.includes(envelope.errcode)) return envelope;
      return checked(envelope, operation);
    }
  }

  async function subDepartments(parentId: string): Promise<DingtalkDepartment[]> {
    const envelope = await oapi('/topapi/v2/department/listsub', { dept_id: Number(parentId) });
    return parse(z.array(departmentSchema), envelope.result, 'v2/department/listsub').map(
      toDepartment,
    );
  }

  async function departmentUsers(departmentId: string): Promise<DingtalkUser[]> {
    const users: DingtalkUser[] = [];
    for (let cursor = 0; ;) {
      const envelope = await oapi('/topapi/v2/user/list', {
        dept_id: Number(departmentId),
        cursor,
        size: PAGE_SIZE,
      });
      const page = parse(userPageSchema, envelope.result, 'v2/user/list');
      users.push(...page.list.map(toUser));
      if (!page.has_more || page.next_cursor === undefined) return users;
      cursor = page.next_cursor;
    }
  }

  async function getDepartment(departmentId: string): Promise<DingtalkDepartment | null> {
    const envelope = await oapi('/topapi/v2/department/get', { dept_id: Number(departmentId) }, [
      DEPARTMENT_NOT_FOUND,
    ]);
    if (envelope.errcode === DEPARTMENT_NOT_FOUND) return null;
    return toDepartment(parse(departmentSchema, envelope.result, 'v2/department/get'));
  }

  return {
    loginClientId: credentials.clientId,

    async readDirectory() {
      // 部门只返回下一级，从根部门逐层往下取全；每个部门的成员只含本部门（不含子部门），逐个部门取
      const root = await getDepartment(DINGTALK_ROOT_DEPARTMENT);
      if (!root) {
        throw new ExternalCallFailedError('dingtalk', 'v2/department/get', {
          message: '取不到根部门',
          retryable: false,
        });
      }
      const departments: DingtalkDepartment[] = [root];
      for (let i = 0; i < departments.length; i += 1) {
        departments.push(...(await subDepartments(departments[i]?.id ?? '')));
      }
      const users = new Map<string, DingtalkUser>();
      for (const department of departments) {
        for (const user of await departmentUsers(department.id)) {
          if (!users.has(user.userId)) users.set(user.userId, user);
        }
      }
      return { departments, users: [...users.values()] };
    },

    async getUser(userId) {
      const envelope = await oapi('/topapi/v2/user/get', { userid: userId }, [USER_NOT_FOUND]);
      if (envelope.errcode === USER_NOT_FOUND) return null;
      return toUser(parse(userSchema, envelope.result, 'v2/user/get'));
    },

    getDepartment,

    async userIdByAuthCode(authCode) {
      // 1. 授权码换用户凭证（新版接口；授权码无效、过期或已用过时返回 4xx）
      let userToken: string;
      try {
        const body = await http.postJson(
          `${API}/v1.0/oauth2/userAccessToken`,
          {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            code: authCode,
            grantType: 'authorization_code',
          },
          { operation: 'oauth2/userAccessToken' },
        );
        const parsed = parse(
          z.object({ accessToken: z.string().min(1), corpId: z.string().optional() }),
          body,
          'oauth2/userAccessToken',
        );
        // scope 含 corpid 时返回扫码人选的组织：企业内部应用只允许本组织成员登录，再核对一次
        if (parsed.corpId && parsed.corpId !== credentials.corpId) {
          throw new DingtalkAuthCodeError('扫码人不是本组织的成员');
        }
        userToken = parsed.accessToken;
      } catch (error) {
        if (
          error instanceof ExternalCallFailedError &&
          error.status !== null &&
          error.status >= 400 &&
          error.status < 500
        ) {
          throw new DingtalkAuthCodeError();
        }
        throw error;
      }
      // 2. 用户凭证取个人信息（unionId）
      const me = parse(
        z.looseObject({ unionId: z.string().min(1) }),
        await http.getJson(`${API}/v1.0/contact/users/me`, {
          operation: 'contact/users/me',
          headers: { 'x-acs-dingtalk-access-token': userToken },
        }),
        'contact/users/me',
      );
      // 3. unionId 换本组织的用户 ID；不是本组织的成员时没有
      const envelope = await oapi('/topapi/user/getbyunionid', { unionid: me.unionId }, [
        USER_NOT_FOUND,
      ]);
      if (envelope.errcode === USER_NOT_FOUND) {
        throw new DingtalkAuthCodeError('扫码人不是本组织的成员');
      }
      return parse(z.object({ userid: z.string().min(1) }), envelope.result, 'user/getbyunionid')
        .userid;
    },

    async sendWorkNotification({ userIds, text }) {
      if (userIds.length === 0 || userIds.length > WORK_NOTIFICATION_MAX_USERS) {
        throw new RangeError(`工作通知每次发给 1–${WORK_NOTIFICATION_MAX_USERS} 人`);
      }
      const envelope = await oapi('/topapi/message/corpconversation/asyncsend_v2', {
        agent_id: Number(credentials.agentId),
        userid_list: userIds.join(','),
        msg: { msgtype: 'text', text: { content: text } },
      });
      const taskId = parse(z.union([z.number(), z.string()]), envelope.task_id, 'asyncsend_v2');
      return { taskId: String(taskId) };
    },

    pullEvents: (options) => stream.pull(options),
    acknowledgeEvents: (messageIds) => stream.acknowledge(messageIds),
    closeEvents: () => stream.close(),
  };
}

function realDingtalk(credentials: DingtalkCredentials | null): DingtalkClient {
  if (!credentials) {
    // loadConfig 已在启动时要求凭据；直接构造（测试、脚本）时这里再挡一次
    throw new Error('钉钉用真实接口时要配置 DINGTALK_CLIENT_ID 等凭据（docs/部署说明.md「钉钉」）');
  }
  const http = createHttpClient('dingtalk');
  return createRealDingtalkClient(http, credentials, createDingtalkStream(http, credentials));
}

// ---------------------------------------------------------------- Fake

/** 发出的一条工作通知（测试断言用） */
export interface SentWorkNotification {
  readonly userIds: readonly string[];
  readonly text: string;
  readonly taskId: string;
}

interface QueuedEvent extends DingtalkEvent {
  readonly sequence: number;
}

/**
 * Fake 钉钉：内存里的通讯录、Stream 事件队列、扫码授权码与发出的工作通知。
 * - 测试与开发支撑改通讯录：addUser、updateUser、removeUser（离职）、addDepartment、updateDepartment、removeDepartment，
 *   默认同时推一条对应的 Stream 事件；{ silent: true } 只改通讯录不推事件（模拟断线期间漏掉的事件，由全量对账补上）；
 * - issueAuthCode(用户 ID) 模拟「手机扫码并确认」，给出一个一次性的授权码；
 * - sent 是发出的工作通知；faults 的操作名：directory、getUser、getDepartment、login、send、events。
 * 进程启动时从示例数据夹具回放通讯录（示例成员与两家生产厂的负责人），dingtalk-replay.ts。
 */
export class FakeDingtalk implements FakeClient<DingtalkClient> {
  readonly faults = new FaultInjector('dingtalk');
  readonly #departments = new Map<string, DingtalkDepartment>();
  readonly #users = new Map<string, DingtalkUser>();
  #queue: QueuedEvent[] = [];
  readonly #outstanding = new Map<string, QueuedEvent>();
  readonly #authCodes = new Map<string, string>();
  #sent: SentWorkNotification[] = [];
  #nextId = 1;

  /** 发出的工作通知（按先后） */
  get sent(): readonly SentWorkNotification[] {
    return this.#sent;
  }

  /** 还没确认的事件数（包括已拉走未确认的） */
  get unacknowledged(): number {
    return this.#queue.length + this.#outstanding.size;
  }

  /** 通讯录里现在的成员（测试核对用） */
  get users(): readonly DingtalkUser[] {
    return [...this.#users.values()];
  }

  #push(
    type: string,
    ids: { userIds?: readonly string[]; departmentIds?: readonly string[] },
    silent = false,
  ): void {
    if (silent) return;
    const sequence = this.#nextId++;
    this.#queue.push({
      messageId: `msg-${sequence}`,
      eventId: `event-${sequence}`,
      type,
      userIds: ids.userIds ?? [],
      departmentIds: ids.departmentIds ?? [],
      sequence,
    });
  }

  addDepartment(department: DingtalkDepartment, options: { silent?: boolean } = {}): void {
    this.#departments.set(department.id, department);
    this.#push('org_dept_create', { departmentIds: [department.id] }, options.silent);
  }

  updateDepartment(
    id: string,
    patch: Partial<Omit<DingtalkDepartment, 'id'>>,
    options: { silent?: boolean } = {},
  ): void {
    const found = this.#departments.get(id);
    if (!found) throw new Error(`Fake 钉钉没有部门 ${id}`);
    this.#departments.set(id, { ...found, ...patch });
    this.#push('org_dept_modify', { departmentIds: [id] }, options.silent);
  }

  removeDepartment(id: string, options: { silent?: boolean } = {}): void {
    this.#departments.delete(id);
    this.#push('org_dept_remove', { departmentIds: [id] }, options.silent);
  }

  addUser(user: DingtalkUser, options: { silent?: boolean } = {}): void {
    this.#users.set(user.userId, user);
    this.#push('user_add_org', { userIds: [user.userId] }, options.silent);
  }

  updateUser(
    userId: string,
    patch: Partial<Omit<DingtalkUser, 'userId'>>,
    options: { silent?: boolean } = {},
  ): void {
    const found = this.#users.get(userId);
    if (!found) throw new Error(`Fake 钉钉没有成员 ${userId}`);
    this.#users.set(userId, { ...found, ...patch });
    this.#push('user_modify_org', { userIds: [userId] }, options.silent);
  }

  /** 成员离职：从通讯录删除，推 user_leave_org */
  removeUser(userId: string, options: { silent?: boolean } = {}): void {
    this.#users.delete(userId);
    this.#push('user_leave_org', { userIds: [userId] }, options.silent);
  }

  /** 模拟某人在手机上扫码并确认：给出一次性的授权码（浏览器会带着它回到登录页） */
  issueAuthCode(userId: string): string {
    const code = `fake-auth-${this.#nextId++}`;
    this.#authCodes.set(code, userId);
    return code;
  }

  client(): DingtalkClient {
    return {
      loginClientId: null,
      readDirectory: async () => {
        await this.faults.check('directory');
        return { departments: [...this.#departments.values()], users: [...this.#users.values()] };
      },
      getUser: async (userId) => {
        await this.faults.check('getUser');
        return this.#users.get(userId) ?? null;
      },
      getDepartment: async (departmentId) => {
        await this.faults.check('getDepartment');
        return this.#departments.get(departmentId) ?? null;
      },
      userIdByAuthCode: async (authCode) => {
        await this.faults.check('login');
        const userId = this.#authCodes.get(authCode);
        // 授权码只能用一次
        this.#authCodes.delete(authCode);
        if (!userId) throw new DingtalkAuthCodeError();
        return userId;
      },
      sendWorkNotification: async ({ userIds, text }) => {
        await this.faults.check('send');
        const taskId = `task-${this.#nextId++}`;
        this.#sent.push({ userIds: [...userIds], text, taskId });
        return { taskId };
      },
      pullEvents: async () => {
        await this.faults.check('events');
        // 上次拉走没确认的先重投（钉钉对没确认的消息会重推）
        this.#queue.unshift(...this.#outstanding.values());
        this.#outstanding.clear();
        this.#queue.sort((a, b) => a.sequence - b.sequence);
        const batch = this.#queue.splice(0);
        for (const event of batch) this.#outstanding.set(event.messageId, event);
        return batch.map(({ sequence: _sequence, ...event }) => event);
      },
      acknowledgeEvents: (messageIds) => {
        for (const id of messageIds) this.#outstanding.delete(id);
        return Promise.resolve();
      },
      closeEvents: () => Promise.resolve(),
    };
  }

  reset(): void {
    this.#departments.clear();
    this.#users.clear();
    this.#queue = [];
    this.#outstanding.clear();
    this.#authCodes.clear();
    this.#sent = [];
    this.#nextId = 1;
    this.faults.reset();
  }

  /** 从示例数据夹具回放通讯录（不推事件：这是钉钉里本来就有的人，由全量对账同步进来） */
  replay(fixture: DemoFixture): void {
    const directory = fixtureDirectory(fixture);
    for (const department of directory.departments) {
      this.#departments.set(department.id, department);
    }
    for (const user of directory.users) this.#users.set(user.userId, user);
  }
}

/** 钉钉（全局，按 CLIENT_MODE_DINGTALK 选择；不设时非生产为 Fake、生产为真实接口） */
export const dingtalkClient = defineClient({
  system: 'dingtalk',
  scope: 'global',
  createReal: ({ dingtalk }) => realDingtalk(dingtalk),
  createFake: () => new FakeDingtalk(),
});
