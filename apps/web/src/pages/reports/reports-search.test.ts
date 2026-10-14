import { describe, expect, it } from 'vitest';
import { isDefaultSearch, reportQueryOf, reportsSearchSchema, withFilter } from './reports-search';

/* P17 地址栏里的条件（PRD P17「第一阶段」：条件写在地址栏）：校验、交给接口的条件、默认值不写进地址栏 */

const STORE = '0190a0b0-0000-7000-8000-000000000001';

describe('P17 地址栏的条件', () => {
  it('写错的条件丢掉；不是自定义时不带起止', () => {
    expect(
      reportsSearchSchema.parse({ period: 'year', store: 'x', site: 'JP', from: '2026-09-01' }),
    ).toEqual({ from: '2026-09-01' });
    expect(reportQueryOf({ period: 'month', from: '2026-09-01', to: '2026-09-03' })).toEqual({
      period: 'month',
    });
    expect(reportQueryOf({ period: 'custom', from: '2026-09-01', to: '2026-09-03' })).toEqual({
      period: 'custom',
      from: '2026-09-01',
      to: '2026-09-03',
    });
  });

  it('改条件：回到近 7 天时从地址栏去掉，离开自定义时去掉起止', () => {
    const custom = withFilter({}, { period: 'custom', from: '2026-09-01', to: '2026-09-03' });
    expect(custom).toMatchObject({ period: 'custom', from: '2026-09-01', to: '2026-09-03' });
    expect(withFilter(custom, { period: '7d' })).toEqual({
      period: undefined,
      from: undefined,
      to: undefined,
    });
    expect(withFilter({ store: STORE }, { site: 'US' })).toMatchObject({
      store: STORE,
      site: 'US',
    });
  });

  it('默认条件（近 7 天、店铺与站点都没选）不给「清除筛选」', () => {
    expect(isDefaultSearch({})).toBe(true);
    expect(isDefaultSearch({ period: '7d' })).toBe(true);
    expect(isDefaultSearch({ period: 'month' })).toBe(false);
    expect(isDefaultSearch({ store: STORE })).toBe(false);
    expect(isDefaultSearch({ site: 'MX' })).toBe(false);
  });
});
