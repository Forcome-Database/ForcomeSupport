import { Link } from '@tanstack/react-router';
import { Store, Users, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { pages, type PageDefinition } from '@/lib/pages';
import { MENU_NOTE } from './p18-copy';

/*
 * 设置页外壳（原型 build_settings.spage() 与 as_common.settings_menu()，第一阶段：PRD 4.1、P18）：
 * 左侧设置菜单（宽 208 的白色浮动面板），每项一个独立页面，点击即切换（导航语义，用链接，同顶栏分段导航，ADR 0007 修订）；
 * 第一阶段只有「渠道与店铺」「团队与权限」两项，菜单底部注「第一阶段只开放这两项设置」。两项都归管理员，第一期不出现带锁的项。
 * 右侧内容区：页头（标题、说明与右侧操作）+ 页面内容，内边距 16 / 24、区块间距 16，超出时滚动。
 */

const MENU: readonly { page: PageDefinition & { path: string }; icon: LucideIcon }[] = [
  { page: pages.settingsChannels, icon: Store },
  { page: pages.settingsTeam, icon: Users },
];

export function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label="设置"
        className="mt-2.5 mb-3 ml-3.5 flex w-52 shrink-0 flex-col gap-0.5 overflow-hidden rounded-xl border bg-card px-2.5 py-3.5 shadow-xs"
      >
        <div className="px-2.5 pb-2.5 text-16 font-bold text-foreground">设置</div>
        {MENU.map(({ page, icon: Icon }) => (
          <Link
            key={page.path}
            to={page.path}
            className="group flex h-8.5 items-center gap-2.25 rounded-sm px-2.5 text-13 font-medium whitespace-nowrap text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-ring data-[status=active]:bg-primary-soft data-[status=active]:font-bold data-[status=active]:text-primary-text"
          >
            <Icon className="size-4 text-muted-foreground group-data-[status=active]:text-primary" />
            {page.label}
          </Link>
        ))}
        <div className="mt-auto border-t p-2.5 text-11 leading-normal text-subtle-foreground">
          {MENU_NOTE}
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">{children}</div>
    </div>
  );
}

/** 设置页的页头：20 / 700 标题（字距 -0.01em）、13 次要色说明，右侧操作与说明底边对齐 */
export function SettingsHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-20 font-bold tracking-[-0.01em] text-foreground">{title}</h1>
        <p className="text-13 leading-normal text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
