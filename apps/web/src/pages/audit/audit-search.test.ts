import { describe, expect, it } from 'vitest';
import { auditQueryOf, auditSearchSchema, isDefaultSearch, withFilter } from './audit-search';

const MEMBER = '01920000-0000-7000-8000-0000000000b3';

describe('P27 地址栏的筛选条件', () => {
  it('认得出的条件保留，写错的丢掉', () => {
    expect(
      auditSearchSchema.parse({
        period: 'week',
        actor: MEMBER,
        type: 'aftersales',
        action: '设为已完成',
        q: 'S-2026',
        page: 2,
      }),
    ).toEqual({
      period: 'week',
      actor: MEMBER,
      type: 'aftersales',
      action: '设为已完成',
      q: 'S-2026',
      page: 2,
    });
    expect(
      auditSearchSchema.parse({
        period: 'month',
        from: '09-01',
        actor: 'someone',
        type: 'approval',
        q: '',
        page: 1,
      }),
    ).toEqual({});
    expect(auditSearchSchema.parse({ actor: 'system', q: 1063, page: '3' })).toEqual({
      actor: 'system',
      q: '1063',
      page: 3,
    });
  });

  it('只有自定义时把起止交给接口', () => {
    expect(auditQueryOf({ period: 'week', from: '2026-09-01', to: '2026-09-02' })).toMatchObject({
      period: 'week',
      from: undefined,
      to: undefined,
    });
    expect(auditQueryOf({ period: 'custom', from: '2026-09-01', to: '2026-09-02' })).toMatchObject({
      period: 'custom',
      from: '2026-09-01',
      to: '2026-09-02',
    });
  });

  it('默认是今天、其余没选；改筛选回到第一页', () => {
    expect(isDefaultSearch({})).toBe(true);
    expect(isDefaultSearch({ period: 'today', page: 3 })).toBe(true);
    expect(isDefaultSearch({ period: 'week' })).toBe(false);
    expect(isDefaultSearch({ q: 'S-' })).toBe(false);
    expect(withFilter({ type: 'store', page: 3 }, { actor: 'system' })).toEqual({
      type: 'store',
      actor: 'system',
      page: undefined,
    });
  });
});
