import { roles, type Role } from '@forcome/contracts';
import type { AvatarTone } from '@/components/ui/avatar';

/** 名字以这些称谓结尾时（陈工、刘厂长），原型的头像取姓 */
const TITLES = ['厂长', '工'];

/**
 * 头像里的字（原型 data.py 的 STAFF.avatar）：一般取名字的最后一个字（李婷 → 婷），
 * 以称谓结尾的取第一个字（陈工 → 陈）。
 */
export function avatarText(name: string): string {
  const chars = [...name.trim()];
  const titled = TITLES.some((t) => name.endsWith(t) && chars.length > t.length);
  return (titled ? chars[0] : chars.at(-1)) ?? '';
}

/** 成员头像按角色的色调（原型 AV_TONE：坐席绿、客服主管渐变、售后负责人黄、知识库负责人紫、管理员灰；P20 成员表与 P27 操作人共用） */
const ROLE_TONES: Record<Role, AvatarTone> = {
  agent: 'green',
  supervisor: 'member',
  aftersales_owner: 'amber',
  knowledge_owner: 'violet',
  admin: 'grey',
  factory_contact: 'amber',
};

/** 多角色按 PRD 10.1 的顺序取第一个角色的色调；没有角色为灰 */
export function roleAvatarTone(memberRoles: readonly string[]): AvatarTone {
  const role = roles.find((r) => memberRoles.includes(r));
  return role ? ROLE_TONES[role] : 'grey';
}
