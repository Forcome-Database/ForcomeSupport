// 部署环境文件（deploy/.env.<环境>，模板 deploy/.env.example）：读取、校验与第一次部署时生成。
// 解析用 Node 内置的 util.parseEnv（与 Compose 的 --env-file 同一种写法：注释、引号、行内注释）。
// 这里只校验部署脚本与 Compose 直接用到的变量；应用自己的变量（LOG_LEVEL、发信白名单等）由 api 启动时校验。
import { parseEnv } from 'node:util';

/** 模板里口令的占位值；生成环境文件时换成随机值 */
export const PASSWORD_PLACEHOLDER = 'change-me';

/** 目前支持的证书方式：internal 是 caddy 内部 CA（tls internal）；DNS-01 到位后在这里加 */
export const TLS_MODES = ['internal'];

const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i;
// 连接串 postgres://用户:口令@postgres:5432/库 直接拼接，口令只用 URL 里不需要转义的字符
const URL_SAFE_PASSWORD = /^[A-Za-z0-9._~-]{16,}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function port(vars, name, problems) {
  const value = Number(vars[name]);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    problems.push(`${name}：必须是 1–65535 的整数`);
  }
  return value;
}

/**
 * 读取环境文件内容并校验。不抛错，问题一次列全，由调用方决定是否继续。
 * @param {string} text 环境文件内容
 * @param {import('./environments.mjs').DeployEnvironment} environment
 */
export function readDeployEnv(text, environment) {
  const vars = parseEnv(text);
  const problems = [];

  if (vars.APP_ENV !== environment.appEnv) {
    problems.push(`APP_ENV：部署 ${environment.name} 时必须是 ${environment.appEnv}`);
  }
  if (!HOSTNAME.test(vars.SITE_HOST ?? '')) {
    problems.push('SITE_HOST：只填域名（如 support-dev.forcome.internal），不带协议与端口');
  }
  const httpsBind = vars.HTTPS_BIND || '127.0.0.1';
  const httpsPort = port(vars, 'HTTPS_PORT', problems);
  const pgPort = port(vars, 'PG_PORT', problems);
  if (!TLS_MODES.includes(vars.TLS_MODE ?? '')) {
    problems.push(
      'TLS_MODE：目前只支持 internal（caddy 内部 CA）；切换 DNS-01 的做法见 docs/部署说明.md',
    );
  }
  for (const name of ['POSTGRES_USER', 'POSTGRES_DB']) {
    if (!IDENTIFIER.test(vars[name] ?? '')) {
      problems.push(`${name}：只能用小写字母、数字与下划线`);
    }
  }
  const password = vars.POSTGRES_PASSWORD ?? '';
  if (password === '') {
    problems.push('POSTGRES_PASSWORD：必填');
  } else if (password === PASSWORD_PLACEHOLDER) {
    problems.push('POSTGRES_PASSWORD：还是模板里的占位值，请换成随机口令');
  } else if (!URL_SAFE_PASSWORD.test(password)) {
    problems.push(
      'POSTGRES_PASSWORD：只能用字母、数字与 . _ ~ -，至少 16 位（会直接拼进数据库连接串）',
    );
  }

  return {
    vars,
    siteHost: vars.SITE_HOST,
    httpsBind,
    httpsPort,
    pgPort,
    /** 员工访问的地址（443 端口时不带端口） */
    siteUrl: `https://${vars.SITE_HOST}${httpsPort === 443 ? '' : `:${httpsPort}`}/`,
    /** 部署脚本在服务器本机核对 HTTPS 时连接的地址：监听全部网卡时从回环地址连 */
    connectHost: httpsBind === '0.0.0.0' ? '127.0.0.1' : httpsBind,
    problems,
  };
}

/**
 * 第一次部署时从模板生成环境文件：只把口令那一行换成随机口令，其余原样保留。
 * @param {string} exampleText deploy/.env.example 的内容
 * @param {string} password 随机口令（十六进制）
 */
export function createEnvFile(exampleText, password) {
  const line = /^POSTGRES_PASSWORD=.*$/m;
  if (!line.test(exampleText)) {
    throw new Error('模板里没有 POSTGRES_PASSWORD 这一行，无法生成环境文件');
  }
  return exampleText.replace(line, `POSTGRES_PASSWORD=${password}`);
}
