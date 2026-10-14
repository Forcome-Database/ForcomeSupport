import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_SETTINGS } from './config';
import { backupFindings, type BackupState } from './self-check';

/*
 * 备份与 WAL 归档的判断（待办 28，协调者 2026-10-14 决定 Q2 g 的修改：阈值取 archive_timeout 的 2 倍）。
 * 本机开发库与测试库不开归档，所以单独测这一段的判断；查询本身在开发测试环境的演练里核对。
 */

const at = (time: string) => new Date(`2026-10-14T${time}:00+08:00`);
const HOUR = 3_600_000;

const healthy: BackupState = {
  now: at('10:20'),
  postmasterStart: at('08:00'),
  archiveTimeoutSeconds: 300,
  lastArchived: at('10:16'),
  lastFailed: null,
  lastFailedWal: null,
  lastFinished: { succeeded: true, finishedAt: at('02:35'), startedAt: at('02:30'), detail: 'ok' },
  lastSucceededAt: at('02:35'),
};

describe('backupFindings', () => {
  it('归档与备份都正常：没有异常', () => {
    expect(backupFindings(healthy, DEFAULT_ALERT_SETTINGS)).toEqual([]);
  });

  it('WAL：超过 archive_timeout 的 2 倍（5 分钟 × 2）没有归档成功', () => {
    expect(
      backupFindings({ ...healthy, lastArchived: at('10:09') }, DEFAULT_ALERT_SETTINGS),
    ).toEqual([
      {
        key: 'backup:wal_archive',
        subject: 'WAL 连续归档',
        problem: '超过 10 分钟没有归档成功（最近成功 10-14 10:09）',
      },
    ]);
    expect(
      backupFindings({ ...healthy, lastArchived: at('10:11') }, DEFAULT_ALERT_SETTINGS),
    ).toEqual([]);
  });

  it('WAL：最近一次失败晚于最近一次成功（NAS 写不进去等）', () => {
    expect(
      backupFindings(
        { ...healthy, lastFailed: at('10:19'), lastFailedWal: '000000010000000000000042' },
        DEFAULT_ALERT_SETTINGS,
      ),
    ).toEqual([
      {
        key: 'backup:wal_archive',
        subject: 'WAL 连续归档',
        problem: '归档失败（000000010000000000000042，10-14 10:19；最近成功 10-14 10:16）',
      },
    ]);
  });

  it('备份：最近一次失败；最近一次成功超过 26 小时', () => {
    const now = new Date(at('02:35').getTime() + 27 * HOUR);
    const findings = backupFindings(
      {
        ...healthy,
        now,
        lastArchived: new Date(now.getTime() - 60_000),
        lastFinished: {
          succeeded: false,
          finishedAt: new Date(at('02:31').getTime() + 24 * HOUR),
          startedAt: new Date(at('02:30').getTime() + 24 * HOUR),
          detail: 'restic backup：repository is locked',
        },
      },
      DEFAULT_ALERT_SETTINGS,
    );
    expect(findings.map((f) => [f.key, f.problem])).toEqual([
      ['backup:failed', '最近一次备份失败（10-15 02:31）：restic backup：repository is locked'],
      ['backup:stale', '超过 26 小时没有成功的备份（最近成功 10-14 02:35）'],
    ]);
  });

  it('还没有成功的备份：从数据库启动起算，刚启动不告警', () => {
    const fresh = { ...healthy, lastFinished: null, lastSucceededAt: null };
    expect(backupFindings(fresh, DEFAULT_ALERT_SETTINGS)).toEqual([]);
    expect(
      backupFindings(
        {
          ...fresh,
          now: new Date(at('08:00').getTime() + 27 * HOUR),
          lastArchived: null,
          postmasterStart: at('08:00'),
        },
        DEFAULT_ALERT_SETTINGS,
      ).map((f) => f.key),
    ).toEqual(['backup:wal_archive', 'backup:stale']);
  });
});
