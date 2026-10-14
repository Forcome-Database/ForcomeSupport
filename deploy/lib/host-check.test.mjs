import { describe, expect, it } from 'vitest';
import { formatHostAlert, hostFindings, parseHeartbeatRow, planHostAlerts } from './host-check.mjs';

/*
 * 宿主机检查（待办 28；ADR 0013 修订「worker 存活检查」，协调者 2026-10-14 决定 Q1–Q4）：「进程退出」与「进程在但心跳停」
 * 两种都告警；上线切换回放中靠维护标记暂停（标记过期后照常告警并注明还在回放）；去重、再提醒与恢复同 worker 自检。
 */

const at = (time) => new Date(`2026-10-14T${time}:00+08:00`);
const SETTINGS = { heartbeatMinutes: 3 };

const healthy = {
  workerState: 'running',
  workerStartedAt: at('08:00'),
  databaseReachable: true,
  databaseError: null,
  heartbeatAt: at('10:19'),
  now: at('10:20'),
  cutover: 'none',
};

describe('hostFindings', () => {
  it('worker 在运行、心跳 3 分钟以内：正常', () => {
    expect(hostFindings(healthy, SETTINGS)).toEqual([]);
  });

  it('进程退出：worker 容器不在运行，或没有容器', () => {
    expect(hostFindings({ ...healthy, workerState: 'exited' }, SETTINGS)).toEqual([
      { key: 'worker:down', subject: 'worker', problem: '容器不在运行（状态 exited）' },
    ]);
    expect(hostFindings({ ...healthy, workerState: null }, SETTINGS)).toEqual([
      { key: 'worker:down', subject: 'worker', problem: '没有 worker 容器（没部署或被删掉了）' },
    ]);
  });

  it('进程在但心跳停：超过 3 分钟没更新（暂停的容器注明）', () => {
    expect(hostFindings({ ...healthy, heartbeatAt: at('10:16') }, SETTINGS)).toEqual([
      {
        key: 'worker:heartbeat',
        subject: 'worker',
        problem: '进程在，但心跳超过 3 分钟没有更新（最近 10-14 10:16）',
      },
    ]);
    expect(
      hostFindings({ ...healthy, workerState: 'paused', heartbeatAt: at('10:10') }, SETTINGS)[0]
        ?.problem,
    ).toBe('进程在，但心跳超过 3 分钟没有更新（最近 10-14 10:10；容器处于暂停状态）');
  });

  it('还没有心跳：启动 3 分钟以内不算，之后算心跳停', () => {
    const fresh = { ...healthy, heartbeatAt: null };
    expect(hostFindings({ ...fresh, workerStartedAt: at('10:18') }, SETTINGS)).toEqual([]);
    expect(hostFindings({ ...fresh, workerStartedAt: at('10:15') }, SETTINGS)[0]?.key).toBe(
      'worker:heartbeat',
    );
  });

  it('上线切换回放中 worker 停着：回放命令的维护标记有效时整次不告警；标记过期仍停着照常告警并注明（待办 26）', () => {
    expect(
      hostFindings({ ...healthy, workerState: 'exited', cutover: 'replaying' }, SETTINGS),
    ).toEqual([
      {
        key: 'worker:down',
        subject: 'worker',
        problem: '容器不在运行（状态 exited；上线切换的回放还没完成）',
      },
    ]);
  });

  it('数据库连不上：告警，不再据心跳判断', () => {
    expect(
      hostFindings(
        {
          ...healthy,
          databaseReachable: false,
          databaseError: '数据库容器 exited',
          heartbeatAt: null,
        },
        SETTINGS,
      ),
    ).toEqual([
      {
        key: 'database:unreachable',
        subject: '数据库',
        problem: '连不上，读不到 worker 心跳（数据库容器 exited）',
      },
    ]);
  });
});

describe('planHostAlerts 与 formatHostAlert', () => {
  const REPEAT = 2 * 3_600_000;
  const down = { key: 'worker:down', subject: 'worker', problem: '容器不在运行（状态 exited）' };

  it('新异常立即发，标题写「worker 已停止」；1 分钟后不重发，2 小时后再提醒', () => {
    const first = planHostAlerts([down], {}, at('10:20'), REPEAT);
    expect(first.send).toBe(true);
    const message = formatHostAlert(first, {
      appEnv: 'production',
      now: at('10:20'),
      expiredMaintenance: null,
    });
    expect(message.title).toBe('【Forcome Support · 生产】worker 已停止');
    expect(message.markdown).toBe(
      [
        '#### 【Forcome Support · 生产】worker 已停止',
        '',
        '- **新** worker：容器不在运行（状态 exited）',
        '',
        '宿主机检查 10-14 10:20 · 处理见运维手册',
      ].join('\n'),
    );
    expect(planHostAlerts([down], first.nextState, at('10:21'), REPEAT).send).toBe(false);
    const again = planHostAlerts([down], first.nextState, at('12:20'), REPEAT);
    expect(again.send).toBe(true);
    expect(again.nextState['worker:down']?.firingSince).toBe(at('10:20').toISOString());
  });

  it('恢复发「已恢复：worker 已停止」；维护标记过期时注明', () => {
    const first = planHostAlerts([down], {}, at('10:20'), REPEAT);
    const recovered = planHostAlerts([], first.nextState, at('10:25'), REPEAT);
    expect(recovered).toMatchObject({ send: true, nextState: {} });
    const message = formatHostAlert(recovered, {
      appEnv: 'staging',
      now: at('10:25'),
      expiredMaintenance: { reason: '部署 3f2a1c9e0b7d', until: at('10:24').toISOString() },
    });
    expect(message.title).toBe('【Forcome Support · 开发测试】已恢复：worker 已停止');
    expect(message.markdown).toContain('**已恢复**\n\n- worker 已停止（异常自 10-14 10:20）');
    expect(message.markdown).toContain('维护标记已过期（部署 3f2a1c9e0b7d，到期 10-14 10:24）');
  });
});

describe('parseHeartbeatRow', () => {
  it('psql -At 的一行：心跳时刻|数据库此刻|切换状态；还没有心跳为空', () => {
    expect(parseHeartbeatRow('2026-10-14T02:19:00Z|2026-10-14T02:20:00Z|replaying\n')).toEqual({
      heartbeatAt: new Date('2026-10-14T02:19:00Z'),
      now: new Date('2026-10-14T02:20:00Z'),
      cutover: 'replaying',
    });
    expect(parseHeartbeatRow('|2026-10-14T02:20:00Z|none').heartbeatAt).toBeNull();
  });
});
