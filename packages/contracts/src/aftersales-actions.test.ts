import { describe, expect, it } from 'vitest';
import {
  aftersalesActions,
  completionLabel,
  ownsRegistration,
  type AftersalesActions,
  type AftersalesStatus,
} from './aftersales';
import type { Role } from './roles';

/*
 * 台账一张单上谁能做什么（PRD 10.1、6.5「第一阶段台账状态」，待办 21）：前端据此显示入口，后端据此强制。
 * 「○」：客服主管只能编辑、设为已完成自己登记的进行中单；售后负责人是自己登记或负责的。
 */

const ME = '0199a000-0000-7000-8000-000000000001';
const OTHER = '0199a000-0000-7000-8000-000000000002';

const viewer = (...roles: Role[]) => ({ id: ME, roles });
const row = (
  status: AftersalesStatus,
  who: { registeredById?: string | null; ownerId?: string | null } = {},
) => ({ status, registeredById: who.registeredById ?? OTHER, ownerId: who.ownerId ?? OTHER });

const NOTHING: AftersalesActions = {
  edit: false,
  complete: false,
  cancel: false,
  backfill: false,
  changeRate: false,
};

describe('台账一张单上能做的事（PRD 10.1、6.5）', () => {
  it('客服主管：自己登记的进行中单可编辑、设为已完成；进行中的单都能取消；不能补登、不能改汇率', () => {
    const supervisor = viewer('supervisor');
    expect(aftersalesActions(supervisor, row('in_progress', { registeredById: ME }))).toEqual({
      ...NOTHING,
      edit: true,
      complete: true,
      cancel: true,
    });
    expect(aftersalesActions(supervisor, row('in_progress'))).toEqual({
      ...NOTHING,
      cancel: true,
    });
    // AC-P1-19：已完成的单客服主管没有补登入口
    expect(aftersalesActions(supervisor, row('completed', { registeredById: ME }))).toEqual(
      NOTHING,
    );
  });

  it('售后负责人：自己登记或负责的进行中单可编辑、设为已完成；进行中可取消、可改汇率', () => {
    const owner = viewer('aftersales_owner');
    const full = { ...NOTHING, edit: true, complete: true, cancel: true, changeRate: true };
    expect(aftersalesActions(owner, row('in_progress', { registeredById: ME }))).toEqual(full);
    expect(aftersalesActions(owner, row('in_progress', { ownerId: ME }))).toEqual(full);
    // 别人登记、别人负责：只能取消与改汇率
    expect(aftersalesActions(owner, row('in_progress'))).toEqual({
      ...NOTHING,
      cancel: true,
      changeRate: true,
    });
  });

  it('已完成：只有售后负责人可补登与改汇率，不能再设为已完成或取消', () => {
    expect(aftersalesActions(viewer('aftersales_owner'), row('completed'))).toEqual({
      ...NOTHING,
      backfill: true,
      changeRate: true,
    });
  });

  it('已取消：只读，谁都不能再改', () => {
    for (const roles of [['supervisor'], ['aftersales_owner']] as Role[][]) {
      expect(
        aftersalesActions(viewer(...roles), row('cancelled', { registeredById: ME, ownerId: ME })),
      ).toEqual(NOTHING);
    }
  });

  it('坐席、知识库负责人、管理员：只读', () => {
    for (const role of ['agent', 'knowledge_owner', 'admin'] as const) {
      expect(
        aftersalesActions(viewer(role), row('in_progress', { registeredById: ME, ownerId: ME })),
      ).toEqual(NOTHING);
    }
  });

  it('多角色取并集：兼客服主管与售后负责人，负责的进行中单可编辑（售后负责人的「○」）', () => {
    expect(
      aftersalesActions(
        viewer('supervisor', 'aftersales_owner'),
        row('in_progress', { ownerId: ME }),
      ),
    ).toEqual({ ...NOTHING, edit: true, complete: true, cancel: true, changeRate: true });
  });
});

describe('这张单算不算查看者的（10.1「○」，设为已完成的撤销也按它，与状态无关）', () => {
  it('客服主管：自己登记的；售后负责人：自己登记或负责的；坐席都不算', () => {
    const mine = { registeredById: ME, ownerId: OTHER };
    const owned = { registeredById: OTHER, ownerId: ME };
    expect(ownsRegistration(viewer('supervisor'), mine)).toBe(true);
    expect(ownsRegistration(viewer('supervisor'), owned)).toBe(false);
    expect(ownsRegistration(viewer('aftersales_owner'), owned)).toBe(true);
    expect(ownsRegistration(viewer('agent'), mine)).toBe(false);
  });
});

describe('页头登记完整率的写法（R-AS-08；原型 build_ledger.completion）', () => {
  it('一位小数，整数时不写「.0」；当月没有已完成的单为 null（界面写「—」）', () => {
    expect(completionLabel({ month: '2026-09', completed: 8, complete: 7 })).toBe('87.5%');
    expect(completionLabel({ month: '2026-09', completed: 10, complete: 9 })).toBe('90%');
    expect(completionLabel({ month: '2026-09', completed: 9, complete: 7 })).toBe('77.8%');
    expect(completionLabel({ month: '2026-09', completed: 8, complete: 8 })).toBe('100%');
    expect(completionLabel({ month: '2026-10', completed: 0, complete: 0 })).toBeNull();
  });
});
