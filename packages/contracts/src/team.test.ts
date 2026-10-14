import { describe, expect, it } from 'vitest';
import {
  activeAdminCount,
  disableBlockedReason,
  disableMessages,
  handoverError,
  handoverPlan,
  handoverStale,
  isTeamMember,
  lastLoginWords,
  orderedRoles,
  sameRoles,
  sameStoreScope,
  storeScopeWords,
  syncedAtWords,
  teamAccessErrors,
  teamMessages,
  teamRoles,
} from './team';

/* P20 团队与权限的共用规则与写法（PRD P20「第一阶段」，待办 06） */

const FD = '0199a0a0-0000-7000-8000-000000000001';
const FC = '0199a0a0-0000-7000-8000-000000000002';
const names = new Map([
  [FD, 'Forcome Direct'],
  [FC, 'forcome.com'],
]);
const now = new Date('2026-09-11T10:20:00+08:00');

describe('P20 可分配的角色', () => {
  it('五个客服系统的角色，按 PRD 10.1 的顺序；没有生产厂对接人（P20「第一阶段」，生产厂成员随 P24）', () => {
    expect(teamRoles).toEqual([
      'agent',
      'supervisor',
      'aftersales_owner',
      'knowledge_owner',
      'admin',
    ]);
  });

  it('成员表只列至少有一个客服系统角色的成员：没有角色的待添加，只有生产厂对接人的不列', () => {
    expect(isTeamMember(['agent'])).toBe(true);
    expect(isTeamMember(['factory_contact', 'supervisor'])).toBe(true);
    expect(isTeamMember(['factory_contact'])).toBe(false);
    expect(isTeamMember([])).toBe(false);
  });
});

describe('角色与店铺范围的比较（勾选先后不算区别）', () => {
  it('角色按 PRD 10.1 的顺序排；两组角色相同不看先后', () => {
    expect(orderedRoles(['admin', 'agent', 'factory_contact'])).toEqual([
      'agent',
      'admin',
      'factory_contact',
    ]);
    expect(sameRoles(['admin', 'agent'], ['agent', 'admin'])).toBe(true);
    expect(sameRoles(['agent'], ['agent', 'admin'])).toBe(false);
  });

  it('店铺范围：全部店铺与指定店铺不同；指定的店铺相同不看先后', () => {
    expect(sameStoreScope({ all: true }, { all: true })).toBe(true);
    expect(sameStoreScope({ all: true }, { all: false, storeIds: [FD, FC] })).toBe(false);
    expect(
      sameStoreScope({ all: false, storeIds: [FD, FC] }, { all: false, storeIds: [FC, FD] }),
    ).toBe(true);
    expect(sameStoreScope({ all: false, storeIds: [FD] }, { all: false, storeIds: [FC] })).toBe(
      false,
    );
  });
});

describe('角色与数据范围的校验（添加成员必填，修改时同样要有）', () => {
  const known = [FD, FC];

  it('角色与数据范围都填了：没有错误', () => {
    expect(teamAccessErrors({ roles: ['agent'], stores: { all: true } }, known)).toEqual({});
    expect(
      teamAccessErrors(
        { roles: ['agent', 'admin'], stores: { all: false, storeIds: [FD] } },
        known,
      ),
    ).toEqual({});
  });

  it('不填角色、不选数据范围：两处都报错', () => {
    expect(teamAccessErrors({ roles: [], stores: null }, known)).toEqual({
      roles: teamMessages.rolesRequired,
      stores: teamMessages.scopeRequired,
    });
  });

  it('选了「指定店铺」却没勾店铺：请至少选择一个店铺', () => {
    expect(
      teamAccessErrors({ roles: ['agent'], stores: { all: false, storeIds: [] } }, known),
    ).toEqual({ stores: teamMessages.storesRequired });
  });

  it('第一期不能分配生产厂对接人', () => {
    expect(
      teamAccessErrors({ roles: ['agent', 'factory_contact'], stores: { all: true } }, known),
    ).toEqual({ roles: teamMessages.factoryRole });
  });

  it('勾了不存在的店铺：报错，不保存', () => {
    expect(
      teamAccessErrors(
        {
          roles: ['agent'],
          stores: { all: false, storeIds: [FD, '0199a0a0-0000-7000-8000-00000000ffff'] },
        },
        known,
      ),
    ).toEqual({ stores: teamMessages.unknownStore });
  });
});

