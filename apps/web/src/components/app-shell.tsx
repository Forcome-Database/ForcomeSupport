import type { CurrentMember } from '@forcome/contracts';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { avatarText } from '@/lib/avatar';
import { Brand } from './brand';

/**
 * 登录后的外壳（原型 app() 与 _topbar()，第一阶段：PRD 4.1）：56px 白色顶栏 + 浅灰内容区。
 * 待办 02 只有品牌标与当前成员；分段导航与默认首页、头像菜单与密度（04）、站内通知铃铛（31）
 * 按原型加在注释标出的位置。第一阶段不显示店铺范围切换与全局搜索。
 */
export function AppShell({ member, children }: { member: CurrentMember; children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-card px-4">
        <Brand />
        {/* 分段导航（PRD 4.1 第一阶段表）随 04 号待办 */}
        <div className="ml-auto flex items-center gap-2">
          {/* 密度按钮（04）、站内通知铃铛（31） */}
          <CurrentUser member={member} />
        </div>
      </header>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

function CurrentUser({ member }: { member: CurrentMember }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Avatar>
        <AvatarFallback>{avatarText(member.name)}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col leading-tight">
        <div className="text-13 font-semibold whitespace-nowrap text-foreground">{member.name}</div>
        <div className="text-11 whitespace-nowrap text-subtle-foreground">
          {member.roles.join('、')}
        </div>
      </div>
    </div>
  );
}
