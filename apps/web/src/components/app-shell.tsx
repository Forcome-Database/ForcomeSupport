import {
  densities,
  densityLabels,
  navSections,
  roleNames,
  type CurrentMember,
  type Density,
} from '@forcome/contracts';
import { Link } from '@tanstack/react-router';
import { ArrowRight, History, Menu } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { avatarText } from '@/lib/avatar';
import { pages, sectionPaths } from '@/lib/pages';
import { useLogout, useSaveDensity } from '@/lib/session';
import { Brand } from './brand';

/**
 * 登录后的外壳（原型 app() 与 _topbar()，第一阶段：PRD 4.1）：56px 白色顶栏 + 浅灰内容区。
 * 顶栏：品牌标 · 分段导航（按角色，/api/me 的 nav）· 右侧密度按钮、站内通知铃铛（31 号待办）、当前成员（头像菜单）。
 * 第一阶段不显示店铺范围切换、全局搜索与导航角标。
 */
export function AppShell({ member, children }: { member: CurrentMember; children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-card px-4">
        <Brand />
        <SegmentedNav member={member} />
        <div className="ml-auto flex items-center gap-2">
          <DensityButton density={member.density} />
          {/* 站内通知铃铛（G10）随 31 号待办加在这里 */}
          <UserMenu member={member} />
        </div>
      </header>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

/** 分段导航（原型 _segnav）：浅灰轨道，当前项白底、描边、主色字 */
function SegmentedNav({ member }: { member: CurrentMember }) {
  const items = navSections.filter((section) => member.nav.includes(section.key));
  return (
    <nav
      aria-label="导航"
      className="flex shrink-0 items-center gap-0.5 rounded-md bg-secondary p-0.75"
    >
      {items.map((section) => (
        <Link
          key={section.key}
          to={sectionPaths[section.key]}
          // 当前项由 Link 标上 data-status="active" 与 aria-current="page"（地址以该入口的路径开头即算当前）
          className="rounded-md px-3 py-1.25 text-13 font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[status=active]:border data-[status=active]:border-border data-[status=active]:bg-card data-[status=active]:py-1 data-[status=active]:font-semibold data-[status=active]:text-primary-text data-[status=active]:shadow-xs"
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}

function nextDensity(density: Density): Density {
  return densities[(densities.indexOf(density) + 1) % densities.length] ?? 'comfortable';
}

/** 顶栏「密度」按钮（G9，图标三条横线）：在舒适与紧凑之间切换，按成员保存在服务端 */
function DensityButton({ density }: { density: Density }) {
  const save = useSaveDensity();
  const next = nextDensity(density);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`密度：${densityLabels[density]}，切换为${densityLabels[next]}`}
      onClick={() => save.mutate(next)}
    >
      <Menu />
    </Button>
  );
}

/** 当前成员与头像菜单（原型 avatar_menu，设计规范「头像菜单（G10）」）：审计日志 · 密度 · 退出登录 */
function UserMenu({ member }: { member: CurrentMember }) {
  const saveDensity = useSaveDensity();
  const logout = useLogout();
  const roles = roleNames(member.roles);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex shrink-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar>
            <AvatarFallback>{avatarText(member.name)}</AvatarFallback>
          </Avatar>
          <span className="flex flex-col leading-tight">
            <span className="text-13 font-semibold whitespace-nowrap text-foreground">
              {member.name}
            </span>
            <span className="text-11 whitespace-nowrap text-subtle-foreground">{roles}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      {/* 原型：菜单顶边在顶栏下方 6px（top 62）、右边距视口 12px */}
      <DropdownMenuContent className="w-62" sideOffset={19} alignOffset={-4}>
        <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2.5">
          <Avatar size="lg">
            <AvatarFallback>{avatarText(member.name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-px">
            <div className="text-13 font-semibold whitespace-nowrap text-foreground">
              {member.name}
            </div>
            <div className="truncate text-11 text-subtle-foreground">
              {roles} · {member.dept}
            </div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={pages.audit.path}>
            <History />
            审计日志
            <DropdownMenuHint>所有角色可见</DropdownMenuHint>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Menu />
            密度
            <DropdownMenuHint>{densityLabels[member.density]} ›</DropdownMenuHint>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={member.density}
              onValueChange={(value) => saveDensity.mutate(value as Density)}
            >
              {densities.map((density) => (
                <DropdownMenuRadioItem key={density} value={density}>
                  {densityLabels[density]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()}>
          <ArrowRight />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
