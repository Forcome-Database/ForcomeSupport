// 维护标记（待办 28，协调者 2026-10-14 决定 Q4）：部署、上线切换回放、恢复等计划内维护期间，部署脚本写一个带到期时间的标记，
// 宿主机检查（host-check）见到没到期的标记就不发告警；到期自动失效——失效后异常仍在照常告警，消息里注明「维护标记已过期」。
// 部署脚本在命令成功或失败退出时都清掉自己写的标记（按 token 认，不清别人后写的）。
// 标记是一个 JSON 文件：默认 deploy/.state/<环境>/maintenance.json；运行器与宿主机检查不在同一个工作区时，两边都用
// FORCOME_MAINTENANCE_FILE 指到同一个文件（docs/运维手册.md）。

/** 部署脚本写标记时默认维持的小时数（命令行 --maintenance-hours 可调） */
export const DEFAULT_MAINTENANCE_HOURS = 2;

/**
 * @typedef {object} MaintenanceMarker
 * @property {string} reason 为什么维护，如「部署 3f2a1c9e0b7d」
 * @property {string} since ISO 时刻
 * @property {string} until ISO 时刻：到期自动失效
 * @property {string} token 写标记的这一次命令（清理时核对）
 */

/**
 * 新的维护标记
 * @param {{ reason: string, hours: number, now: Date, token: string }} input
 * @returns {MaintenanceMarker}
 */
export function maintenanceMarker({ reason, hours, now, token }) {
  if (!(hours > 0)) throw new Error(`维护时长必须是正数（小时）：${hours}`);
  return {
    reason,
    since: now.toISOString(),
    until: new Date(now.getTime() + hours * 3_600_000).toISOString(),
    token,
  };
}

/**
 * 解析标记文件的内容；读不懂的当没有标记（不让一个坏文件挡住告警）
 * @param {string | null} text
 * @returns {MaintenanceMarker | null}
 */
export function parseMaintenance(text) {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    if (typeof value?.until !== 'string' || Number.isNaN(Date.parse(value.until))) return null;
    return {
      reason: String(value.reason ?? '维护'),
      since: String(value.since ?? value.until),
      until: value.until,
      token: String(value.token ?? ''),
    };
  } catch {
    return null;
  }
}

/**
 * 此刻的维护状态：active 为在维护中（告警暂停）；expired 为标记已过期（照常告警并注明）
 * @param {MaintenanceMarker | null} marker
 * @param {Date} now
 * @returns {{ state: 'none' } | { state: 'active' | 'expired', marker: MaintenanceMarker }}
 */
export function maintenanceState(marker, now) {
  if (!marker) return { state: 'none' };
  return { state: Date.parse(marker.until) > now.getTime() ? 'active' : 'expired', marker };
}

/** 命令行的 --maintenance-hours <小时>：取出并从参数里去掉；没给为默认值 */
export function takeMaintenanceHours(args) {
  const rest = [...args];
  const index = rest.indexOf('--maintenance-hours');
  if (index === -1) return { hours: DEFAULT_MAINTENANCE_HOURS, rest };
  const hours = Number(rest[index + 1]);
  if (!(hours > 0)) return { error: '--maintenance-hours 要给正数（小时）' };
  rest.splice(index, 2);
  return { hours, rest };
}
