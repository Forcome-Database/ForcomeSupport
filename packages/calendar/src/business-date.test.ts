import { describe, expect, it } from 'vitest';
import { BUSINESS_TIME_ZONE, businessDate } from './index';

describe('业务日界（Asia/Shanghai）', () => {
  it('业务时区是北京时间', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Asia/Shanghai');
  });

  it('UTC 16:00 前仍是当天，16:00 起是北京时间次日', () => {
    expect(businessDate(new Date('2026-09-11T15:59:59.999Z'))).toBe('2026-09-11');
    expect(businessDate(new Date('2026-09-11T16:00:00.000Z'))).toBe('2026-09-12');
  });

  it('跨年按北京时间判断', () => {
    expect(businessDate(new Date('2026-12-31T16:30:00Z'))).toBe('2027-01-01');
  });

  it('无效时间直接报错，不悄悄给出日期', () => {
    expect(() => businessDate(new Date('not a date'))).toThrow(RangeError);
  });
});
