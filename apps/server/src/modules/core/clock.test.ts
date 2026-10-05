import { describe, expect, it } from 'vitest';
import { ManualClock, startingAt, systemClock } from './index';

describe('可注入时钟', () => {
  it('系统时钟返回真实当前时间', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('手动时钟停在给定时刻，可设定与推进', () => {
    const clock = new ManualClock('2026-09-11T02:20:00Z');
    expect(clock.now().toISOString()).toBe('2026-09-11T02:20:00.000Z');

    clock.advance({ hours: 24, minutes: 1 });
    expect(clock.now().toISOString()).toBe('2026-09-12T02:21:00.000Z');

    clock.advance({ days: 7, seconds: 30 });
    expect(clock.now().toISOString()).toBe('2026-09-19T02:21:30.000Z');

    clock.set(new Date('2026-10-01T00:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('调用方改动返回的 Date 不影响时钟', () => {
    const clock = new ManualClock('2026-09-11T02:20:00Z');
    clock.now().setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe('2026-09-11T02:20:00.000Z');
  });

  it('从起始时刻走的时钟（非生产环境的 CLOCK_START）：从给定时刻起随底层时钟前进', () => {
    const base = new ManualClock('2026-10-05T11:00:00Z');
    const clock = startingAt(new Date('2026-09-11T02:20:00Z'), base);
    expect(clock.now().toISOString()).toBe('2026-09-11T02:20:00.000Z');
    base.advance({ minutes: 5, seconds: 3 });
    expect(clock.now().toISOString()).toBe('2026-09-11T02:25:03.000Z');
  });

  it('不接受无效时间；advance 不能倒推', () => {
    expect(() => new ManualClock('not a date')).toThrow(RangeError);
    const clock = new ManualClock('2026-09-11T02:20:00Z');
    expect(() => clock.advance({ minutes: -1 })).toThrow(RangeError);
  });
});
