import { readFileSync } from 'node:fs';
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
 * - `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` / `DINGTALK_AGENT_ID`：钉钉企业内部应用的凭据（用户上线时自己填进环境文件，
 *   docs/部署说明.md 第 11 节；待办 05）。钉钉用真实接口时（生产环境默认，或 `CLIENT_MODE_DINGTALK=real`）三项必填，缺了拒绝启动；
 *   用 Fake 时不读。CorpId 第一期用不到（第二期钉钉内免登时再加）。
 * - `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` / `GMAIL_PUBSUB_TOPIC` / `GMAIL_PUBSUB_SUBSCRIPTION`：Gmail 真实现用的 Google 服务账号密钥
 *   文件（JSON，全域委派到 4 个店铺邮箱）、watch 推送的 Pub/Sub 主题与本环境的订阅（docs/部署说明.md 第 12 节；待办 09）。
 *   三项要么都不填、要么都填（只填一部分拒绝启动）。都不填时照常启动（生产环境也一样，用户 2026-10-04 口径：缺某个外部系统的配置时
 *   系统照常可用）：真实接口的推送与邮箱调用以「未配置」失败、不算连接失败，P18 的 Gmail 与各店铺为「未连接」，不出横幅、不发通知。
 * - `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`：Shopify 自建应用（Dev Dashboard，与店铺同一组织）的客户端凭据，按店铺以
 *   client credentials 换 24 小时的访问令牌读订单（docs/部署说明.md 第 13 节；待办 11）。两项要么都不填、要么都填；都不填时照常启动
 *   （生产也一样，用户 2026-10-04 口径），真实接口的 Shopify 店铺为「未连接」，不出横幅、不发通知。
 * - `SP_API_CLIENT_ID` / `SP_API_CLIENT_SECRET`：SP-API 私有应用的 LWA 凭据（Seller Central「开发者中心」的应用，docs/部署说明.md
 *   第 14 节；待办 12）。两项要么都不填、要么都填；都不填时照常启动（生产也一样，用户 2026-10-04 口径），真实接口的亚马逊店铺为「未连接」，
 *   不出横幅、不发通知。各卖家授权的刷新令牌不在这里：用部署子命令 sp-api-token 加密存库（ADR 0013）。
 * - `AMAZON_SQS_QUEUE_URL` / `AMAZON_SQS_ACCESS_KEY_ID` / `AMAZON_SQS_SECRET_ACCESS_KEY`：接收 ORDER_CHANGE 通知的 SQS 标准队列与
 *   只能读、删这个队列的 IAM 访问密钥（区域从队列地址取，待办 12）。三项要么都不填、要么都填；都不填时照常启动，亚马逊卡的 SQS 行为
 *   「未连接」，订单靠每 4 分钟的增量兜底。生产不允许用 Fake（`CLIENT_MODE_AMAZON_SQS`）。
 * - `CREDENTIAL_MASTER_KEY`：主密钥（32 字节的 base64），动态凭据（各店铺的 Shopify 访问令牌、SP-API 刷新令牌）用它 AES-256-GCM
 *   加密后存库（ADR 0013）。填了 Shopify 或 SP-API 凭据就必填；单独填可以（先放好主密钥）。
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
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: z.string().optional(),
  GMAIL_PUBSUB_TOPIC: z
    .string()
    .regex(/^projects\/[^/]+\/topics\/[^/]+$/, '写成 projects/<项目>/topics/<主题>')
    .optional(),
  GMAIL_PUBSUB_SUBSCRIPTION: z
    .string()
    .regex(/^projects\/[^/]+\/subscriptions\/[^/]+$/, '写成 projects/<项目>/subscriptions/<订阅>')
    .optional(),
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  SP_API_CLIENT_ID: z.string().optional(),
  SP_API_CLIENT_SECRET: z.string().optional(),
  AMAZON_SQS_QUEUE_URL: z
    .string()
    .regex(
      /^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/[A-Za-z0-9_-]{1,80}$/,
      '写成 https://sqs.<区域>.amazonaws.com/<账户>/<队列名>',
    )
    .optional(),
  AMAZON_SQS_ACCESS_KEY_ID: z.string().optional(),
  AMAZON_SQS_SECRET_ACCESS_KEY: z.string().optional(),
  CREDENTIAL_MASTER_KEY: z
    .string()
    .refine(
      (value) => /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').length === 32,
      '必须是 32 字节密钥的 base64（如 openssl rand -base64 32 的输出）',
    )
    .optional(),
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
}

/** 用真实接口时必填的三项 */
const REQUIRED_DINGTALK_VARIABLES = [
  'DINGTALK_CLIENT_ID',
  'DINGTALK_CLIENT_SECRET',
  'DINGTALK_AGENT_ID',
] as const;

