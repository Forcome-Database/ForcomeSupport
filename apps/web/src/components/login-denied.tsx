import { roleNames, type DevMember, type LoginDenialReason } from '@forcome/contracts';
import { Factory, Lock, User, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { avatarText } from '@/lib/avatar';
import { EmptyState } from './empty-state';

const DENIALS: Record<LoginDenialReason, { icon: LucideIcon; title: string }> = {
  no_role: { icon: User, title: '还没有分配角色' },
  disabled: { icon: Lock, title: '账号已停用' },
  factory_phase1: { icon: Factory, title: '暂时无法进入' },
};

/**
 * 登录被拒（G12，原型 deny()）：放在登录卡片里，图标、标题与后端给的说明；
 * 第一期的生产厂对接人另在上方写明是谁（头像 + 姓名 · 部门 · 角色）。开发登录页与钉钉扫码登录页（05）共用。
 */
export function LoginDenied({
  reason,
  message,
  member,
  action,
}: {
  reason: LoginDenialReason;
  message: string;
  member?: Pick<DevMember, 'name' | 'dept' | 'roles'>;
  action?: ReactNode;
}) {
  const { icon, title } = DENIALS[reason];
  return (
    <>
      {reason === 'factory_phase1' && member && (
        <div className="flex items-center gap-2">
          <Avatar size="sm" tone="amber">
            <AvatarFallback>{avatarText(member.name)}</AvatarFallback>
          </Avatar>
          <span className="text-12 whitespace-nowrap text-muted-foreground">
            {member.name} · {member.dept} · {roleNames(member.roles)}
          </span>
        </div>
      )}
      <EmptyState icon={icon} title={title} description={message} action={action} compact />
    </>
  );
}
