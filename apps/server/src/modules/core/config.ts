import { z } from 'zod';

/**
 * 运行配置：静态配置来自环境变量（服务器 `.env`，ADR 0013），启动时一次性校验，缺了就拒绝启动。
 * - `APP_ENV`：production 生产；staging 开发测试环境；development 本机；test 自动化测试。
 *   开发登录、Fake 适配器等「仅非生产」的开关都以它为准。
 */
const envSchema = z.object({
  APP_ENV: z.enum(['production', 'staging', 'development', 'test']).default('development'),
  DATABASE_URL: z
    .string({ error: '必填' })
    .regex(/^postgres(ql)?:\/\//, '必须是 postgres:// 开头的连接串'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppEnv = z.infer<typeof envSchema>['APP_ENV'];

export interface AppConfig {
  appEnv: AppEnv;
  databaseUrl: string;
  port: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    // 只列变量名与原因，不回显取值（可能含口令）
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}：${issue.message}`,
    );
    throw new ConfigError(`环境变量配置有误：\n${problems.join('\n')}`);
  }
  const { APP_ENV, DATABASE_URL, PORT, LOG_LEVEL } = result.data;
  return { appEnv: APP_ENV, databaseUrl: DATABASE_URL, port: PORT, logLevel: LOG_LEVEL };
}
