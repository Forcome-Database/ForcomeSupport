import { describe, expect, it } from 'vitest';
import { dailyTicks } from './daily-chart';

describe('每日工单量的纵轴刻度', () => {
  it('原型 73 → 0 · 20 · 40 · 60 · 80；最高一格高过最高的柱', () => {
    expect(dailyTicks(73)).toEqual([0, 20, 40, 60, 80]);
    expect(dailyTicks(6)).toEqual([0, 2, 4, 6, 8]);
  });

  it('工单量是整数：柱很矮时一格至少 1，不出 0.5 的刻度', () => {
    expect(dailyTicks(2)).toEqual([0, 1, 2, 3]);
    expect(dailyTicks(1)).toEqual([0, 1, 2]);
    expect(dailyTicks(0)).toEqual([0, 1]);
  });
});
