import { describe, expect, it } from 'vitest';
import { formatAlertMessage, planAlerts, syncAlertProblem, type FiringAlert } from './alerts';

/*
 * 运维告警的去重与写法（待办 28，协调者 2026-10-14 决定 Q1、Q3）：按异常项的键去重、持续时每 2 小时再提醒、恢复发「已恢复」，
 * 一次自检最多一条消息。
 */

const at = (time: string) => new Date(`2026-10-14T${time}:00+08:00`);
const REPEAT = 2 * 60 * 60_000;

const gmail = {
  key: 'gmail:support@forcome.com',
  subject: 'Gmail support@forcome.com',
  problem: '超过 10 分钟没有同步成功（最近成功 10-14 10:02）',
};
const job = {
  key: 'job_failed:core.sync_exchange_rates',
  subject: '任务 core.sync_exchange_rates',
  problem: '近 60 分钟有 1 个重试用完仍失败：两个来源都取不到',
};

function firing(finding: typeof gmail, since: string, notified: string): FiringAlert {
  return { ...finding, firingSince: at(since), notifiedAt: at(notified) };
}

describe('planAlerts：按键去重', () => {
  it('新出现的项立即提醒', () => {
    const plan = planAlerts([gmail], [], at('10:20'), REPEAT);
    expect(plan.send).toBe(true);
    expect(plan.firing).toEqual([{ ...gmail, firingSince: at('10:20'), isNew: true }]);
    expect(plan.resolved).toEqual([]);
  });

  it('同一项仍异常、问题说明里的时刻变了，没满 2 小时不再发', () => {
    const plan = planAlerts(
      [{ ...gmail, problem: '超过 10 分钟没有同步成功（最近成功 10-14 10:03）' }],
      [firing(gmail, '10:20', '10:20')],
      at('12:19'),
      REPEAT,
    );
    expect(plan.send).toBe(false);
    expect(plan.firing[0]).toMatchObject({ isNew: false, firingSince: at('10:20') });
  });

  it('持续满 2 小时再提醒一次', () => {
    const plan = planAlerts([gmail], [firing(gmail, '10:20', '10:20')], at('12:20'), REPEAT);
    expect(plan.send).toBe(true);
  });

  it('恢复的项发「已恢复」；有新项时把仍在异常的一并写上', () => {
    const plan = planAlerts([job], [firing(gmail, '10:20', '10:20')], at('10:40'), REPEAT);
    expect(plan.send).toBe(true);
    expect(plan.firing.map((f) => [f.key, f.isNew])).toEqual([[job.key, true]]);
    expect(plan.resolved.map((r) => r.key)).toEqual([gmail.key]);
  });

  it('一次自检里同一个键只算一项', () => {
    const plan = planAlerts([gmail, { ...gmail, problem: '另一种说法' }], [], at('10:20'), REPEAT);
    expect(plan.firing).toHaveLength(1);
  });

  it('没有异常也没有恢复时不发', () => {
    expect(planAlerts([], [], at('10:20'), REPEAT).send).toBe(false);
  });
});

describe('formatAlertMessage：一条 markdown 消息', () => {
  it('标题写环境与异常项数，新项标「新」、持续的写从什么时候起，末行写检查时刻', () => {
    const plan = planAlerts([gmail, job], [firing(gmail, '08:20', '10:20')], at('12:20'), REPEAT);
    const message = formatAlertMessage(plan, 'production', at('12:20'));
    expect(message.title).toBe('【Forcome Support · 生产】自检发现 2 项异常');
    expect(message.markdown).toBe(
      [
        '#### 【Forcome Support · 生产】自检发现 2 项异常',
        '',
        '- Gmail support@forcome.com：超过 10 分钟没有同步成功（最近成功 10-14 10:02）（持续中，自 10-14 08:20）',
        '- **新** 任务 core.sync_exchange_rates：近 60 分钟有 1 个重试用完仍失败：两个来源都取不到',
        '',
        '检查时刻 10-14 12:20 · 处理见运维手册',
      ].join('\n'),
    );
  });

  it('只有恢复时标题写「已恢复 N 项」', () => {
    const plan = planAlerts([], [firing(gmail, '08:20', '10:20')], at('10:31'), REPEAT);
    const message = formatAlertMessage(plan, 'staging', at('10:31'));
    expect(message.title).toBe('【Forcome Support · 开发测试】已恢复 1 项');
    expect(message.markdown).toContain(
      '**已恢复**\n\n- Gmail support@forcome.com（异常自 10-14 08:20）',
    );
  });
});

describe('syncAlertProblem：PRD 6.9 的同步延迟与连接异常', () => {
  const health = { lastSuccessAt: at('10:02'), consecutiveFailures: 0, failingSince: null };

  it('同步延迟写阈值与最近成功', () => {
    expect(syncAlertProblem('delayed', health, 10 * 60_000)).toBe(
      '超过 10 分钟没有同步成功（最近成功 10-14 10:02）',
    );
    expect(syncAlertProblem('delayed', health, 2 * 60 * 60_000)).toBe(
      '超过 2 小时没有同步成功（最近成功 10-14 10:02）',
    );
  });

  it('连接异常写连续失败次数与起始时刻', () => {
    expect(
      syncAlertProblem(
        'error',
        { lastSuccessAt: null, consecutiveFailures: 3, failingSince: at('10:05') },
        10 * 60_000,
      ),
    ).toBe('连续 3 次同步失败（自 10-14 10:05 起，还没有成功过）');
  });

  it('已连接与未连接不告警', () => {
    expect(syncAlertProblem('connected', health, 10 * 60_000)).toBeNull();
    expect(syncAlertProblem('not_connected', health, 10 * 60_000)).toBeNull();
  });
});
