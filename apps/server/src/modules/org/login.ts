import { contactAdmins, type LoginDenialReason, type Role } from '@forcome/contracts';

/**
 * 能不能进入客服系统（G12）。登录时判断，之后每次请求也判断一次——停用或角色被改掉后，已有的会话下一次请求就失效：
 * - 已停用（钉钉离职或管理员停用）；
 * - 没有分配角色；
 * - 只有「生产厂对接人」角色：第一期没有工厂工作台，不能进入（PRD 4.1、AC-P1-21）；兼有其他角色的照常进入。
 */
export function loginDenial(member: {
  readonly status: 'active' | 'disabled';
  readonly roles: readonly Role[];
}): LoginDenialReason | null {
  if (member.status === 'disabled') return 'disabled';
  if (member.roles.length === 0) return 'no_role';
  if (member.roles.every((role) => role === 'factory_contact')) return 'factory_phase1';
  return null;
}

/** 登录被拒时给成员看的说明（G12 卡片的正文，原型文案） */
export function loginDenialMessage(
  reason: LoginDenialReason,
  adminNames: readonly string[],
): string {
  switch (reason) {
    case 'no_role':
      return `你的钉钉账号还没有在本系统分配角色，请${contactAdmins(adminNames)}。`;
    case 'disabled':
      return '你的账号已停用（钉钉离职或管理员停用）。';
    case 'factory_phase1':
      return '工厂工作台第二阶段上线，目前无法进入。';
  }
}
