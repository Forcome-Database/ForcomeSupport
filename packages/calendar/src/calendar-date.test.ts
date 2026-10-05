import { describe, expect, it } from 'vitest';
import { addDays, isWeekday } from './index';

describe('日历日期（YYYY-MM-DD，不带时区）', () => {
  it('加减天数跨月、跨年、闰年', () => {
    expect(addDays('2026-09-10', 1)).toBe('2026-09-11');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-09-11', -90)).toBe('2026-06-13');
  });

  it('周一到周五是工作日（欧洲央行只在工作日公布参考汇率）', () => {
    expect(isWeekday('2026-09-11')).toBe(true); // 周五
    expect(isWeekday('2026-09-12')).toBe(false); // 周六
    expect(isWeekday('2026-09-13')).toBe(false); // 周日
    expect(isWeekday('2026-09-14')).toBe(true); // 周一
  });

  it('不是合法日期直接报错', () => {
    expect(() => addDays('2026-13-01', 1)).toThrow(RangeError);
    expect(() => isWeekday('09-11')).toThrow(RangeError);
  });
});
