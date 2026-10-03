import type { LoginDenialReason, MemberStatus, Role } from '@forcome/contracts';

/**
 * 能不能进入客服系统（G12）。登录时判断，之后每次请求也判断一次——停用或角色被改掉后，已有的会话下一次请求就失效：
 * - 已停用（钉钉离职或管理员停用）；
 * - 没有分配角色；
 * - 只有「生产厂对接人」角色：第一期没有工厂工作台，不能进入（PRD 4.1、AC-P1-21）；兼有其他角色的照常进入。
 * 被拒画面的标题与说明在 contracts（loginDenialTitles、loginDenialMessage）。
 */
export function loginDenial(member: {
  readonly status: MemberStatus;
  readonly roles: readonly Role[];
}): LoginDenialReason | null {
  if (member.status === 'disabled') return 'disabled';
  if (member.roles.length === 0) return 'no_role';
  if (member.roles.every((role) => role === 'factory_contact')) return 'factory_phase1';
  return null;
}
