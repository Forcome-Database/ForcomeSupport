// 备份、恢复与恢复演练子命令的参数（待办 28，docs/运维手册.md 第 2–4 节）：命令行 → PostgreSQL 镜像里脚本的参数。
//   backup [list | verify-retention]
//       不带参数：立即做一次完整备份（种类 manual，同每日备份但不执行保留策略）；list 列出基础备份与快照；
//       verify-retention 核对保留策略（模拟 + 真实仓库）
//   restore (--target-time <带时区的时刻> | --latest) [--backup <基础备份名>] [--confirm]
//       把本环境的数据库恢复到目标时点（覆盖现在的数据；原数据目录改名留在卷里）。不加 --confirm 只列出基础备份与将用哪一份
//   restore-drill [--target-time <带时区的时刻>]
//       恢复演练：在临时卷里恢复、核对、报告用时，不碰正在运行的数据库。不给目标时点时在库里写两行演练标记、以两者之间的
//       时刻为目标（核对「目标时点之前写的在、之后写的不在」）

export const BACKUP_SYNOPSIS = 'backup [list | verify-retention]';
export const RESTORE_SYNOPSIS =
  'restore (--target-time <带时区的时刻> | --latest) [--backup <基础备份名>] [--confirm]';
export const RESTORE_DRILL_SYNOPSIS = 'restore-drill [--target-time <带时区的时刻>]';

/** 带时区的时刻（2026-10-14T10:20:00+08:00 或 …Z）；不带时区的会被各处按不同时区理解，一律拒绝 */
const ZONED = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

function zonedTime(value) {
  return ZONED.test(value) && !Number.isNaN(Date.parse(value));
}

/** backup 子命令 → 备份服务里执行的命令 */
export function backupRun(args) {
  const [action = 'run', ...rest] = args;
  if (rest.length > 0) return { error: `多余的参数：${rest.join(' ')}\n用法：${BACKUP_SYNOPSIS}` };
  switch (action) {
    case 'run':
      return { command: ['forcome-backup', 'run', 'manual'] };
    case 'list':
      return { command: ['forcome-backup', 'list'] };
    case 'verify-retention':
      return { command: ['forcome-backup', 'verify-retention'] };
    default:
      return { error: `不认识的参数：${action}\n用法：${BACKUP_SYNOPSIS}` };
  }
}

/**
 * restore 子命令的参数
 * @returns {{ targetTime: string | null, backup: string | null, confirm: boolean, prepare: string[] } | { error: string }}
 */
export function restoreRun(args) {
  let targetTime = null;
  let latest = false;
  let backup = null;
  let confirm = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--target-time') targetTime = args[++i] ?? '';
    else if (arg === '--latest') latest = true;
    else if (arg === '--backup') backup = args[++i] ?? '';
    else if (arg === '--confirm') confirm = true;
    else return { error: `不认识的参数：${arg}\n用法：${RESTORE_SYNOPSIS}` };
  }
  if (targetTime === null && !latest) {
    return {
      error: `要给 --target-time（恢复到某个时点）或 --latest（恢复到最新）\n用法：${RESTORE_SYNOPSIS}`,
    };
  }
  if (targetTime !== null && latest) return { error: '--target-time 与 --latest 只能给一个' };
  if (targetTime !== null && !zonedTime(targetTime)) {
    return {
      error: `--target-time 要写带时区的时刻，如 2026-10-14T10:20:00+08:00（现在是「${targetTime}」）`,
    };
  }
  if (backup === '') return { error: '--backup 要给基础备份名（backup list 看有哪些）' };
  return {
    targetTime,
    backup,
    confirm,
    prepare: [
      'forcome-restore',
      'prepare',
      '--move-aside',
      ...(targetTime ? ['--target-time', targetTime] : []),
      ...(backup ? ['--backup', backup] : []),
    ],
  };
}

/** restore-drill 子命令的参数 */
export function restoreDrillRun(args) {
  let targetTime = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--target-time') targetTime = args[++i] ?? '';
    else return { error: `不认识的参数：${args[i]}\n用法：${RESTORE_DRILL_SYNOPSIS}` };
  }
  if (targetTime !== null && !zonedTime(targetTime)) {
    return {
      error: `--target-time 要写带时区的时刻，如 2026-10-14T10:20:00+08:00（现在是「${targetTime}」）`,
    };
  }
  return { targetTime };
}

/** 恢复脚本输出里的 RESTORE_*=… 行 */
export function restoreResults(output) {
  return Object.fromEntries(
    [...output.matchAll(/^RESTORE_([A-Z_]+)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]),
  );
}

/** 用时的写法：「3 分 20 秒」 */
export function durationWords(seconds) {
  const s = Math.round(seconds);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}
