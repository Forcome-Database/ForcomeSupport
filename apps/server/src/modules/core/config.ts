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
 * - `MAIL_SEND_ALLOWLIST_ONLY` / `MAIL_SEND_ALLOWLIST`：只向白名单发信（ADR 0013 修订）。不设时非生产环境
 *   打开、生产环境关闭；白名单为逗号分隔的完整地址或 `@域名`，空白名单表示一封也不发。
 * - `HTTPS_PROXY` / `HTTP_PROXY`（大小写两种写法）：出站代理（ADR 0003），只校验是不是代理地址；`NO_PROXY` 不校验。
 * - `CLOCK_START`：起始时刻（带时区，如 2026-09-11T10:20:00+08:00），只在非生产环境可设：api 与 worker 的「当前时间」
 *   从它起走（core 的 startingAt），截图与演示时对上原型的演示时刻（待办 21，ADR 0008 修订）。
 * - `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` / `DINGTALK_AGENT_ID` / `DINGTALK_CORP_ID`：钉钉企业内部应用的凭据
 *   （用户上线时自己填进环境文件，docs/部署说明.md「钉钉」一节；待办 05）。钉钉用真实接口时（生产环境默认，或
 *   `CLIENT_MODE_DINGTALK=real`）四项必填，缺了拒绝启动；用 Fake 时不读。
 * 空值视同未设置。
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
  MAIL_SEND_ALLOWLIST_ONLY: z
    .enum(['true', 'false'], { error: '只能是 true 或 false' })
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  MAIL_SEND_ALLOWLIST: z.string().default(''),
  CLOCK_START: z.iso
    .datetime({ offset: true, error: '必须是带时区的时刻，如 2026-09-11T10:20:00+08:00' })
    .optional(),
  DINGTALK_CLIENT_ID: z.string().optional(),
  DINGTALK_CLIENT_SECRET: z.string().optional(),
  DINGTALK_AGENT_ID: z.string().regex(/^\d+$/, '只能是数字').optional(),
  DINGTALK_CORP_ID: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>['APP_ENV'];

const CLIENT_MODE_PREFIX = 'CLIENT_MODE_';
const SYSTEM_NAME = /^[A-Z][A-Z0-9_]*$/;

/** 出站代理变量（ADR 0003）；undici 与多数工具大小写两种写法都认 */
const PROXY_VARIABLES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const;

/** 发信白名单的一条：完整地址（qa@forcome.com）或整个域名（@forcome.com） */
const ALLOWLIST_ENTRY = /^[^\s@,]*@[^\s@,]+\.[^\s@,]+$/;

function isProxyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/** 某个外部系统（小写 snake_case，如 dingtalk）对应的环境变量名，如 CLIENT_MODE_DINGTALK */
export function clientModeVariable(system: string): string {
  return `${CLIENT_MODE_PREFIX}${system.toUpperCase()}`;
}

/** 全局外部客户端没有显式配置 CLIENT_MODE_<系统> 时的实现：非生产用 Fake、生产用真实接口（ADR 0009 修订） */
export function defaultClientMode(appEnv: AppEnv): AdapterMode {
  return appEnv === 'production' ? 'real' : 'fake';
}

/**
 * 钉钉企业内部应用的凭据（ADR 0010 修订，待办 05）：在钉钉开放平台的应用详情里取，用户上线时填进环境文件。
 * 只在钉钉客户端用真实接口时用到。
 */
export interface DingtalkCredentials {
  /** Client ID（原 AppKey）：换访问凭证、扫码登录的 client_id、Stream 注册 */
  readonly clientId: string;
  /** Client Secret（原 AppSecret） */
  readonly clientSecret: string;
  /** 应用的 AgentId：发工作通知 */
  readonly agentId: string;
  /** 组织的 CorpId：扫码登录时核对扫码人属于本组织 */
  readonly corpId: string;
}

const DINGTALK_VARIABLES = {
  clientId: 'DINGTALK_CLIENT_ID',
  clientSecret: 'DINGTALK_CLIENT_SECRET',
  agentId: 'DINGTALK_AGENT_ID',
  corpId: 'DINGTALK_CORP_ID',
} as const satisfies Record<keyof DingtalkCredentials, string>;

