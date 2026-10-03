import { adapterModeSchema, type AdapterMode } from '@forcome/contracts';
import { z } from 'zod';

/**
 * 运行配置：静态配置来自环境变量（服务器 `.env`，ADR 0013），启动时一次性校验，缺了就拒绝启动。
 * - `APP_ENV`：production 生产；staging 开发测试环境；development 本机；test 自动化测试。
 *   开发登录、Fake 适配器等「仅非生产」的开关都以它为准。
 * - `DEV_LOGIN_ENABLED`：开发登录（绕过钉钉扫码，ADR 0010 修订），只在非生产环境可以开启。
 * - `CLIENT_MODE_<系统>`：全局外部客户端（钉钉、汇率）用真实接口还是 Fake（ADR 0009 修订），
 *   如 `CLIENT_MODE_DINGTALK=real`；不设时非生产用 fake、生产用 real，生产环境不允许 fake。
 *   店铺级客户端（Gmail、订单）按店铺配置选择，不在这里。
 */
const envSchema = z.object({
  APP_ENV: z.enum(['production', 'staging', 'development', 'test']).default('development'),
  DATABASE_URL: z
    .string({ error: '必填' })
    .regex(/^postgres(ql)?:\/\//, '必须是 postgres:// 开头的连接串'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DEV_LOGIN_ENABLED: z
    .enum(['true', 'false'], { error: '只能是 true 或 false' })
    .default('false')
    .transform((v) => v === 'true'),
});

export type AppEnv = z.infer<typeof envSchema>['APP_ENV'];

const CLIENT_MODE_PREFIX = 'CLIENT_MODE_';
const SYSTEM_NAME = /^[A-Z][A-Z0-9_]*$/;

/** 某个外部系统（小写 snake_case，如 dingtalk）对应的环境变量名，如 CLIENT_MODE_DINGTALK */
export function clientModeVariable(system: string): string {
  return `${CLIENT_MODE_PREFIX}${system.toUpperCase()}`;
}

export interface AppConfig {
  appEnv: AppEnv;
  databaseUrl: string;
  port: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  /** 开发登录是否开启；生产环境恒为 false */
  devLoginEnabled: boolean;
  /** 显式配置了的全局外部客户端模式，键为小写 snake_case 的系统名（如 dingtalk、exchange_rate） */
  clientModes: Readonly<Record<string, AdapterMode>>;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  // 只列变量名与原因，不回显取值（可能含口令）
  const problems: string[] = [];
  const result = envSchema.safeParse(env);
  if (!result.success) {
    for (const issue of result.error.issues) {
      problems.push(`${issue.path.join('.')}：${issue.message}`);
    }
  }
  const appEnv = result.success ? result.data.APP_ENV : undefined;

  const clientModes: Record<string, AdapterMode> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(CLIENT_MODE_PREFIX) || value === undefined) continue;
    const system = key.slice(CLIENT_MODE_PREFIX.length);
    const mode = adapterModeSchema.safeParse(value);
    if (!SYSTEM_NAME.test(system)) {
      problems.push(`${key}：系统名只能是大写字母、数字与下划线`);
    } else if (!mode.success) {
      problems.push(`${key}：只能是 real 或 fake`);
    } else if (appEnv === 'production' && mode.data === 'fake') {
      problems.push(`${key}：生产环境不允许使用 Fake`);
    } else {
      clientModes[system.toLowerCase()] = mode.data;
    }
  }

  if (result.success && result.data.APP_ENV === 'production' && result.data.DEV_LOGIN_ENABLED) {
    problems.push('DEV_LOGIN_ENABLED：生产环境不能开启开发登录');
  }

  if (!result.success || problems.length > 0) {
    throw new ConfigError(`环境变量配置有误：\n${problems.join('\n')}`);
  }
  const { APP_ENV, DATABASE_URL, PORT, LOG_LEVEL, DEV_LOGIN_ENABLED } = result.data;
  return {
    appEnv: APP_ENV,
    databaseUrl: DATABASE_URL,
    port: PORT,
    logLevel: LOG_LEVEL,
    devLoginEnabled: DEV_LOGIN_ENABLED,
    clientModes,
  };
}
