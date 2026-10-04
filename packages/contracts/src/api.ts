import { z } from 'zod';

/**
 * 接口的错误响应：error 是给前端判断用的错误码，message 是可以直接显示的中文说明。
 * 已有的错误码：unauthenticated（401 未登录）、session_expired（401 7 天无操作，会话已过期，G12）、
 * forbidden（403 没有这项能力，或数据不在店铺范围内 E-24）、login_denied（403 登录被拒，见 auth.ts）、
 * invalid_request（400 参数不对；表单字段填错时另带 fields）、not_found（404）、optimistic_lock（409 乐观锁冲突，G7）、
 * http_error（框架抛出的其他 HTTP 错误）、internal（500）。
 */
export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  /**
   * 字段级错误（表单保存时，K8）：键为字段路径（如 name、mailboxes.2），值为写在字段下方的中文说明；
   * 前端把它们放到对应字段下方，并定位到第一个错误
   */
  fields: z.record(z.string(), z.string()).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
