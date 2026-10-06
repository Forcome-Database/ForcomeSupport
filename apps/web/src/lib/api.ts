import {
  adminContactsSchema,
  aftersalesDetailSchema,
  apiErrorSchema,
  assignStoreResultSchema,
  auditLogOptionsSchema,
  auditLogSchema,
  BACKGROUND_REQUEST_HEADER,
  channelAlertsSchema,
  channelSettingsSchema,
  connectionTestResultSchema,
  currentMemberSchema,
  devMembersResponseSchema,
  dingtalkLoginStartSchema,
  exchangeRatesOnSchema,
  EXPORT_ROWS_HEADER,
  ledgerItemSchema,
  ledgerOptionsSchema,
  ledgerSchema,
  loginDeniedSchema,
  loginFailedSchema,
  notificationListSchema,
  notificationUnreadSchema,
  preferencesSchema,
  registrationOptionsSchema,
  sourceTicketSchema,
  storeOptionsSchema,
  storeSchema,
  teamCandidatesSchema,
  teamMemberSchema,
  teamSchema,
  ticketListSchema,
  unassignedMailListSchema,
  type AdminContacts,
  type AftersalesDetail,
  type AssignStoreResult,
  type AuditLog,
  type AuditLogFilter,
  type AuditLogOptions,
  type AuditLogQuery,
  type CancelInput,
  type ChannelAlert,
  type ChannelSettings,
  type ConnectionTestKind,
  type ConnectionTestResult,
  type CurrentMember,
  type DevMember,
  type DingtalkLoginRequest,
  type DingtalkLoginStart,
  type ExchangeRatesOn,
  type FieldErrors,
  type Ledger,
  type LedgerItem,
  type LedgerOptions,
  type LedgerQuery,
  type LoginDenialReason,
  type LoginDenied,
  type LoginFailureReason,
  type NotificationList,
  type NotificationView,
  type Preferences,
  type RegistrationInput,
  type RegistrationOptions,
  type RegistrationUpdate,
  type SourceTicket,
  type Store,
  type StoreInput,
  type StoreOption,
  type StoreUpdate,
  type Team,
  type TeamCandidate,
  type TeamChange,
  type TeamMember,
  type TeamMemberAdd,
  type TicketListItem,
  type UnassignedMailList,
} from '@forcome/contracts';
import type { z } from 'zod';

/*
 * 调后端接口（ADR 0007 修订）：fetch + contracts 的 zod 模式解析响应，前端不引用后端代码。
 * 会话在 httpOnly Cookie 里，同源请求自动带上。
 */

/** 接口返回了错误（status 为 HTTP 状态码，code 为 contracts 约定的错误码） */
export class ApiRequestError extends Error {
  override name = 'ApiRequestError';
  readonly status: number;
  readonly code: string;
  /** 表单字段填错时（400 invalid_request）每个字段的错误，键为字段路径（如 mailboxes.2） */
  readonly fields: FieldErrors | undefined;

  constructor(status: number, code: string, message: string, fields?: FieldErrors) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** 连不上服务器（断网、服务未启动）：fetch 本身失败，没有拿到响应；原始错误在 cause 里 */
export class NetworkError extends ApiRequestError {
  override name = 'NetworkError';

  constructor(cause: unknown) {
    super(0, 'network', '网络不可用');
    this.cause = cause;
  }
}

/** 失败的原因，接在「保存失败：」之类的标题后面：接口错误取后端的中文说明，连不上写「网络不可用」 */
export function failureReason(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : '请稍后再试';
}

/** 登录被拒（G12）：reason 决定显示哪一种被拒画面；扫码登录时另给出被拒的是谁（生产厂对接人那一种写在卡片上） */
export class LoginDeniedError extends ApiRequestError {
  override name = 'LoginDeniedError';
  readonly reason: LoginDenialReason;
  readonly member: LoginDenied['member'];

  constructor(reason: LoginDenialReason, message: string, member?: LoginDenied['member']) {
    super(403, 'login_denied', message);
    this.reason = reason;
    this.member = member;
  }
}

/** 扫码登录失败（不是被拒）：授权码已失效、这次登录的 state 对不上、连不上钉钉；界面回到二维码并弹失败浮层 */
export class LoginFailedError extends ApiRequestError {
  override name = 'LoginFailedError';
  readonly reason: LoginFailureReason;