/**
 * Gmail 真实现的 Google 凭据（ADR 0009 修订，待办 09）：服务账号（全域委派，以各店铺邮箱的身份读信）与 Pub/Sub。
 * 只在 Gmail（邮箱或推送）用真实接口时用到。
 */
export interface GoogleCredentials {
  /** 服务账号邮箱（密钥文件的 client_email） */
  readonly clientEmail: string;
  /** PKCS#8 私钥（密钥文件的 private_key） */
  readonly privateKey: string;
  /** 换令牌的地址（密钥文件的 token_uri） */
  readonly tokenUri: string;
  /** watch 推送的主题：projects/<项目>/topics/<主题> */
  readonly pubsubTopic: string;
  /** 本环境的订阅：projects/<项目>/subscriptions/<订阅> */
  readonly pubsubSubscription: string;
}

const GOOGLE_VARIABLES = [
  'GOOGLE_SERVICE_ACCOUNT_KEY_FILE',
  'GMAIL_PUBSUB_TOPIC',
  'GMAIL_PUBSUB_SUBSCRIPTION',
] as const;

/**
 * Shopify 自建应用的客户端凭据（ADR 0011 修订，待办 11）：在 Shopify Dev Dashboard 的应用设置里取；应用与店铺属于同一个组织，
 * 按店铺以 client credentials 换访问令牌（24 小时过期）。只在 Shopify 店铺用真实接口时用到
 */
export interface ShopifyCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

const SHOPIFY_VARIABLES = ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'] as const;

/**
 * SP-API 私有应用的 LWA 凭据（ADR 0011 修订，待办 12）：在 Seller Central 的开发者中心取；各卖家的刷新令牌另行加密存库。
 * 只在亚马逊店铺用真实接口时用到
 */
export interface SpApiCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

const SP_API_VARIABLES = ['SP_API_CLIENT_ID', 'SP_API_CLIENT_SECRET'] as const;

