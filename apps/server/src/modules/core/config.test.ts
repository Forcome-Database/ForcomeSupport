import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './index';

const DATABASE_URL = 'postgres://forcome:secret@127.0.0.1:4520/forcome';

/** 钉钉企业内部应用的凭据（示例值）：钉钉客户端用真实接口时（生产环境默认）必填 */
const DINGTALK = {
  DINGTALK_CLIENT_ID: 'dingexampleclientid',
  DINGTALK_CLIENT_SECRET: 'example-client-secret-value',
  DINGTALK_AGENT_ID: '3100000001',
};

/** Google 服务账号密钥文件（示例内容，只校验形状）：Gmail 推送用真实接口时（生产环境默认）必填 */
const KEY_FILE = join(tmpdir(), `forcome-config-test-${process.pid}.json`);
const SERVICE_ACCOUNT = {
  type: 'service_account',
  client_email: 'forcome-support@forcome-mail.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nexample-key\n-----END PRIVATE KEY-----\n',
  token_uri: 'https://oauth2.googleapis.com/token',
};
writeFileSync(KEY_FILE, JSON.stringify(SERVICE_ACCOUNT));
const GOOGLE = {
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: KEY_FILE,
  GMAIL_PUBSUB_TOPIC: 'projects/forcome-mail/topics/gmail',
  GMAIL_PUBSUB_SUBSCRIPTION: 'projects/forcome-mail/subscriptions/gmail-production',
};

/** 钉钉与 Gmail 的凭据都填齐（生产环境钉钉必填；Gmail 不填也能启动） */
const REAL = { ...DINGTALK, ...GOOGLE };

