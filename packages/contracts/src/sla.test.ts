import { describe, expect, it } from 'vitest';
import { slaDueAt, slaRemainingWords, slaResultOf, slaTargetOf } from './sla';

/*
 * SLA 的口径与写法（PRD R-SL-02、R-SL-03、R-SL-08，待办 16）：截止时刻、结果、目标种类与「剩余 / 已超时」的显示格式。
 * 示例取原型：data.py 的 P1_SLA_KINDS、P1_EXTRA_TICKETS、未归属店铺队列（「23h 27m · 内部」）。
 */

const at = (iso: string) => new Date(iso);

describe('SLA 截止与目标种类（R-SL-02，第一阶段固定 24 小时）', () => {
  it('截止 = 来信到达（internalDate）+ 24 自然小时，跨周末不顺延', () => {
    // 2026-09-12 是周六
    expect(slaDueAt(at('2026-09-11T22:30:00+08:00'))).toEqual(at('2026-09-12T22:30:00+08:00'));
  });

  it('亚马逊来信按平台 SLA 计，Shopify 与邮件按内部目标计', () => {
    expect(slaTargetOf('amazon')).toBe('platform');
    expect(slaTargetOf('shopify')).toBe('internal');
    expect(slaTargetOf('email')).toBe('internal');
  });
});

describe('SLA 结果（R-SL-01、R-SL-08）', () => {
  const due = at('2026-09-11T08:15:00+08:00');

  it('截止前（含截止那一刻）首次回复为达标，晚于截止为未达标', () => {
    expect(
      slaResultOf({ dueAt: due, firstReplyAt: at('2026-09-10T08:43:00+08:00'), now: due }),
    ).toBe('met');
    expect(slaResultOf({ dueAt: due, firstReplyAt: due, now: due })).toBe('met');
    expect(
      slaResultOf({
        dueAt: due,
        firstReplyAt: at('2026-09-11T08:16:00+08:00'),
        now: at('2026-09-11T09:00:00+08:00'),
      }),
    ).toBe('missed');
  });

  it('还没回复：没过截止为未到期（截止那一刻仍未到期），过了截止为未达标', () => {
    expect(
      slaResultOf({ dueAt: due, firstReplyAt: null, now: at('2026-09-11T08:14:00+08:00') }),
    ).toBe('pending');
    expect(slaResultOf({ dueAt: due, firstReplyAt: null, now: due })).toBe('pending');
    expect(
      slaResultOf({ dueAt: due, firstReplyAt: null, now: at('2026-09-11T08:15:00.001+08:00') }),
    ).toBe('missed');
  });
});

describe('SLA 剩余的显示（R-SL-03）', () => {
  const due = at('2026-09-11T16:00:00+08:00');
  const words = (now: string, target: 'platform' | 'internal' = 'platform') =>
    slaRemainingWords({ dueAt: due, now: at(now), target });

  it('剩余写「5h 40m」，分钟补两位；不满 1 小时也写小时「0h 55m」', () => {
    expect(words('2026-09-11T10:20:00+08:00')).toEqual({ text: '5h 40m', tone: 'warning' });
    expect(words('2026-09-11T15:05:00+08:00')).toEqual({ text: '0h 55m', tone: 'danger' });
    expect(words('2026-09-10T16:06:00+08:00')).toEqual({ text: '23h 54m', tone: 'normal' });
    // 刚到达：整 24 小时
    expect(words('2026-09-10T16:00:00+08:00')).toEqual({ text: '24h 00m', tone: 'normal' });
  });

  it('剩余不足一分钟的秒数舍去（宁可少报剩余）', () => {
    expect(words('2026-09-11T10:19:30+08:00').text).toBe('5h 40m');
    expect(words('2026-09-11T15:59:59+08:00')).toEqual({ text: '0h 00m', tone: 'danger' });
  });

  it('颜色：剩余 ≤ 2 小时红色，≤ 6 小时黄色，其余正常', () => {
    expect(words('2026-09-11T14:00:00+08:00').tone).toBe('danger');
    expect(words('2026-09-11T13:59:00+08:00').tone).toBe('warning');
    expect(words('2026-09-11T10:00:00+08:00').tone).toBe('warning');
    expect(words('2026-09-11T09:59:00+08:00').tone).toBe('normal');
  });

  it('过了截止写「已超时 2h 05m」（红色），不足一分钟按一分钟计', () => {
    expect(words('2026-09-11T18:05:00+08:00')).toEqual({ text: '已超时 2h 05m', tone: 'danger' });
    expect(words('2026-09-11T16:00:01+08:00')).toEqual({ text: '已超时 0h 01m', tone: 'danger' });
    expect(words('2026-09-11T23:59:00+08:00').text).toBe('已超时 7h 59m');
  });

  it('超时满 24 小时写「已超时 1d 3h」（天与小时，不写分钟）', () => {
    expect(words('2026-09-12T16:00:00+08:00').text).toBe('已超时 1d 0h');
    expect(words('2026-09-12T19:30:00+08:00').text).toBe('已超时 1d 3h');
    expect(words('2026-09-14T15:59:00+08:00').text).toBe('已超时 2d 23h');
  });

  it('内部目标（Shopify 与邮件）在数值后加「· 内部」，剩余与已超时都加', () => {
    expect(words('2026-09-10T16:33:00+08:00', 'internal')).toEqual({
      text: '23h 27m · 内部',
      tone: 'normal',
    });
    expect(words('2026-09-11T18:05:00+08:00', 'internal').text).toBe('已超时 2h 05m · 内部');
    expect(words('2026-09-12T19:30:00+08:00', 'internal').text).toBe('已超时 1d 3h · 内部');
  });
});
