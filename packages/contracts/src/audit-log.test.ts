import { describe, expect, it } from 'vitest';
import { auditActionFilterOptions, auditActionsOfFilter } from './audit';
import {
  auditConditionWords,
  auditRange,
  auditScope,
  auditTimeWords,
  dateRangeWords,
} from './audit-log';

describe('时间筛选与日期写法', () => {
  it('今天、近 7 天（含今天）、自定义（两端没给的取今天，起止颠倒时对调）', () => {
    expect(auditRange({}, '2026-09-11')).toEqual({
      period: 'today',
      from: '2026-09-11',
      to: '2026-09-11',
    });
    expect(auditRange({ period: 'week' }, '2026-09-11')).toEqual({
      period: 'week',
      from: '2026-09-05',
      to: '2026-09-11',
    });
    expect(
      auditRange({ period: 'custom', from: '2026-09-10', to: '2026-09-01' }, '2026-09-11'),
    ).toEqual({ period: 'custom', from: '2026-09-01', to: '2026-09-10' });
    expect(auditRange({ period: 'custom', from: '2026-09-01' }, '2026-09-11')).toEqual({
      period: 'custom',
      from: '2026-09-01',
      to: '2026-09-11',
    });
  });

  it('同一天写日期，整月写「9 月」，其余写「起 至 止」（同年省略止的年份）', () => {
    expect(dateRangeWords('2026-09-11', '2026-09-11')).toBe('2026-09-11');
    expect(dateRangeWords('2026-09-01', '2026-09-30')).toBe('9 月');
    expect(dateRangeWords('2026-02-01', '2026-02-28')).toBe('2 月');
    expect(dateRangeWords('2026-09-01', '2026-09-11')).toBe('2026-09-01 至 09-11');
    expect(dateRangeWords('2025-12-30', '2026-01-05')).toBe('2025-12-30 至 2026-01-05');
  });
});

describe('时刻与筛选条件的写法', () => {
  it('只写时分，或带日期（不在当年的写全年份）', () => {
    const at = '2026-09-11T02:14:00.000Z';
    expect(auditTimeWords(at, { withDate: false, year: '2026' })).toBe('10:14');
    expect(auditTimeWords(at, { withDate: true, year: '2026' })).toBe('09-11 10:14');
    expect(auditTimeWords(new Date(at), { withDate: true, year: '2027' })).toBe('2026-09-11 10:14');
  });

  it('时间以外的各项：操作人、对象类型、动作（筛选键写成叫法）、对象编号', () => {
    expect(
      auditConditionWords({ actorName: '王磊', type: 'store', action: 'export', q: 'S-' }),
    ).toEqual(['操作人 王磊', '店铺', '导出 Excel', '对象编号含「S-」']);
    expect(auditConditionWords({})).toEqual([]);
  });
});

describe('动作筛选', () => {
  it('叫法相同的动作合为一项（键 export）；选了对象类型时只列该类型的动作与越权访问被拒', () => {
    const all = auditActionFilterOptions();
    expect(all.filter((option) => option.label === '导出 Excel')).toEqual([
      { value: 'export', label: '导出 Excel' },
    ]);
    expect(all.map((option) => option.value)).toContain('access.denied');
    expect(auditActionFilterOptions('store')).toEqual([
      { value: 'store.create', label: '新增店铺' },
      { value: 'store.update', label: '编辑店铺' },
      { value: 'access.denied', label: '越权访问被拒' },
    ]);
    // 按动作表的定义顺序；工单的两个动作随待办 17
    expect(auditActionFilterOptions('ticket').map((option) => option.label)).toEqual([
      '越权访问被拒',
      '标记无需回复',
      '撤销标记无需回复',
    ]);
  });

  it('售后单的动作含「历史导入」（售后登记表导入命令，操作人「系统」，待办 27）', () => {
    expect(auditActionFilterOptions('aftersales').slice(0, 2)).toEqual([
      { value: 'aftersales.create', label: '新建登记' },
      { value: 'aftersales.import', label: '历史导入' },
    ]);
  });

  it('一项对应的动作；认不出的键为空', () => {
    expect(auditActionsOfFilter('export')).toEqual(['ledger.export', 'audit.export']);
    expect(auditActionsOfFilter('aftersales.complete')).toEqual(['aftersales.complete']);
    expect(auditActionsOfFilter('导出 Excel')).toEqual([]);
  });
});

describe('查看范围（PRD 10.1「查看审计日志」、10.2）', () => {
  it('客服主管、管理员看全部；坐席、售后负责人、知识库负责人只看自己的；多角色取并集', () => {
    expect(auditScope(['supervisor'])).toBe('all');
    expect(auditScope(['admin'])).toBe('all');
    for (const role of ['agent', 'aftersales_owner', 'knowledge_owner'] as const) {
      expect(auditScope([role])).toBe('own');
    }
    expect(auditScope(['agent', 'admin'])).toBe('all');
    expect(auditScope(['factory_contact'])).toBeNull();
  });
});
