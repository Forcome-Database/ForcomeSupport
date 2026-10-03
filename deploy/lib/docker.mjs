// 调用 Docker 与 Compose 的公共部分：部署脚本 deploy.mjs 与配置检查 verify.mjs 共用。
import { spawnSync } from 'node:child_process';

/** 运行一个程序，输出直接打到终端，返回退出码 */
export function run(program, args, options = {}) {
  const result = spawnSync(program, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  return result.status;
}

/** 同 run，退出码不为 0 时抛错 */
export function mustRun(program, args, options = {}) {
  const status = run(program, args, options);
  if (status !== 0) {
    throw new Error(`${program} ${args.join(' ')} 退出码 ${status}`);
  }
}

/** 运行并取回标准输出；失败时抛错，带上标准错误 */
export function capture(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} 失败：${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

/**
 * 锁文件里 @playwright/test 的版本。冒烟镜像以同版本的官方 Playwright 镜像为底（浏览器版本随之一致），
 * 升级 Playwright 时镜像自动跟上。
 * @param {string} lockText pnpm-lock.yaml 的内容
 */
export function playwrightVersion(lockText) {
  const versions = new Set(
    [...lockText.matchAll(/^ {2}'@playwright\/test@(\d+\.\d+\.\d+)':$/gm)].map((m) => m[1]),
  );
  if (versions.size === 0) {
    throw new Error('pnpm-lock.yaml 里找不到 @playwright/test');
  }
  if (versions.size > 1) {
    throw new Error(`pnpm-lock.yaml 里 @playwright/test 有多个版本：${[...versions].join('、')}`);
  }
  return [...versions][0];
}

/** 由部署脚本决定的 Compose 变量，不让 shell 环境插手 */
const COMPOSE_CONTROLLED = ['compose_project_name', 'compose_file', 'compose_profiles'];

/**
 * 调用 docker compose 的子进程环境。Compose 让 shell 环境变量优先于 --env-file，所以把环境文件里写了的变量
 * （不分大小写）从 shell 环境去掉，环境文件才是唯一来源；再给出镜像版本 RELEASE 与 PLAYWRIGHT_VERSION。
 * @param {{
 *   processEnv: Record<string, string | undefined>, envFileVars: Record<string, string>,
 *   release: string, lockText: string,
 * }} input
 */
export function composeEnvironment({ processEnv, envFileVars, release, lockText }) {
  const removed = new Set([
    ...Object.keys(envFileVars).map((key) => key.toLowerCase()),
    ...COMPOSE_CONTROLLED,
  ]);
  const env = Object.fromEntries(
    Object.entries(processEnv).filter(
      ([key, value]) => value !== undefined && !removed.has(key.toLowerCase()),
    ),
  );
  env.RELEASE = release;
  env.PLAYWRIGHT_VERSION = playwrightVersion(lockText);
  return env;
}