describe('配置读取', () => {
  it('只给数据库地址时其余取默认值', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      appEnv: 'development',
      databaseUrl: DATABASE_URL,
      port: 3000,
      logLevel: 'info',
      devLoginEnabled: false,
      clientModes: {},
      mailSend: { allowlistOnly: true, allowlist: [] },
      clockStart: null,
      dingtalk: null,
      google: null,
      shopify: null,
      credentialMasterKey: null,
    });
  });

  it('读取环境、端口与日志级别', () => {
    const config = loadConfig({
      DATABASE_URL,
      ...REAL,
      APP_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'warn',
    });
    expect(config).toMatchObject({ appEnv: 'production', port: 8080, logLevel: 'warn' });
  });

  it('缺少或写错的变量一次全部列出，且不回显变量值', () => {
    let error: unknown;
    try {
      loadConfig({ DATABASE_URL: 'mysql://root:top-secret@db/x', APP_ENV: 'prod', PORT: 'abc' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('APP_ENV');
    expect(message).toContain('PORT');
    expect(message).not.toContain('top-secret');
  });

  it('缺少数据库地址时报错', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('空值视同未设置：Compose 把 .env 里没填的变量传成空字符串，取默认值而不是报错', () => {
    const config = loadConfig({
      DATABASE_URL,
      APP_ENV: '',
      LOG_LEVEL: '',
      DEV_LOGIN_ENABLED: '',
      CLIENT_MODE_DINGTALK: '',
    });
    expect(config).toMatchObject({
      appEnv: 'development',
      logLevel: 'info',
      devLoginEnabled: false,
      clientModes: {},
    });
    expect(() => loadConfig({ DATABASE_URL: '' })).toThrow(/DATABASE_URL：必填/);
  });
});

describe('出站代理（ADR 0003：境外经固定代理，境内与内部服务经 NO_PROXY 直连）', () => {
  it('代理地址是 http(s):// 开头的 URL 时正常启动，NO_PROXY 不限格式', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL,
        HTTPS_PROXY: 'http://proxy.corp.internal:3128',
        http_proxy: 'http://user:secret@proxy.corp.internal:3128',
        NO_PROXY: 'localhost,127.0.0.1,postgres,dingtalk.com',
      }),
    ).not.toThrow();
  });

  it('代理地址写错时拒绝启动，大小写两种写法都检查，且不回显取值（可能含口令）', () => {
    let error: unknown;
    try {
      loadConfig({
        DATABASE_URL,
        HTTPS_PROXY: 'proxy.corp.internal:3128',
        http_proxy: 'socks5://user:top-secret@proxy:1080',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain('HTTPS_PROXY：必须是 http:// 或 https:// 开头的代理地址');
    expect(message).toContain('http_proxy：必须是 http:// 或 https:// 开头的代理地址');
    expect(message).not.toContain('top-secret');
  });
});

describe('发信白名单开关（ADR 0013：开发测试环境默认禁止向白名单外地址发信）', () => {
  it('非生产环境默认只向白名单发信、白名单为空（即一封也不发）；生产环境默认不限制', () => {
    for (const appEnv of ['staging', 'development', 'test']) {
      expect(loadConfig({ DATABASE_URL, APP_ENV: appEnv }).mailSend).toEqual({
        allowlistOnly: true,
        allowlist: [],
      });
    }
    expect(loadConfig({ DATABASE_URL, ...REAL, APP_ENV: 'production' }).mailSend).toEqual({
      allowlistOnly: false,
      allowlist: [],
    });
  });

  it('白名单写完整地址或 @域名，逗号分隔，去空格、转小写', () => {
    expect(
      loadConfig({
        DATABASE_URL,
        APP_ENV: 'staging',
        MAIL_SEND_ALLOWLIST: ' QA.Mailbox@Forcome.com , @forcome-test.com,',
      }).mailSend.allowlist,
    ).toEqual(['qa.mailbox@forcome.com', '@forcome-test.com']);
  });

  it('开关可以显式关闭或打开', () => {
    expect(
      loadConfig({ DATABASE_URL, APP_ENV: 'staging', MAIL_SEND_ALLOWLIST_ONLY: 'false' }).mailSend
        .allowlistOnly,
    ).toBe(false);
    expect(
      loadConfig({
        DATABASE_URL,
        ...REAL,
        APP_ENV: 'production',
        MAIL_SEND_ALLOWLIST_ONLY: 'true',
      }).mailSend.allowlistOnly,
    ).toBe(true);
  });

  it('白名单条目格式不对、开关不是 true / false 时拒绝启动', () => {
    expect(() =>
      loadConfig({ DATABASE_URL, MAIL_SEND_ALLOWLIST: 'forcome.com,qa@forcome.com' }),
    ).toThrow(/MAIL_SEND_ALLOWLIST：「forcome.com」不是完整地址或 @域名/);
    expect(() => loadConfig({ DATABASE_URL, MAIL_SEND_ALLOWLIST_ONLY: 'yes' })).toThrow(
      /MAIL_SEND_ALLOWLIST_ONLY/,
    );
  });
});

describe('开发登录开关（只在非生产环境由环境变量开启）', () => {
  it('默认关闭；非生产环境可用 DEV_LOGIN_ENABLED=true 开启', () => {
    expect(loadConfig({ DATABASE_URL }).devLoginEnabled).toBe(false);
    expect(loadConfig({ DATABASE_URL, DEV_LOGIN_ENABLED: 'true' }).devLoginEnabled).toBe(true);
    expect(
      loadConfig({ DATABASE_URL, APP_ENV: 'staging', DEV_LOGIN_ENABLED: 'true' }).devLoginEnabled,
    ).toBe(true);
    expect(loadConfig({ DATABASE_URL, DEV_LOGIN_ENABLED: 'false' }).devLoginEnabled).toBe(false);
  });

  it('生产环境开启开发登录拒绝启动', () => {
    expect(() =>
      loadConfig({ DATABASE_URL, APP_ENV: 'production', DEV_LOGIN_ENABLED: 'true' }),
    ).toThrow(/DEV_LOGIN_ENABLED：生产环境不能开启开发登录/);
  });

  it('只接受 true 或 false，避免 yes、1 之类被误当成关闭', () => {
    expect(() => loadConfig({ DATABASE_URL, DEV_LOGIN_ENABLED: 'yes' })).toThrow(
      /DEV_LOGIN_ENABLED/,
    );
  });
});

describe('起始时刻 CLOCK_START（只在非生产环境：截图与演示对上原型的演示时刻）', () => {
  it('默认不设：用系统时钟；非生产环境可设带时区的时刻', () => {
    expect(loadConfig({ DATABASE_URL }).clockStart).toBeNull();
    expect(
      loadConfig({ DATABASE_URL, CLOCK_START: '2026-09-11T10:20:00+08:00' }).clockStart,
    ).toEqual(new Date('2026-09-11T02:20:00Z'));
  });

  it('生产环境设了起始时刻拒绝启动；写错格式也拒绝', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL,
        APP_ENV: 'production',
        CLOCK_START: '2026-09-11T10:20:00+08:00',
      }),
    ).toThrow(/CLOCK_START：生产环境不能设定起始时刻/);
    expect(() => loadConfig({ DATABASE_URL, CLOCK_START: '2026-09-11' })).toThrow(/CLOCK_START/);
  });
});