export interface AppConfig {
  appEnv: AppEnv;
  databaseUrl: string;
  port: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  /** 开发登录是否开启；生产环境恒为 false */
  devLoginEnabled: boolean;
  /** 显式配置了的全局外部客户端模式，键为小写 snake_case 的系统名（如 dingtalk、exchange_rate） */
  clientModes: Readonly<Record<string, AdapterMode>>;
  /** 发信白名单开关：打开时只能向白名单里的地址发信（integration 的 MailRecipientGuard 执行） */
  mailSend: MailSendPolicy;
  /** 起始时刻（只在非生产环境）：设了时「当前时间」从它起走；没设为 null，用系统时钟 */
  clockStart: Date | null;
  /** 钉钉企业内部应用的凭据：钉钉用真实接口时必有；用 Fake 时为 null（不读） */
  dingtalk: DingtalkCredentials | null;
}

export interface MailSendPolicy {
  readonly allowlistOnly: boolean;
  /** 小写的完整地址或 `@域名` */
  readonly allowlist: readonly string[];
}

/** 没有显式配置时的发信策略：非生产环境只向白名单发信且白名单为空（一封也不发），生产环境不限制 */
export function defaultMailSendPolicy(appEnv: AppEnv): MailSendPolicy {
  return { allowlistOnly: appEnv !== 'production', allowlist: [] };
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(rawEnv: Record<string, string | undefined> = process.env): AppConfig {
  // 空值视同未设置：Compose 会把 .env 里留空的变量原样传成空字符串（待办 03）
  const env = Object.fromEntries(
    Object.entries(rawEnv).filter(([, value]) => value !== undefined && value !== ''),
  );
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

  // 出站代理由 HTTP 客户端工厂（integration/http.ts 的 undici EnvHttpProxyAgent）直接读环境变量，这里只把关格式
  for (const variable of PROXY_VARIABLES) {
    const value = env[variable];
    if (value !== undefined && !isProxyUrl(value)) {
      problems.push(`${variable}：必须是 http:// 或 https:// 开头的代理地址`);
    }
  }

  const allowlist = (result.data?.MAIL_SEND_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
  for (const entry of allowlist) {
    if (!ALLOWLIST_ENTRY.test(entry)) {
      problems.push(`MAIL_SEND_ALLOWLIST：「${entry}」不是完整地址或 @域名`);
    }
  }

  if (result.success && result.data.APP_ENV === 'production' && result.data.DEV_LOGIN_ENABLED) {
    problems.push('DEV_LOGIN_ENABLED：生产环境不能开启开发登录');
  }

  if (result.success && result.data.APP_ENV === 'production' && result.data.CLOCK_START) {
    problems.push('CLOCK_START：生产环境不能设定起始时刻');
  }

  // 钉钉用真实接口时（生产默认）四项凭据必填；只列变量名，不回显取值
  let dingtalk: DingtalkCredentials | null = null;
  if (
    result.success &&
    (clientModes.dingtalk ?? defaultClientMode(result.data.APP_ENV)) === 'real'
  ) {
    const missing = Object.values(DINGTALK_VARIABLES).filter((name) => !result.data[name]);
    for (const name of missing) problems.push(`${name}：钉钉用真实接口时必填`);
    if (missing.length === 0) {
      dingtalk = {
        clientId: result.data.DINGTALK_CLIENT_ID ?? '',
        clientSecret: result.data.DINGTALK_CLIENT_SECRET ?? '',
        agentId: result.data.DINGTALK_AGENT_ID ?? '',
        corpId: result.data.DINGTALK_CORP_ID ?? '',
      };
    }
  }

  if (!result.success || problems.length > 0) {
    throw new ConfigError(`环境变量配置有误：\n${problems.join('\n')}`);
  }
  const {
    APP_ENV,
    DATABASE_URL,
    PORT,
    LOG_LEVEL,
    DEV_LOGIN_ENABLED,
    MAIL_SEND_ALLOWLIST_ONLY,
    CLOCK_START,
  } = result.data;
  return {
    appEnv: APP_ENV,
    databaseUrl: DATABASE_URL,
    port: PORT,
    logLevel: LOG_LEVEL,
    devLoginEnabled: DEV_LOGIN_ENABLED,
    clientModes,
    mailSend: {
      allowlistOnly: MAIL_SEND_ALLOWLIST_ONLY ?? defaultMailSendPolicy(APP_ENV).allowlistOnly,
      allowlist,
    },
    clockStart: CLOCK_START ? new Date(CLOCK_START) : null,
    dingtalk,
  };
}