/** 接收 ORDER_CHANGE 通知的 SQS 队列与访问密钥（待办 12）；区域从队列地址取 */
export interface AmazonSqsConfig {
  readonly queueUrl: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

const AMAZON_SQS_VARIABLES = [
  'AMAZON_SQS_QUEUE_URL',
  'AMAZON_SQS_ACCESS_KEY_ID',
  'AMAZON_SQS_SECRET_ACCESS_KEY',
] as const;

const serviceAccountKeySchema = z.object({
  type: z.literal('service_account'),
  client_email: z.string().min(1),
  private_key: z.string().includes('PRIVATE KEY'),
  token_uri: z.url().default('https://oauth2.googleapis.com/token'),
});

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
  /** Gmail 的 Google 凭据；三项都没填为 null（照常启动，真实接口的 Gmail 为未连接） */
  google: GoogleCredentials | null;
  /** Shopify 的客户端凭据；两项都没填为 null（照常启动，真实接口的 Shopify 店铺为未连接） */
  shopify: ShopifyCredentials | null;
  /** SP-API 的 LWA 凭据；两项都没填为 null（照常启动，真实接口的亚马逊店铺为未连接） */
  spApi: SpApiCredentials | null;
  /** 订单通知队列（SQS）；三项都没填为 null（照常启动，亚马逊卡的 SQS 行为未连接） */
  amazonSqs: AmazonSqsConfig | null;
  /** 动态凭据的主密钥（32 字节）；没填为 null */
  credentialMasterKey: Buffer | null;
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

/** 读服务账号密钥文件（测试换成内存里的内容） */
export type ReadKeyFile = (path: string) => string;

export function loadConfig(
  rawEnv: Record<string, string | undefined> = process.env,
  readKeyFile: ReadKeyFile = (path) => readFileSync(path, 'utf8'),
): AppConfig {
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

  // 钉钉用真实接口时（生产默认）三项凭据必填；只列变量名，不回显取值
  let dingtalk: DingtalkCredentials | null = null;
  if (
    result.success &&
    (clientModes.dingtalk ?? defaultClientMode(result.data.APP_ENV)) === 'real'
  ) {
    const missing = REQUIRED_DINGTALK_VARIABLES.filter((name) => !result.data[name]);
    for (const name of missing) problems.push(`${name}：钉钉用真实接口时必填`);
    if (missing.length === 0) {
      dingtalk = {
        clientId: result.data.DINGTALK_CLIENT_ID ?? '',
        clientSecret: result.data.DINGTALK_CLIENT_SECRET ?? '',
        agentId: result.data.DINGTALK_AGENT_ID ?? '',
      };
    }
  }

  // Gmail 的 Google 凭据：三项要么都填要么都不填。都没填时照常启动（用户 2026-10-04 口径：Google 资质还没有，
  // 缺某个外部系统的配置时系统照常可用，该渠道为「未连接」）；只填一部分是配错了，拒绝启动。只列变量名与原因，不回显密钥
  let google: GoogleCredentials | null = null;
  if (result.success) {
    const given = GOOGLE_VARIABLES.filter((name) => result.data[name]);
    if (given.length > 0) {
      const missing = GOOGLE_VARIABLES.filter((name) => !result.data[name]);
      for (const name of missing) problems.push(`${name}：与其他两项 Google 配置一起填`);
      if (missing.length === 0) {
        const file = result.data.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ?? '';
        let key: z.infer<typeof serviceAccountKeySchema> | null = null;
        try {
          const parsed = serviceAccountKeySchema.safeParse(JSON.parse(readKeyFile(file)));
          if (parsed.success) key = parsed.data;
          else problems.push('GOOGLE_SERVICE_ACCOUNT_KEY_FILE：不是服务账号的 JSON 密钥文件');
        } catch {
          problems.push('GOOGLE_SERVICE_ACCOUNT_KEY_FILE：读不到这个文件或不是 JSON');
        }
        if (key) {
          google = {
            clientEmail: key.client_email,
            privateKey: key.private_key,
            tokenUri: key.token_uri,
            pubsubTopic: result.data.GMAIL_PUBSUB_TOPIC ?? '',
            pubsubSubscription: result.data.GMAIL_PUBSUB_SUBSCRIPTION ?? '',
          };
        }
      }
    }
  }

  // Shopify 的客户端凭据：两项要么都填要么都不填（都不填照常启动，同 Google）；填了就要有主密钥加密存访问令牌
  let shopify: ShopifyCredentials | null = null;
  if (result.success) {
    const given = SHOPIFY_VARIABLES.filter((name) => result.data[name]);
    if (given.length > 0) {
      const missing = SHOPIFY_VARIABLES.filter((name) => !result.data[name]);
      for (const name of missing) problems.push(`${name}：与另一项 Shopify 凭据一起填`);
      if (!result.data.CREDENTIAL_MASTER_KEY) {
        problems.push('CREDENTIAL_MASTER_KEY：填了 Shopify 凭据时必填（加密存放各店铺的访问令牌）');
      }
      if (missing.length === 0) {
        shopify = {
          clientId: result.data.SHOPIFY_CLIENT_ID ?? '',
          clientSecret: result.data.SHOPIFY_CLIENT_SECRET ?? '',
        };
      }
    }
  }

  // SP-API 的 LWA 凭据：同 Shopify，两项要么都填要么都不填；填了就要有主密钥加密存各卖家的刷新令牌
  let spApi: SpApiCredentials | null = null;
  if (result.success) {
    const given = SP_API_VARIABLES.filter((name) => result.data[name]);
    if (given.length > 0) {
      const missing = SP_API_VARIABLES.filter((name) => !result.data[name]);
      for (const name of missing) problems.push(`${name}：与另一项 SP-API 凭据一起填`);
      if (!result.data.CREDENTIAL_MASTER_KEY) {
        problems.push(
          'CREDENTIAL_MASTER_KEY：填了 SP-API 凭据时必填（加密存放各卖家授权的刷新令牌）',
        );
      }
      if (missing.length === 0) {
        spApi = {
          clientId: result.data.SP_API_CLIENT_ID ?? '',
          clientSecret: result.data.SP_API_CLIENT_SECRET ?? '',
        };
      }
    }
  }

  // 订单通知队列：三项要么都填要么都不填（都不填照常启动，SQS 行为未连接）
  let amazonSqs: AmazonSqsConfig | null = null;
  if (result.success) {
    const given = AMAZON_SQS_VARIABLES.filter((name) => result.data[name]);
    if (given.length > 0) {
      const missing = AMAZON_SQS_VARIABLES.filter((name) => !result.data[name]);
      for (const name of missing) problems.push(`${name}：与其他两项 SQS 配置一起填`);
      if (missing.length === 0) {
        const queueUrl = result.data.AMAZON_SQS_QUEUE_URL ?? '';
        amazonSqs = {
          queueUrl,
          // https://sqs.<区域>.amazonaws.com/…
          region: new URL(queueUrl).hostname.split('.')[1] ?? '',
          accessKeyId: result.data.AMAZON_SQS_ACCESS_KEY_ID ?? '',
          secretAccessKey: result.data.AMAZON_SQS_SECRET_ACCESS_KEY ?? '',
        };
      }
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
    CREDENTIAL_MASTER_KEY,
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
    google,
    shopify,
    spApi,
    amazonSqs,
    credentialMasterKey: CREDENTIAL_MASTER_KEY
      ? Buffer.from(CREDENTIAL_MASTER_KEY, 'base64')
      : null,
  };
}
