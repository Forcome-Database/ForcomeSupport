import {
  loginDenialTitles,
  roleNames,
  type DevMember,
  type LoginDenialReason,
} from '@forcome/contracts';
import { Factory, Lock, User, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { avatarText } from '@/lib/avatar';
import { EmptyState } from './empty-state';

/** 各种被拒画面的图标（原型 deny() 的 user、lock、factory）；标题与说明的文案在 contracts */
const ICONS: Record<LoginDenialReason, LucideIcon> = {
  no_role: User,
  disabled: Lock,
  factory_phase1: Factory,
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
      <EmptyState
        icon={ICONS[reason]}
        title={loginDenialTitles[reason]}
        description={message}
        action={action}
        compact
      />
    </>
  );
}
