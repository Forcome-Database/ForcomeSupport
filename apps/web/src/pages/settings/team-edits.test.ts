import type { TeamMember } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  cellErrorsOf,
  changedCellCount,
  changeLines,
  conflictsOf,
  editsAfterReload,
  firstErrorCell,
  teamChangesOf,
  type TeamEdits,
} from './team-edits';

/* P20 吸底保存栏的待保存修改（K6）：哪些格改了、保存栏与浮层的摘要、提交的内容、接口报错落到哪一格、冲突（G7） */

const FD = '0199a0a0-0000-7000-8000-000000000001';
const FC = '0199a0a0-0000-7000-8000-000000000002';
const names = new Map([
  [FD, 'Forcome Direct'],
  [FC, 'forcome.com'],
]);

function member(overrides: Partial<TeamMember> & Pick<TeamMember, 'id' | 'name'>): TeamMember {
  return {
    email: null,
    dept: 'FSH / 客服部',
    roles: ['agent'],
    stores: { all: true },
    status: 'active',
    lastLoginAt: null,
    version: 1,
    changedBy: null,
    changedAt: null,
    ...overrides,
  };
}

const zhaoqian = member({
  id: 'zq',
  name: '赵倩',
  roles: ['knowledge_owner'],
  stores: { all: false, storeIds: [FD] },
});
const liting = member({ id: 'lt', name: '李婷' });
const none: TeamEdits = new Map();

describe('改了哪些格', () => {
  it('改成与原来不同才算修改；改回原来的值就不算了', () => {
    const edited = applyEdit(none, zhaoqian, { stores: { all: true } });
    expect(changedCellCount(edited)).toBe(1);
    expect(edited.get('zq')).toMatchObject({ roles: ['knowledge_owner'], stores: { all: true } });

    const back = applyEdit(edited, zhaoqian, { stores: { all: false, storeIds: [FD] } });
    expect(back.size).toBe(0);
  });

  it('一个人的角色与数据范围都改了算两项；角色按 PRD 10.1 的顺序比较，勾选先后不算修改', () => {
    let edits = applyEdit(none, zhaoqian, { roles: ['knowledge_owner', 'agent'] });
    edits = applyEdit(edits, zhaoqian, { stores: { all: true } });
    edits = applyEdit(edits, liting, { roles: ['agent'] });
    expect(changedCellCount(edits)).toBe(2);
    expect(edits.get('zq')?.roles).toEqual(['agent', 'knowledge_owner']);
  });

  it('修改依据打开时的那一版：保存时带它的版本号，提交改后的角色与数据范围', () => {
    const edits = applyEdit(none, zhaoqian, { stores: { all: false, storeIds: [FD, FC] } });
    const later = { ...zhaoqian, version: 5 };
    // 之后再改同一人，仍以第一次修改时的那一版为准（期间被别人改过的要在保存时报冲突，不能悄悄覆盖）
    const again = applyEdit(edits, later, { roles: ['agent', 'knowledge_owner'] });
    expect(teamChangesOf(again)).toEqual([
      {
        id: 'zq',
        version: 1,
        roles: ['agent', 'knowledge_owner'],
        stores: { all: false, storeIds: [FD, FC] },
      },
    ]);
  });
});

describe('摘要（吸底保存栏与保存成功浮层；2026-10-06 用户确认的写法）', () => {
  it('每一项写「成员 字段：前 → 后」，字段名同 P27（角色、店铺范围）', () => {
    let edits = applyEdit(none, zhaoqian, { stores: { all: true } });
    edits = applyEdit(edits, liting, { roles: ['agent', 'supervisor'] });
    expect(changeLines(edits, names)).toEqual([
      '赵倩 店铺范围：Forcome Direct → 全部店铺',
      '李婷 角色：坐席 → 坐席、客服主管',
    ]);
  });

  it('「指定店铺」还没勾店铺时后值写「—」', () => {
    const edits = applyEdit(none, liting, { stores: { all: false, storeIds: [] } });
    expect(changeLines(edits, names)).toEqual(['李婷 店铺范围：全部店铺 → —']);
  });
});

describe('接口的报错落到格子（键「成员 ID.roles / .stores」）', () => {
  it('按成员与列分开；第一个出错的格按成员表的先后取', () => {
    const errors = cellErrorsOf({
      'zq.stores': '请至少选择一个店铺',
      'lt.roles': '请至少选择一个角色',
      other: '忽略不认识的键',
    });
    expect(errors.get('zq')).toEqual({ stores: '请至少选择一个店铺' });
    expect(errors.get('lt')).toEqual({ roles: '请至少选择一个角色' });
    expect(firstErrorCell(errors, ['lt', 'zq'])).toEqual({ memberId: 'lt', column: 'roles' });
    expect(firstErrorCell(new Map(), ['lt'])).toBeNull();
  });
});

describe('并发（G7）', () => {
  it('依据的版本与最新的不同：谁、几点改的、改了哪些列；成员已不在表里的也算冲突', () => {
    let edits = applyEdit(none, zhaoqian, { stores: { all: true } });
    edits = applyEdit(edits, liting, { roles: ['agent', 'supervisor'] });
    const latest = [
      {
        ...zhaoqian,
        version: 2,
        roles: ['agent', 'knowledge_owner'] as TeamMember['roles'],
        changedBy: '周敏',
        changedAt: '2026-09-11T02:24:00.000Z',
      },
      liting,
    ];
    expect(conflictsOf(edits, latest)).toEqual([
      {
        id: 'zq',
        name: '赵倩',
        latest: latest[0],
        who: '周敏',
        at: '2026-09-11T02:24:00.000Z',
        fields: ['角色'],
      },
    ]);
    expect(conflictsOf(edits, [liting])).toEqual([
      { id: 'zq', name: '赵倩', latest: null, who: null, at: null, fields: [] },
    ]);
  });

  it('「查看最新」：冲突的人放弃修改换成最新的；其他人的修改留着，改得和最新一样的不再算修改', () => {
    let edits = applyEdit(none, zhaoqian, { stores: { all: true } });
    edits = applyEdit(edits, liting, { roles: ['agent', 'supervisor'] });
    const latest = [
      { ...zhaoqian, version: 2 },
      { ...liting, version: 1 },
    ];
    const next = editsAfterReload(edits, latest);
    expect([...next.keys()]).toEqual(['lt']);
    expect(next.get('lt')?.base.version).toBe(1);
  });
});
