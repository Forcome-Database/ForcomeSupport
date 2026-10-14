import { describe, expect, it } from 'vitest';
import {
  backupRun,
  durationWords,
  restoreDrillRun,
  restoreResults,
  restoreRun,
} from './backup.mjs';

/* 备份、恢复与恢复演练子命令的参数（待办 28） */

describe('backup', () => {
  it('不带参数立即备份一次（manual）；list、verify-retention 交给备份脚本', () => {
    expect(backupRun([])).toEqual({ command: ['forcome-backup', 'run', 'manual'] });
    expect(backupRun(['list'])).toEqual({ command: ['forcome-backup', 'list'] });
    expect(backupRun(['verify-retention'])).toEqual({
      command: ['forcome-backup', 'verify-retention'],
    });
    expect(backupRun(['delete'])).toHaveProperty('error');
  });
});

describe('restore', () => {
  it('恢复到某个时点：目标时点必须带时区；原数据目录改名留着', () => {
    expect(restoreRun(['--target-time', '2026-10-14T10:20:00+08:00', '--confirm'])).toEqual({
      targetTime: '2026-10-14T10:20:00+08:00',
      backup: null,
      confirm: true,
      prepare: [
        'forcome-restore',
        'prepare',
        '--move-aside',
        '--target-time',
        '2026-10-14T10:20:00+08:00',
      ],
    });
    expect(restoreRun(['--target-time', '2026-10-14 10:20'])).toEqual({
      error:
        '--target-time 要写带时区的时刻，如 2026-10-14T10:20:00+08:00（现在是「2026-10-14 10:20」）',
    });
  });

  it('恢复到最新、指定基础备份；不加 --confirm 只看计划', () => {
    expect(restoreRun(['--latest', '--backup', 'base_000000010000000000000042'])).toMatchObject({
      targetTime: null,
      confirm: false,
      prepare: [
        'forcome-restore',
        'prepare',
        '--move-aside',
        '--backup',
        'base_000000010000000000000042',
      ],
    });
  });

  it('目标时点与最新必须且只能给一个', () => {
    expect(restoreRun(['--confirm'])).toHaveProperty('error');
    expect(restoreRun(['--latest', '--target-time', '2026-10-14T10:20:00Z'])).toEqual({
      error: '--target-time 与 --latest 只能给一个',
    });
  });
});

describe('restore-drill', () => {
  it('不给目标时点时用演练标记；给了要带时区', () => {
    expect(restoreDrillRun([])).toEqual({ targetTime: null });
    expect(restoreDrillRun(['--target-time', '2026-10-14T02:20:00.123456Z'])).toEqual({
      targetTime: '2026-10-14T02:20:00.123456Z',
    });
    expect(restoreDrillRun(['--target-time', 'yesterday'])).toHaveProperty('error');
  });
});

describe('恢复脚本的输出', () => {
  it('取出 RESTORE_* 行；用时写成分与秒', () => {
    const output = [
      '取回基础备份 base_000000010000000000000042',
      'RESTORE_BASE_BACKUP=base_000000010000000000000042',
      'RESTORE_FETCH_SECONDS=12',
      'RESTORE_RESULT=ok',
    ].join('\n');
    expect(restoreResults(output)).toEqual({
      BASE_BACKUP: 'base_000000010000000000000042',
      FETCH_SECONDS: '12',
      RESULT: 'ok',
    });
    expect(durationWords(42)).toBe('42 秒');
    expect(durationWords(200)).toBe('3 分 20 秒');
    expect(durationWords(3 * 3600 + 120)).toBe('3 小时 2 分');
  });
});
