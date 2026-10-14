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
/** WAL-G 的 libsodium 密钥：32 字节的十六进制（openssl rand -hex 32） */
const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

/** 生成环境文件时换成随机值的几项（模板里都是占位值 change-me） */
export const GENERATED_SECRETS = ['POSTGRES_PASSWORD', 'WALG_LIBSODIUM_KEY', 'RESTIC_PASSWORD'];

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

  // 备份（待办 28）：两把密钥都必填（Compose 也要求），随备份单独离线保管
  const walgKey = vars.WALG_LIBSODIUM_KEY ?? '';
  if (walgKey === '' || walgKey === PASSWORD_PLACEHOLDER) {
    problems.push(
      'WALG_LIBSODIUM_KEY：必填，用 openssl rand -hex 32 生成（WAL-G 加密基础备份与 WAL）',
    );
  } else if (!HEX_32_BYTES.test(walgKey)) {
    problems.push('WALG_LIBSODIUM_KEY：必须是 64 位十六进制（openssl rand -hex 32 的输出）');
  }
  const resticPassword = vars.RESTIC_PASSWORD ?? '';
  if (resticPassword === '' || resticPassword === PASSWORD_PLACEHOLDER) {
    problems.push('RESTIC_PASSWORD：必填，用 openssl rand -hex 24 生成（restic 加密逻辑备份与卷）');
  } else if (resticPassword.length < 16) {
    problems.push('RESTIC_PASSWORD：至少 16 位');
  }
  const backupDir = vars.BACKUP_DIR || null;
  if (environment.appEnv === 'production') {
    if (!backupDir) {
      problems.push(
        'BACKUP_DIR：生产环境必填，写 NAS 挂载到服务器上的目录（如 /mnt/nas/forcome-support）',
      );
    } else if (!backupDir.startsWith('/')) {
      problems.push('BACKUP_DIR：写服务器上的绝对路径（NAS 的挂载目录）');
    }
    if (vars.DEV_LOGIN_ENABLED === 'true') {
      problems.push('DEV_LOGIN_ENABLED：生产环境不能开启开发登录');
    }
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
    /** 备份目录（NAS 的挂载目录）；没设为 null，用 Compose 的命名卷 backup */
    backupDir,
    problems,
  };
}

/**
 * 环境文件的权限（ADR 0013：.env 权限 600）：生产环境在 Linux 上组或其他人能读写时拒绝部署；Windows 不看权限位
 * @param {number} mode fs.statSync 的 mode
 * @param {NodeJS.Platform} platform
 * @param {import('./environments.mjs').DeployEnvironment} environment
 * @returns {string | null}
 */
export function envFilePermissionProblem(mode, platform, environment) {
  if (platform === 'win32' || environment.appEnv !== 'production') return null;
  return (mode & 0o077) !== 0
    ? `环境文件的权限是 ${(mode & 0o777).toString(8)}，生产环境必须是 600（chmod 600 <环境文件>）`
    : null;
}

/**
 * 第一次部署时从模板生成环境文件：只把数据库口令与两把备份密钥换成随机值，其余原样保留。
 * @param {string} exampleText deploy/.env.example 的内容
 * @param {Readonly<Record<string, string>>} secrets GENERATED_SECRETS 各项的随机值（十六进制）
 */
export function createEnvFile(exampleText, secrets) {
  let text = exampleText;
  for (const name of GENERATED_SECRETS) {
    const line = new RegExp(`^${name}=.*$`, 'm');
    if (!line.test(text)) {
      throw new Error(`模板里没有 ${name} 这一行，无法生成环境文件`);
    }
    text = text.replace(line, () => `${name}=${secrets[name]}`);
  }
  return text;
}