describe('写法', () => {
  it('数据范围：全部店铺；指定店铺写店铺名，用「、」连接；没有范围写「—」', () => {
    expect(storeScopeWords({ all: true }, names)).toBe('全部店铺');
    expect(storeScopeWords({ all: false, storeIds: [FD, FC] }, names)).toBe(
      'Forcome Direct、forcome.com',
    );
    expect(storeScopeWords({ all: false, storeIds: [] }, names)).toBe('—');
    // 店铺名查不到时写原值，不吞掉
    expect(storeScopeWords({ all: false, storeIds: ['x'] }, names)).toBe('x');
  });

  it('最近登录：当天写时:分，之前写月-日 时:分，不在今年写全年份，没登录过写「—」（同 P27、G10）', () => {
    expect(lastLoginWords('2026-09-11T08:02:00+08:00', now)).toBe('08:02');
    expect(lastLoginWords('2026-09-10T18:30:00+08:00', now)).toBe('09-10 18:30');
    expect(lastLoginWords('2025-12-31T09:00:00+08:00', now)).toBe('2025-12-31 09:00');
    expect(lastLoginWords(null, now)).toBe('—');
  });

  it('成员表头的同步时间：同上，从没对账成功过写「尚未同步」', () => {
    expect(syncedAtWords('2026-09-11T10:00:00+08:00', now)).toBe('10:00 同步');
    expect(syncedAtWords('2026-09-10T23:00:00+08:00', now)).toBe('09-10 23:00 同步');
    expect(syncedAtWords(null, now)).toBe('尚未同步');
  });
});