describe('全局外部客户端的真实 / Fake 选择（CLIENT_MODE_<系统>）', () => {
  it('按系统名读取，系统名转成小写 snake_case', () => {
    expect(
      loadConfig({
        DATABASE_URL,
        ...REAL,
        CLIENT_MODE_DINGTALK: 'real',
        CLIENT_MODE_EXCHANGE_RATE: 'fake',
      }).clientModes,
    ).toEqual({ dingtalk: 'real', exchange_rate: 'fake' });
  });

  it('取值只能是 real 或 fake', () => {
    expect(() => loadConfig({ DATABASE_URL, CLIENT_MODE_DINGTALK: 'mock' })).toThrow(
      /CLIENT_MODE_DINGTALK/,
    );
  });

  it('生产环境不允许把任何客户端设为 fake', () => {
    expect(() =>
      loadConfig({ DATABASE_URL, APP_ENV: 'production', CLIENT_MODE_DINGTALK: 'fake' }),
    ).toThrow(/CLIENT_MODE_DINGTALK：生产环境不允许使用 Fake/);
    expect(
      loadConfig({
        DATABASE_URL,
        ...REAL,
        APP_ENV: 'production',
        CLIENT_MODE_DINGTALK: 'real',
      }).clientModes,
    ).toEqual({ dingtalk: 'real' });
  });
});