  constructor(status: number, reason: LoginFailureReason, message: string) {
    super(status, 'login_failed', message);
    this.reason = reason;
  }
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 导出得到的文件：内容、文件名与行数 */
export interface ExportedFile {
  readonly blob: Blob;
  readonly fileName: string;
  readonly rows: number;
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...init?.headers },
  }).catch((error: unknown) => {
    // 主动中止的请求（页面离开、查询取消）不是断网，原样抛出
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError(error);
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const denied = loginDeniedSchema.safeParse(body);
    if (denied.success) {
      throw new LoginDeniedError(denied.data.reason, denied.data.message, denied.data.member);
    }
    const failed = loginFailedSchema.safeParse(body);
    if (failed.success) {
      throw new LoginFailedError(response.status, failed.data.reason, failed.data.message);
    }
    const error = apiErrorSchema.safeParse(body);
    throw new ApiRequestError(
      response.status,
      error.success ? error.data.error : 'http_error',
      error.success ? error.data.message : `请求失败（${response.status}）`,
      error.success ? error.data.fields : undefined,
    );
  }
  return response;
}

/**
 * 下载服务端同步生成的文件（S11、K5）：返回文件、文件名（Content-Disposition 的 filename*）与行数。
 * 失败时抛 ApiRequestError（同其他接口）
 */
async function download(path: string, fallbackName: string): Promise<ExportedFile> {
  const response = await send(path, { headers: { accept: XLSX_TYPE } });
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  return {
    blob: await response.blob(),
    fileName: encoded ? decodeURIComponent(encoded) : fallbackName,
    rows: Number(response.headers.get(EXPORT_ROWS_HEADER) ?? 0),
  };
}

async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  return schema.parse(await response.json());
}

/**
 * 后台请求（铃铛的轮询、以后 SSE 推送后的重新拉取）：不是人的操作，服务端照常校验会话但不续期，
 * 否则开着页面会话就永远不会过期（ADR 0010 修订「7 天无操作过期」）
 */
const backgroundRequest: RequestInit = { headers: { [BACKGROUND_REQUEST_HEADER]: '1' } };

function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

