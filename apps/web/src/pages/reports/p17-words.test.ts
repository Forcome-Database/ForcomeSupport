import { describe, expect, it } from 'vitest';
import {
  comparePrefix,
  dayWords,
  emptyScopeWords,
  firstResponseDelta,
  firstResponseWords,
  periodWords,
  rangeWords,
  rateWords,
  slaDelta,
  slaSubWords,
  updatedWords,
  volumeDelta,
} from './p17-words';

/*
 * P17 的写法（PRD P17「第一阶段」v2.34，协调者 2026-10-14 决定 Q2、Q4–Q7；示例取原型 K19 与补充小样①–③）。
 */

const TODAY = '2026-09-11';
const week = { period: '7d' as const, from: '2026-09-05', to: TODAY };
const month = { period: 'month' as const, from: '2026-09-01', to: TODAY };
const custom = { period: 'custom' as const, from: '2026-09-01', to: '2026-09-03' };
const H = 3_600_000;
const M = 60_000;

describe('期间与对比的前缀', () => {
  it('筛选行写起止；副标题写「近 7 天」「本月」或起止；对比前缀随期间', () => {
    expect(rangeWords(week, TODAY)).toBe('09-05 至 09-11');
    expect(dayWords('2026-09-10', TODAY)).toBe('09-10');
    expect(dayWords('2025-09-10', TODAY)).toBe('2025-09-10');
    expect(rangeWords({ from: '2025-12-30', to: '2026-01-02' }, TODAY)).toBe('2025-12-30 至 01-02');
    expect([week, month, custom].map((r) => periodWords(r, TODAY))).toEqual([
      '近 7 天',
      '本月',
      '09-01 至 09-03',
    ]);
    expect([week, month, custom].map(comparePrefix)).toEqual([
      '较前 7 天',
      '较上月同期',
      '较前 3 天',
    ]);
  });
});

describe('指标的写法', () => {
  it('首响：不足 1 小时写分钟，其余「2h 14m」，超过 24 小时照写小时；没有已回复为「—」', () => {
    expect(firstResponseWords(35 * M)).toBe('35m');
    expect(firstResponseWords(2 * H + 14 * M)).toBe('2h 14m');
    expect(firstResponseWords(30 * H + 5 * M)).toBe('30h 05m');
    expect(firstResponseWords(null)).toBe('—');
  });

  it('达标率保留一位、整数不写小数；分母为 0 为「—」', () => {
    expect(rateWords({ met: 296, counted: 307 })).toBe('96.4%');
    expect(rateWords({ met: 9, counted: 9 })).toBe('100%');
    expect(rateWords({ met: 1, counted: 2 })).toBe('50%');
    expect(rateWords({ met: 0, counted: 0 })).toBe('—');
  });

  it('SLA 副标题：未达标封数；有未归属的未达标来信时写其中几封（Q4）', () => {
    expect(slaSubWords({ met: 296, counted: 307 }, 0)).toBe('未达标 11 封');
    expect(slaSubWords({ met: 296, counted: 307 }, 2)).toBe('未达标 11 封 · 其中 2 封未归属店铺');
  });
});

describe('与上一周期的对比（Q2）', () => {
  it('工单量：相对变化取整、一律中性色，持平写「持平」，上一周期为 0 不写', () => {
    expect(volumeDelta(357, 331, week)).toEqual({ text: '较前 7 天 +8%', tone: 'muted' });
    expect(volumeDelta(298, 307, month)).toEqual({ text: '较上月同期 -3%', tone: 'muted' });
    expect(volumeDelta(41, 41, custom)).toEqual({ text: '较前 3 天 持平', tone: 'muted' });
    expect(volumeDelta(41, 0, custom)).toBeNull();
  });

  it('首响：差值，缩短绿色、变长红色；任一期没有已回复的不写', () => {
    expect(firstResponseDelta(2 * H + 14 * M, 2 * H + 49 * M, week)).toEqual({
      text: '较前 7 天 -35m',
      tone: 'success',
    });
    expect(firstResponseDelta(3 * H + 19 * M, 2 * H + 14 * M, month)).toEqual({
      text: '较上月同期 +1h 05m',
      tone: 'danger',
    });
    expect(firstResponseDelta(35 * M, null, custom)).toBeNull();
    expect(firstResponseDelta(null, 35 * M, custom)).toBeNull();
  });

  it('SLA：差值「个百分点」保留一位，升高绿色、降低红色；任一期分母为 0 不写', () => {
    // 96.4% 对 95.2%
    expect(slaDelta({ met: 964, counted: 1000 }, { met: 952, counted: 1000 }, week)).toEqual({
      text: '较前 7 天 +1.2 个百分点',
      tone: 'success',
    });
    expect(slaDelta({ met: 941, counted: 1000 }, { met: 949, counted: 1000 }, month)).toEqual({
      text: '较上月同期 -0.8 个百分点',
      tone: 'danger',
    });
    expect(slaDelta({ met: 1, counted: 1 }, { met: 0, counted: 0 }, custom)).toBeNull();
    // 按两期显示的值相减：96.44% 写 96.4%、95.35% 写 95.4%，差值写 +1.0（不是未舍入相减的 +1.1）
    expect(slaDelta({ met: 9644, counted: 10000 }, { met: 9535, counted: 10000 }, week)?.text).toBe(
      '较前 7 天 +1.0 个百分点',
    );
  });
});

describe('「更新于」与无数据的说明', () => {
  const now = new Date('2026-09-11T10:20:00+08:00');

  it('当天写时分，跨天带日期，不在今年带年份；从没同步成功过写「—」（Q6）', () => {
    expect(updatedWords('2026-09-11T02:12:00.000Z', now)).toBe('更新于 10:12');
    expect(updatedWords('2026-09-10T02:12:00.000Z', now)).toBe('更新于 09-10 10:12');
    expect(updatedWords('2025-12-31T02:12:00.000Z', now)).toBe('更新于 2025-12-31 10:12');
    expect(updatedWords(null, now)).toBe('更新于 —');
  });

  it('无数据的范围：店铺名或「全部店铺」，选了站点在后面写（Q5）', () => {
    expect(emptyScopeWords('Forcome Direct', null)).toBe('Forcome Direct');
    expect(emptyScopeWords(null, null)).toBe('全部店铺');
    expect(emptyScopeWords('Forcome Direct', 'US')).toBe('Forcome Direct · US');
  });
});
