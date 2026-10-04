import {
  adminContactsSchema,
  apiErrorSchema,
  channelSettingsSchema,
  currentMemberSchema,
  devMembersResponseSchema,
  loginDeniedSchema,
  preferencesSchema,
  storeOptionsSchema,
  storeSchema,
  type AdminContacts,
  type ChannelSettings,
  type CurrentMember,
  type DevMember,
  type FieldErrors,
  type LoginDenialReason,
  type Preferences,
  type Store,
  type StoreInput,
  type StoreOption,
  type StoreUpdate,
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

  /** 当前成员店铺范围内的店铺（店铺筛选、指定店铺、授权选择） */
  storeOptions: async (): Promise<StoreOption[]> =>
    (await call('/api/channel/store-options', storeOptionsSchema)).stores,
};
