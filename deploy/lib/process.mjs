// 子进程的公共调用（部署脚本执行 docker、git 用）。
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
