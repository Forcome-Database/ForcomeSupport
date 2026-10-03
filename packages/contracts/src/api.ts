import { z } from 'zod';

/**
 * 接口的错误响应：error 是给前端判断用的错误码，message 是可以直接显示的中文说明。
 * 已有的错误码：unauthenticated（401 未登录）、session_expired（401 7 天无操作，会话已过期，G12）、
 * forbidden（403 没有这项能力，或数据不在店铺范围内 E-24）、login_denied（403 登录被拒，见 auth.ts）、
 * invalid_request（400 参数不对）、not_found（404）、optimistic_lock（409 乐观锁冲突，G7）、
 * http_error（框架抛出的其他 HTTP 错误）、internal（500）。
 */
export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
