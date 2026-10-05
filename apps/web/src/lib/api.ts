import {
  adminContactsSchema,
  aftersalesDetailSchema,
  apiErrorSchema,
  channelSettingsSchema,
  currentMemberSchema,
  devMembersResponseSchema,
  exchangeRatesOnSchema,
  EXPORT_ROWS_HEADER,
  ledgerItemSchema,
  ledgerOptionsSchema,
  ledgerSchema,
  loginDeniedSchema,
  preferencesSchema,
  registrationOptionsSchema,
  sourceTicketSchema,
  storeOptionsSchema,
  storeSchema,
  ticketListSchema,
  type AdminContacts,
  type AftersalesDetail,
  type CancelInput,
  type ChannelSettings,
  type CurrentMember,
  type DevMember,
  type ExchangeRatesOn,
  type FieldErrors,
  type Ledger,
  type LedgerItem,
  type LedgerOptions,
  type LedgerQuery,
  type LoginDenialReason,
  type Preferences,
  type RegistrationInput,
  type RegistrationOptions,
  type RegistrationUpdate,
  type SourceTicket,
  type Store,
  type StoreInput,
  type StoreOption,
  type StoreUpdate,
  type TicketListItem,
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

/** 登录被拒（G12）：reason 决定显示哪一种被拒画面 */
export class LoginDeniedError extends ApiRequestError {
  override name = 'LoginDeniedError';
  readonly reason: LoginDenialReason;

  constructor(reason: LoginDenialReason, message: string) {
    super(403, 'login_denied', message);
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
    if (denied.success) throw new LoginDeniedError(denied.data.reason, denied.data.message);
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

async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  return schema.parse(await response.json());
}

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

  logout: async (): Promise<void> => {
    await send('/api/logout', { method: 'POST' });
  },

  savePreferences: (preferences: Preferences): Promise<Preferences> =>
    call('/api/me/preferences', preferencesSchema, jsonBody('PUT', preferences)),

  /** 在职的管理员（G2「如需开通请联系管理员刘洋」） */
  adminContacts: (): Promise<AdminContacts> => call('/api/org/admin-contacts', adminContactsSchema),

  /** P18 渠道与店铺：渠道卡、店铺表，以及是否显示「数据来源」 */
  channelSettings: (): Promise<ChannelSettings> =>
    call('/api/channel/settings', channelSettingsSchema),

  /** 新增店铺；字段填错时抛 ApiRequestError（fields 为各字段的错误） */
  createStore: (input: StoreInput): Promise<Store> =>
    call('/api/channel/stores', storeSchema, jsonBody('POST', input)),

  /** 编辑店铺（带打开时的版本号）；别人先保存了抛 409 optimistic_lock（G7） */
  updateStore: (id: string, input: StoreUpdate): Promise<Store> =>
    call(`/api/channel/stores/${id}`, storeSchema, jsonBody('PUT', input)),

  /** 当前成员店铺范围内的店铺（各页面的店铺筛选与选择） */
  storeOptions: async (): Promise<StoreOption[]> =>
    (await call('/api/channel/store-options', storeOptionsSchema)).stores,

  /** P04 工单列表（店铺范围内） */
  tickets: async (): Promise<TicketListItem[]> =>
    (await call('/api/tickets', ticketListSchema)).tickets,

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
  exportLedger: async (query: LedgerQuery): Promise<ExportedFile> => {
    const response = await send(`/api/aftersales/ledger/export${queryString(query)}`, {
      headers: { accept: XLSX_TYPE },
    });
    const disposition = response.headers.get('content-disposition') ?? '';
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    return {
      blob: await response.blob(),
      fileName: encoded ? decodeURIComponent(encoded) : 'ledger.xlsx',
      rows: Number(response.headers.get(EXPORT_ROWS_HEADER) ?? 0),
    };
  },

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
