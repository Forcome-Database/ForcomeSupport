import { z } from 'zod';

/** 健康检查结果：api 能连上数据库为 ok，否则 unavailable（HTTP 503） */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.object({
    database: z.enum(['ok', 'unavailable']),
  }),
  /** 服务端「当前时间」（ISO 8601，UTC），来自可注入时钟 */
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
