import { describe, expect, it } from 'vitest';
import {
  isTeamMember,
  lastLoginWords,
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
