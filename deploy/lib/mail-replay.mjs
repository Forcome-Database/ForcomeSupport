// 「历史邮件回放与 T0 切换」子命令（待办 26）：node deploy/deploy.mjs <环境> mail-replay [--t0 <时刻>] [--confirm]
// 用当前部署的版本起一次性容器执行 dist/mail-replay.mjs。不加 --confirm 只看计划（worker 不动）；加了先停 worker（回放排的任务只能
// 由回放自己跑完），回放完成后再起 worker（开启实时处理）；没完成时 worker 保持停止，处理后再执行同一命令接着回放。
// 不挂载本机文件，远端 Docker 上下文也能用（docs/部署说明.md 第 16 节）。
import { parseArgs } from 'node:util';

export const MAIL_REPLAY_SYNOPSIS = 'mail-replay [--t0 <带时区的时刻>] [--confirm]';

/**
 * 子命令的参数 → 容器里的命令，以及要不要停、起 worker（只在 --confirm 时）
 * @param {string[]} args 子命令后的参数
 * @returns {{ command: string[], confirm: boolean } | { error: string }}
 */
export function mailReplayRun(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { t0: { type: 'string' }, confirm: { type: 'boolean' } },
    });
  } catch (error) {
    return { error: `${error.message}\n用法：${MAIL_REPLAY_SYNOPSIS}` };
  }
  const { t0, confirm = false } = parsed.values;
  if (t0 !== undefined && t0.trim() === '') {
    return { error: `--t0 不能为空\n用法：${MAIL_REPLAY_SYNOPSIS}` };
  }
  return {
    command: [
      'node',
      'dist/mail-replay.mjs',
      ...(t0 !== undefined ? ['--t0', t0] : []),
      ...(confirm ? ['--confirm'] : []),
    ],
    confirm,
  };
}