describe('钉钉企业内部应用的凭据（用户上线时填进环境文件，开发与测试用 Fake 不需要）', () => {
  it('钉钉用真实接口时 Client ID、Client Secret、AgentId 必填：生产环境默认真实接口，缺了拒绝启动且不回显取值', () => {
    let error: unknown;
    try {
      loadConfig({
        DATABASE_URL,
        APP_ENV: 'production',
        DINGTALK_CLIENT_ID: 'dingexampleclientid',
        DINGTALK_CLIENT_SECRET: 'top-secret-value',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain('DINGTALK_AGENT_ID：钉钉用真实接口时必填');
    expect(message).not.toContain('DINGTALK_CLIENT_ID：');
    expect(message).not.toContain('top-secret-value');
    // 开发测试环境显式切到真实接口时同样要填
    expect(() =>
      loadConfig({ DATABASE_URL, APP_ENV: 'staging', CLIENT_MODE_DINGTALK: 'real' }),
    ).toThrow(/DINGTALK_CLIENT_ID：钉钉用真实接口时必填/);
  });

  it('填齐时读出凭据；AgentId 只能是数字', () => {
    expect(loadConfig({ DATABASE_URL, ...REAL, APP_ENV: 'production' }).dingtalk).toEqual({
      clientId: 'dingexampleclientid',
      clientSecret: 'example-client-secret-value',
      agentId: '3100000001',
    });
    expect(() =>
      loadConfig({ DATABASE_URL, ...REAL, APP_ENV: 'production', DINGTALK_AGENT_ID: 'abc' }),
    ).toThrow(/DINGTALK_AGENT_ID：只能是数字/);
  });

  it('用 Fake 时（非生产环境默认）不要求凭据，填了也不用', () => {
    expect(loadConfig({ DATABASE_URL, APP_ENV: 'staging' }).dingtalk).toBeNull();
    expect(loadConfig({ DATABASE_URL, ...REAL, APP_ENV: 'staging' }).dingtalk).toBeNull();
  });
});

describe('Gmail 的 Google 凭据（待办 09）', () => {
  it('生产环境三项都没填时照常启动（用户 2026-10-04 口径：Google 资质还没有），google 为 null', () => {
    const config = loadConfig({ DATABASE_URL, ...DINGTALK, APP_ENV: 'production' });
    expect(config.google).toBeNull();
    // 推送仍按生产默认用真实接口（调用时以「未配置」失败，Gmail 为未连接），不会退回 Fake
    expect(config.clientModes.gmail_push).toBeUndefined();
  });

  it('生产环境只填了一部分：拒绝启动，只列缺的变量名', () => {
    let error: unknown;
    try {
      loadConfig({
        DATABASE_URL,
        ...DINGTALK,
        APP_ENV: 'production',
        GMAIL_PUBSUB_TOPIC: GOOGLE.GMAIL_PUBSUB_TOPIC,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain('GOOGLE_SERVICE_ACCOUNT_KEY_FILE：与其他两项 Google 配置一起填');
    expect(message).toContain('GMAIL_PUBSUB_SUBSCRIPTION：与其他两项 Google 配置一起填');
    expect(message).not.toContain('GMAIL_PUBSUB_TOPIC：');
  });

  it('填齐时读出密钥文件里的服务账号与 Pub/Sub 主题、订阅', () => {
    expect(loadConfig({ DATABASE_URL, ...REAL, APP_ENV: 'production' }).google).toEqual({
      clientEmail: SERVICE_ACCOUNT.client_email,
      privateKey: SERVICE_ACCOUNT.private_key,
      tokenUri: SERVICE_ACCOUNT.token_uri,
      pubsubTopic: GOOGLE.GMAIL_PUBSUB_TOPIC,
      pubsubSubscription: GOOGLE.GMAIL_PUBSUB_SUBSCRIPTION,
    });
  });

  it('非生产环境可以不填；填了一部分要求填齐；读不到的文件、不是服务账号的密钥、写错的主题都拒绝且不回显密钥', () => {
    expect(loadConfig({ DATABASE_URL, APP_ENV: 'staging' }).google).toBeNull();
    expect(() =>
      loadConfig({
        DATABASE_URL,
        APP_ENV: 'staging',
        GMAIL_PUBSUB_TOPIC: GOOGLE.GMAIL_PUBSUB_TOPIC,
      }),
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_KEY_FILE：与其他两项 Google 配置一起填/);
    expect(() =>
      loadConfig({ DATABASE_URL, APP_ENV: 'staging', ...GOOGLE }, () => {
        throw new Error('ENOENT');
      }),
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_KEY_FILE：读不到这个文件或不是 JSON/);
    let error: unknown;
    try {
      loadConfig({ DATABASE_URL, APP_ENV: 'staging', ...GOOGLE }, () =>
        JSON.stringify({ ...SERVICE_ACCOUNT, type: 'authorized_user' }),
      );
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toContain('不是服务账号的 JSON 密钥文件');
    expect((error as Error).message).not.toContain('example-key');
    expect(() =>
      loadConfig({ DATABASE_URL, APP_ENV: 'staging', ...GOOGLE, GMAIL_PUBSUB_TOPIC: 'gmail' }),
    ).toThrow(/GMAIL_PUBSUB_TOPIC：写成 projects\/<项目>\/topics\/<主题>/);
    // 开发测试环境把推送切到真实接口、但三项都没填：照常启动（Gmail 为未连接）
    expect(
      loadConfig({ DATABASE_URL, APP_ENV: 'staging', CLIENT_MODE_GMAIL_PUSH: 'real' }).google,
    ).toBeNull();
  });
});

describe('Shopify 的客户端凭据与主密钥（待办 11）', () => {
  const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
  const SHOPIFY = {
    SHOPIFY_CLIENT_ID: 'shopify-client-id',
    SHOPIFY_CLIENT_SECRET: 'shopify-client-secret',
    CREDENTIAL_MASTER_KEY: MASTER_KEY,
  };

  it('生产环境都没填时照常启动（用户 2026-10-04 口径：Shopify 资质还没有），shopify 与主密钥为 null', () => {
    const config = loadConfig({ DATABASE_URL, ...DINGTALK, APP_ENV: 'production' });
    expect(config.shopify).toBeNull();
    expect(config.credentialMasterKey).toBeNull();
  });

  it('填齐时读出客户端凭据与 32 字节的主密钥', () => {
    const config = loadConfig({ DATABASE_URL, ...DINGTALK, ...SHOPIFY, APP_ENV: 'production' });
    expect(config.shopify).toEqual({
      clientId: 'shopify-client-id',
      clientSecret: 'shopify-client-secret',
    });
    expect(config.credentialMasterKey).toEqual(Buffer.alloc(32, 7));
  });

  it('只填一项、填了凭据没填主密钥、主密钥不是 32 字节：拒绝启动，不回显取值', () => {
    expect(() =>
      loadConfig({ DATABASE_URL, SHOPIFY_CLIENT_ID: 'id', CREDENTIAL_MASTER_KEY: MASTER_KEY }),
    ).toThrow(/SHOPIFY_CLIENT_SECRET：与另一项 Shopify 凭据一起填/);
    let error: unknown;
    try {
      loadConfig({ DATABASE_URL, SHOPIFY_CLIENT_ID: 'id', SHOPIFY_CLIENT_SECRET: 'secret-value' });
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toContain('CREDENTIAL_MASTER_KEY：填了 Shopify 凭据时必填');
    expect((error as Error).message).not.toContain('secret-value');
    expect(() =>
      loadConfig({ DATABASE_URL, CREDENTIAL_MASTER_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/CREDENTIAL_MASTER_KEY：必须是 32 字节密钥的 base64/);
    // 先放好主密钥、还没有 Shopify 凭据：可以
    expect(loadConfig({ DATABASE_URL, CREDENTIAL_MASTER_KEY: MASTER_KEY }).shopify).toBeNull();
  });
});
