import { describe, expect, it } from 'vitest';
import { isDefaultSearch, ledgerQueryOf, ledgerSearchSchema, rangeLabel } from './ledger-search';

/*
 * P13 地址栏的筛选条件（S13 补充小样，用户确认 10-05）：费用发生日不在地址栏时是默认的本月（由接口补上）；
 * 筛出缺字段时只随店铺；条件就是默认时不出「清除筛选」。
 */

const STORE = '01a10c50-0f83-7d39-b383-5f330757b56a';

describe('P13 的筛选条件', () => {
  it('写错的条件丢掉，其余照留', () => {
    expect(
      ledgerSearchSchema.parse({
        from: '09-01',
        to: '2026-09-11',
        status: 'pending',
        method: 'send_parts',
        store: 'not-a-uuid',
        missing: '2',
      }),
    ).toEqual({ to: '2026-09-11', method: 'send_parts' });
  });

  it('?missing=1：路由把手写的 1 解析成数字，也认作筛出缺字段', () => {
    expect(ledgerSearchSchema.parse({ missing: 1 })).toEqual({ missing: '1' });
    expect(ledgerSearchSchema.parse({ missing: '1' })).toEqual({ missing: '1' });
    expect(ledgerSearchSchema.parse({ missing: true })).toEqual({});
  });

  it('交给接口的条件照地址栏；筛出缺字段时只带店铺', () => {
    expect(ledgerQueryOf({ store: STORE, method: 'send_parts', from: '2026-08-01' })).toEqual({
      from: '2026-08-01',
      to: undefined,
      store: STORE,
      method: 'send_parts',
      responsibility: undefined,
      status: undefined,
      owner: undefined,
    });
    expect(
      ledgerQueryOf({ missing: '1', store: STORE, method: 'send_parts', from: '2026-08-01' }),
    ).toEqual({ missing: '1', store: STORE });
  });

  it('条件是否就是默认：地址栏没有任何条件', () => {
    expect(isDefaultSearch({})).toBe(true);
    expect(isDefaultSearch({ from: '2026-09-02' })).toBe(false);
    expect(isDefaultSearch({ status: 'completed' })).toBe(false);
    expect(isDefaultSearch({ missing: '1' })).toBe(false);
  });

  it('费用发生日的写法：同一年的结束日不写年份（原型「2026-09-01 至 09-11」）', () => {
    expect(rangeLabel({ from: '2026-09-01', to: '2026-09-11' })).toBe('2026-09-01 至 09-11');
    expect(rangeLabel({ from: '2025-12-20', to: '2026-01-05' })).toBe('2025-12-20 至 2026-01-05');
  });
});
