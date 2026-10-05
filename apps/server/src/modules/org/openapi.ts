import { apiErrorSchema } from '@forcome/contracts';
import type { z } from '@hono/zod-openapi';

/* org 各组接口声明 OpenAPI 响应的共用写法（当前成员与偏好、P27 审计日志、站内通知、示例通知） */

/** JSON 响应：说明与 contracts 的模式 */
export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

/** 401：没有会话、会话已失效或 7 天无操作已过期 */
export const unauthenticated = json(apiErrorSchema, '未登录、会话已失效或 7 天无操作已过期');