/** 查询条件写成地址的查询串（没给的条件不写；一个都没有为空串） */
function queryString(query: Readonly<Record<string, string | undefined>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const api = {
  /** 当前登录的成员（含导航、默认首页与密度）；未登录或会话过期时抛 401 */
  me: (): Promise<CurrentMember> => call('/api/me', currentMemberSchema),

  /** 开发登录可选的成员；没开启开发登录（含生产环境）时抛 404 */
  devMembers: async (): Promise<DevMember[]> =>
    (await call('/api/dev/members', devMembersResponseSchema)).members,

  /** 开发登录；被拒时抛 LoginDeniedError（G12） */
  devLogin: (memberId: string): Promise<CurrentMember> =>
    call('/api/dev/login', currentMemberSchema, jsonBody('POST', { memberId })),

  /** 开始一次钉钉扫码登录（G11）：服务端记下 state，返回画二维码的参数；「刷新」二维码即再开始一次 */
  dingtalkLoginStart: (): Promise<DingtalkLoginStart> =>
    call('/api/auth/dingtalk/start', dingtalkLoginStartSchema, { method: 'POST' }),

  /** 扫码确认后用授权码换会话；被拒抛 LoginDeniedError（G12），失败抛 LoginFailedError */
  dingtalkLogin: (request: DingtalkLoginRequest): Promise<CurrentMember> =>
    call('/api/auth/dingtalk/login', currentMemberSchema, jsonBody('POST', request)),

  logout: async (): Promise<void> => {
    await send('/api/logout', { method: 'POST' });
  },

  savePreferences: (preferences: Preferences): Promise<Preferences> =>
    call('/api/me/preferences', preferencesSchema, jsonBody('PUT', preferences)),

  /** 在职的管理员（G2「如需开通请联系管理员刘洋」） */
  adminContacts: (): Promise<AdminContacts> => call('/api/org/admin-contacts', adminContactsSchema),

  /** 铃铛的未读数（G10；后台请求，不续期会话） */
  notificationUnread: async (): Promise<number> =>
    (await call('/api/notifications/unread-count', notificationUnreadSchema, backgroundRequest))
      .unread,

  /**
   * 站内通知面板的一个页签（全部 · 未读）：新的在前，另带未读数。打开面板、切换页签、点「重试」取的是人的操作；
   * 面板开着时的定时重新拉取是后台请求（background），不续期会话
   */
  notifications: (
    view: NotificationView,
    { background }: { readonly background: boolean },
  ): Promise<NotificationList> =>
    call(
      `/api/notifications?view=${view}`,
      notificationListSchema,
      background ? backgroundRequest : undefined,
    ),

  /** 点一条：标为已读 */
  markNotificationRead: async (id: string): Promise<void> => {
    await send(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  },

  /** 全部已读 */
  markAllNotificationsRead: async (): Promise<void> => {
    await send('/api/notifications/read-all', { method: 'POST' });
  },

  /** P18 渠道与店铺：渠道卡、店铺表，以及是否显示「数据来源」 */
  channelSettings: (): Promise<ChannelSettings> =>
    call('/api/channel/settings', channelSettingsSchema),

  /** 全站横幅（G4）：连接异常的渠道（钉钉除外）；所有登录成员都能取 */
  channelAlerts: async (): Promise<ChannelAlert[]> =>
    (await call('/api/channel/alerts', channelAlertsSchema)).alerts,

  /**
   * 「测试连接」（K20）：全部可访问时返回测过的对象；有访问不了的抛 502 connection_test_failed，
   * message 写哪些访问不了（失败浮层「测试连接失败：<message>」）
   */
  testConnection: (kind: ConnectionTestKind): Promise<ConnectionTestResult> =>
    call(`/api/channel/connection-tests/${kind}`, connectionTestResultSchema, jsonBody('POST', {})),

  /** 新增店铺；字段填错时抛 ApiRequestError（fields 为各字段的错误） */
  createStore: (input: StoreInput): Promise<Store> =>
    call('/api/channel/stores', storeSchema, jsonBody('POST', input)),

  /** 编辑店铺（带打开时的版本号）；别人先保存了抛 409 optimistic_lock（G7） */
  updateStore: (id: string, input: StoreUpdate): Promise<Store> =>
    call(`/api/channel/stores/${id}`, storeSchema, jsonBody('PUT', input)),

  /** P20 成员表：已分配角色的成员、授权可选的全部店铺、钉钉通讯录最近一次对账成功的时刻 */
  team: (): Promise<Team> => call('/api/org/team', teamSchema),

  /** 「从钉钉添加」可选的人：钉钉通讯录里在职、还没分配角色的成员 */
  teamCandidates: async (): Promise<TeamCandidate[]> =>
    (await call('/api/org/team/candidates', teamCandidatesSchema)).candidates,

  /** 从钉钉添加成员；字段填错时抛 ApiRequestError（fields 的键为 memberId、roles、stores） */
  addTeamMember: (input: TeamMemberAdd): Promise<TeamMember> =>
    call('/api/org/team/members', teamMemberSchema, jsonBody('POST', input)),

  /**
   * 吸底保存栏的保存：改过的成员一起保存，返回最新的成员表；字段填错抛 400（fields 的键为「成员 ID.roles / .stores」），
   * 有人已被别人改过抛 409 optimistic_lock（G7），整批都没有保存
   */
  saveTeam: (changes: TeamChange[]): Promise<Team> =>
    call('/api/org/team', teamSchema, jsonBody('PUT', { changes })),

  /** 当前成员店铺范围内的店铺（各页面的店铺筛选与选择） */
  storeOptions: async (): Promise<StoreOption[]> =>
    (await call('/api/channel/store-options', storeOptionsSchema)).stores,

  /** P04 工单列表（店铺范围内） */
  tickets: async (): Promise<TicketListItem[]> =>
    (await call('/api/tickets', ticketListSchema)).tickets,

  /** P04 未归属店铺来信队列（I17，只给客服主管；不受店铺范围限制）与服务端当前时刻 */
  unassignedMail: (): Promise<UnassignedMailList> =>
    call('/api/channel/unassigned-mail', unassignedMailListSchema),

  /**
   * 指定店铺（I17，5 秒撤销窗口结束后才调用）：来信已不在队列里（别人先指定或已自动归位）抛 409 not_in_queue，
   * message 写已归入的店铺；店铺不在范围内抛 403
   */
  assignStore: (mailId: string, storeId: string): Promise<AssignStoreResult> =>
    call(
      `/api/channel/unassigned-mail/${encodeURIComponent(mailId)}/store`,
      assignStoreResultSchema,
      jsonBody('POST', { storeId }),
    ),

  /** P13 登记台账（店铺范围内；坐席拿到的没有财务字段） */
  ledger: (query: LedgerQuery = {}): Promise<Ledger> =>
    call(`/api/aftersales/ledger${queryString(query)}`, ledgerSchema),

  /** P13 筛选行的选项：负责人（店铺范围内在职的售后负责人） */
  ledgerOptions: (): Promise<LedgerOptions> =>
    call('/api/aftersales/ledger/options', ledgerOptionsSchema),

  /**
   * 导出 P13 台账（S11、K5）：按当前筛选与字段权限在服务端生成 Excel；返回文件、文件名（Content-Disposition 的 filename*）
   * 与行数。失败时抛 ApiRequestError（同其他接口）
   */
  exportLedger: (query: LedgerQuery): Promise<ExportedFile> =>
    download(`/api/aftersales/ledger/export${queryString(query)}`, 'ledger.xlsx'),

  /** P27 审计日志的一页（查看范围与财务字段由后端按角色过滤，PRD 10.2） */
  auditLog: (query: AuditLogQuery): Promise<AuditLog> =>
    call(
      `/api/audit${queryString({ ...query, page: query.page === undefined ? undefined : String(query.page) })}`,
      auditLogSchema,
    ),

  /** P27 操作人筛选的选项（看全部时为「系统」与全部成员，只看自己时只有本人） */
  auditLogOptions: (): Promise<AuditLogOptions> =>
    call('/api/audit/options', auditLogOptionsSchema),

  /** 导出 P27（K5）：按当前筛选（不分页）在服务端生成 Excel，导出本身记审计 */
  exportAuditLog: (filter: AuditLogFilter): Promise<ExportedFile> =>
    download(`/api/audit/export${queryString(filter)}`, 'audit-log.xlsx'),

  /** 新建登记抽屉的选项：可选负责人、责任类型的默认比例、生产厂、配件与所属生产厂 */
  registrationOptions: (): Promise<RegistrationOptions> =>
    call('/api/aftersales/registration-options', registrationOptionsSchema),

  /** 按工单号取来源工单；没有这张工单 404，在别的店铺 403 */
  sourceTicket: (number: string): Promise<SourceTicket> =>
    call(`/api/aftersales/source-tickets/${encodeURIComponent(number)}`, sourceTicketSchema),

  /** 某个费用发生日可用的汇率（每个币种取当天，缺失时取此前最近一个有汇率的日期；一个都没有为 null） */
  exchangeRates: (date: string): Promise<ExchangeRatesOn> =>
    call(`/api/aftersales/exchange-rates?date=${encodeURIComponent(date)}`, exchangeRatesOnSchema),

  /** 新建登记；字段填错时抛 ApiRequestError（fields 为各字段的错误） */
  register: (input: RegistrationInput): Promise<LedgerItem> =>
    call('/api/aftersales/registrations', ledgerItemSchema, jsonBody('POST', input)),

  /** 一张售后单的完整登记（编辑登记抽屉 S14） */
  aftersales: (number: string): Promise<AftersalesDetail> =>
    call(`/api/aftersales/${encodeURIComponent(number)}`, aftersalesDetailSchema),

  /** 编辑登记、补登（含随「保存修改」一起提交的修改汇率），带版本号（G7） */
  updateAftersales: (number: string, update: RegistrationUpdate): Promise<AftersalesDetail> =>
    call(
      `/api/aftersales/${encodeURIComponent(number)}`,
      aftersalesDetailSchema,
      jsonBody('PATCH', update),
    ),

  /** 设为已完成（S15 ①） */
  completeAftersales: (number: string, version: number): Promise<LedgerItem> =>
    call(
      `/api/aftersales/${encodeURIComponent(number)}/complete`,
      ledgerItemSchema,
      jsonBody('POST', { version }),
    ),

  /** 撤销设为已完成（S15 ①「撤销」） */
  undoComplete: (number: string, version: number): Promise<LedgerItem> =>
    call(
      `/api/aftersales/${encodeURIComponent(number)}/undo-complete`,
      ledgerItemSchema,
      jsonBody('POST', { version }),
    ),

  /** 取消售后单（S15 ②） */
  cancelAftersales: (number: string, input: CancelInput): Promise<LedgerItem> =>
    call(
      `/api/aftersales/${encodeURIComponent(number)}/cancel`,
      ledgerItemSchema,
      jsonBody('POST', input),
    ),
};
