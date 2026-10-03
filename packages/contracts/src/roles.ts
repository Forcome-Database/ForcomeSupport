import { z } from 'zod';

/**
 * 6 个固定角色（PRD 2.1、10.1；ADR 0010：角色固定在代码里，不能在界面自定义）。
 * 标识符用英文 snake_case（ADR 0005），界面与审计显示用中文名。顺序即 PRD 10.1 表头的顺序。
 */
export const roles = [
  'agent',
  'supervisor',
  'aftersales_owner',
  'knowledge_owner',
  'admin',
  'factory_contact',
] as const;

export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;

export const roleLabels: Record<Role, string> = {
  agent: '坐席',
  supervisor: '客服主管',
  aftersales_owner: '售后负责人',
  knowledge_owner: '知识库负责人',
  admin: '管理员',
  factory_contact: '生产厂对接人',
};

/** 按中文名找角色（示例数据夹具与测试里的角色写的是中文名）；没有这个角色返回 undefined */
export function roleByLabel(label: string): Role | undefined {
  return roles.find((role) => roleLabels[role] === label);
}

/** 多个角色的中文名，按 PRD 10.1 的顺序用「、」连接（例「坐席、知识库负责人」） */
export function roleNames(memberRoles: readonly Role[]): string {
  return roles
    .filter((role) => memberRoles.includes(role))
    .map((role) => roleLabels[role])
    .join('、');
}
