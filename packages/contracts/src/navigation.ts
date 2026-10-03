import { z } from 'zod';
import { can, type Capability } from './capabilities';
import type { Role } from './roles';

/*
 * 顶栏分段导航与默认首页（PRD 4.1）。入口按能力显示：有其中任一能力才出现，没有权限的入口不出现；
 * 多角色导航取并集。第一阶段只有工单、售后（只有 P13 登记台账）、报表、设置（只有 P18、P20）四个入口，
 * 收件箱、审批、知识库随第二、三阶段加在这里。
 */

export const navSections = [
  { key: 'tickets', label: '工单', capabilities: ['ticket.view'] },
  { key: 'aftersales', label: '售后', capabilities: ['aftersales.view'] },
  { key: 'reports', label: '报表', capabilities: ['report.view'] },
  {
    key: 'settings',
    label: '设置',
    capabilities: [
      'settings.channels_team',
      'settings.supervisor',
      'settings.processing_rules',
      'settings.admin_phase2',
    ],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  capabilities: readonly Capability[];
}[];

export type NavSection = (typeof navSections)[number]['key'];
export const navSectionSchema = z.enum(
  navSections.map((s) => s.key) as [NavSection, ...NavSection[]],
);

/** 这些角色能看到的导航入口，按顶栏顺序 */
export function navFor(memberRoles: readonly Role[]): NavSection[] {
  return navSections
    .filter((section) =>
      section.capabilities.some((capability: Capability) => can(memberRoles, capability)),
    )
    .map((section) => section.key);
}

/** 默认首页的优先顺序（PRD 4.1 第一阶段表：坐席、客服主管 P04，售后负责人 P13，知识库负责人、管理员 P17） */
const HOME_BY_ROLE: readonly (readonly [readonly Role[], NavSection])[] = [
  [['agent', 'supervisor'], 'tickets'],
  [['aftersales_owner'], 'aftersales'],
  [['knowledge_owner', 'admin'], 'reports'],
];

/**
 * 登录后的默认首页（「返回首页」也回到这里）：按「坐席 / 客服主管 → 售后负责人 → 知识库负责人 / 管理员」取第一个；
 * 只有生产厂对接人（第一期不能进入）或没有角色时为 null。
 */
export function homeFor(memberRoles: readonly Role[]): NavSection | null {
  const found = HOME_BY_ROLE.find(([candidates]) =>
    candidates.some((role) => memberRoles.includes(role)),
  );
  return found ? found[1] : null;
}
