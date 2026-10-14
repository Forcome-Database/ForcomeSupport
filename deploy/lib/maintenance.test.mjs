import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAINTENANCE_HOURS,
  maintenanceMarker,
  maintenanceState,
  parseMaintenance,
  takeMaintenanceHours,
} from './maintenance.mjs';

/* 维护标记（待办 28，协调者 2026-10-14 决定 Q4）：带到期时间，部署脚本默认 2 小时、命令行可调，到期自动失效 */

const now = new Date('2026-10-14T02:20:00Z');

describe('维护标记', () => {
  it('写入时带到期时间；没到期为维护中，到期后为已过期（照常告警并注明）', () => {
    const marker = maintenanceMarker({ reason: '部署 3f2a1c9e0b7d', hours: 2, now, token: 't1' });
    expect(marker).toEqual({
      reason: '部署 3f2a1c9e0b7d',
      since: '2026-10-14T02:20:00.000Z',
      until: '2026-10-14T04:20:00.000Z',
      token: 't1',
    });
    const parsed = parseMaintenance(JSON.stringify(marker));
    expect(maintenanceState(parsed, new Date('2026-10-14T04:19:59Z')).state).toBe('active');
    expect(maintenanceState(parsed, new Date('2026-10-14T04:20:00Z')).state).toBe('expired');
    expect(maintenanceState(null, now)).toEqual({ state: 'none' });
  });

  it('读不懂的文件当没有标记（不让一个坏文件挡住告警）；时长必须是正数', () => {
    expect(parseMaintenance('不是 JSON')).toBeNull();
    expect(parseMaintenance('{"until":"明天"}')).toBeNull();
    expect(parseMaintenance(null)).toBeNull();
    expect(() => maintenanceMarker({ reason: 'x', hours: 0, now, token: 't' })).toThrow();
  });

  it('命令行 --maintenance-hours：取出并从参数里去掉；没给为默认 2 小时', () => {
    expect(takeMaintenanceHours(['--confirm'])).toEqual({
      hours: DEFAULT_MAINTENANCE_HOURS,
      rest: ['--confirm'],
    });
    expect(takeMaintenanceHours(['--maintenance-hours', '6', '--confirm'])).toEqual({
      hours: 6,
      rest: ['--confirm'],
    });
    expect(takeMaintenanceHours(['--maintenance-hours', 'abc'])).toEqual({
      error: '--maintenance-hours 要给正数（小时）',
    });
  });
});