describe('停用弹窗的接手人（K10 第一阶段，待办 23，协调者 2026-10-14 决定 Q1、Q3）', () => {
  const AUTO = '0199a0a0-0000-7000-8000-00000000000a';
  const member = { id: FD, name: '王磊', version: 1, aftersalesOwner: true };
  const one = (id: string, storeId: string, storeName: string) => ({
    id,
    number: `S-${id.slice(-4)}`,
    status: 'in_progress' as const,
    store: { id: storeId, name: storeName },
    version: 0,
  });
  const C1 = '0199a0a0-0000-7000-8000-0000000000c1';
  const C2 = '0199a0a0-0000-7000-8000-0000000000c2';
  const cases = [one(C1, AUTO, 'Forcome Auto'), one(C2, FD, 'Forcome Direct')];
  const all = { id: 'o-all', name: '赵倩', stores: { all: true as const } };
  const autoOnly = {
    id: 'o-auto',
    name: '陈晨',
    stores: { all: false as const, storeIds: [AUTO] },
  };
  const directOnly = { id: 'o-fd', name: '周敏', stores: { all: false as const, storeIds: [FD] } };

  it('没有进行中售后单：不用选接手人', () => {
    expect(handoverPlan({ member, cases: [], owners: [] })).toEqual({ kind: 'none' });
    expect(handoverError({ member, cases: [], owners: [] }, [])).toBeNull();
  });

  it('一个下拉，只列店铺范围覆盖全部店铺的售后负责人', () => {
    const plan = handoverPlan({ member, cases, owners: [all, autoOnly] });
    expect(plan).toEqual({
      kind: 'choose',
      groups: [{ store: null, caseIds: [C1, C2], candidates: [all] }],
    });
  });

  it('没有一人覆盖全部店铺、但每个店铺各有人可接：按店铺各一个下拉', () => {
    const plan = handoverPlan({ member, cases, owners: [autoOnly, directOnly] });
    expect(
      plan.kind === 'choose' &&
        plan.groups.map((g) => [g.store?.name, g.candidates.map((c) => c.name)]),
    ).toEqual([
      ['Forcome Auto', ['陈晨']],
      ['Forcome Direct', ['周敏']],
    ]);
  });

  it('不可用：没有其他售后负责人；被停用的人不是售后负责人；缺店铺范围', () => {
    expect(handoverPlan({ member, cases, owners: [] })).toEqual({
      kind: 'blocked',
      reason: '王磊是唯一的售后负责人，没有其他人可接手',
      fix: '请先在成员表为其他成员分配售后负责人角色',
    });
    expect(
      handoverPlan({ member: { ...member, aftersalesOwner: false }, cases, owners: [] }),
    ).toMatchObject({ reason: '没有在职的售后负责人可接手' });
    expect(handoverPlan({ member, cases, owners: [directOnly] })).toEqual({
      kind: 'blocked',
      reason: '其他售后负责人都没有 Forcome Auto 的数据范围',
      fix: '请先在成员表为其他售后负责人加上该店铺的数据范围',
    });
  });

  it('校验：每张都要选、选的人要有该单店铺的范围', () => {
    const handover = { member, cases, owners: [autoOnly, directOnly] };
    expect(handoverError(handover, [{ caseId: C1, version: 0, ownerId: 'o-auto' }])).toBe(
      disableMessages.ownerRequired,
    );
    expect(
      handoverError(handover, [
        { caseId: C1, version: 0, ownerId: 'o-auto' },
        { caseId: C2, version: 0, ownerId: 'o-auto' },
      ]),
    ).toBe(disableMessages.ownerNotEligible);
    expect(
      handoverError(handover, [
        { caseId: C1, version: 0, ownerId: 'o-auto' },
        { caseId: C2, version: 0, ownerId: 'o-fd' },
      ]),
    ).toBeNull();
    expect(handoverError({ member, cases, owners: [] }, [])).toBe(
      '王磊是唯一的售后负责人，没有其他人可接手',
    );
  });

  it('弹窗里列的单与现在的不一样（被改过、少了、多了）：handoverStale', () => {
    const now = [
      { id: C1, version: 2 },
      { id: C2, version: 0 },
    ];
    const sent = [
      { caseId: C1, version: 2 },
      { caseId: C2, version: 0 },
    ];
    expect(handoverStale(now, sent)).toBe(false);
    expect(handoverStale(now, [{ ...sent[0]!, version: 1 }, sent[1]!])).toBe(true);
    expect(handoverStale(now, [sent[0]!])).toBe(true);
    expect(handoverStale([now[0]!], sent)).toBe(true);
    expect(handoverStale([], [])).toBe(false);
  });

  it('在职管理员的人数', () => {
    expect(
      activeAdminCount([
        { status: 'active', roles: ['admin'] },
        { status: 'disabled', roles: ['admin'] },
        { status: 'active', roles: ['agent'] },
      ]),
    ).toBe(1);
  });

  it('行尾「停用」不可用的原因：已停用、自己、最后一位在职管理员', () => {
    const someone = { id: FC, status: 'active' as const, roles: ['agent' as const] };
    expect(disableBlockedReason(someone, FD, 1)).toBeNull();
    expect(disableBlockedReason({ ...someone, status: 'disabled' }, FD, 1)).toBe('这位成员已停用');
    expect(disableBlockedReason(someone, FC, 2)).toBe('不能停用自己');
    expect(disableBlockedReason({ ...someone, roles: ['admin'] }, FD, 1)).toBe(
      '至少要有一位在职的管理员',
    );
    expect(disableBlockedReason({ ...someone, roles: ['admin'] }, FD, 2)).toBeNull();
  });
});
