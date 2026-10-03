import {
  apiErrorSchema,
  currentMemberSchema,
  devMembersResponseSchema,
  type CurrentMember,
  type DevMember,
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

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...init?.headers },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw new ApiRequestError(
      response.status,
      error.success ? error.data.error : 'http_error',
      error.success ? error.data.message : `请求失败（${response.status}）`,
    );
  }
  return schema.parse(body);
}

export const api = {
  /** 当前登录的成员；未登录时抛 401 */
  me: (): Promise<CurrentMember> => call('/api/me', currentMemberSchema),

  /** 开发登录可选的成员；没开启开发登录（含生产环境）时抛 404 */
  devMembers: async (): Promise<DevMember[]> =>
    (await call('/api/dev/members', devMembersResponseSchema)).members,

  devLogin: (memberId: string): Promise<CurrentMember> =>
    call('/api/dev/login', currentMemberSchema, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId }),
    }),
};
