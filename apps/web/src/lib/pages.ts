import type { Capability, NavSection } from '@forcome/contracts';

/*
 * 第一期的页面（PRD 4.1 第一阶段、4.2）：路径、无权限页面 G2 里写的页面名、进入页面需要的能力（PRD 10.1）。
 * 没有能力时页面显示 G2，写明哪个角色能看；入口（顶栏导航）由后端按同一份能力矩阵算好（/api/me 的 nav）。
 */
export interface PageDefinition {
  readonly path: string;
  /** G2 里的页面名（例「「渠道与店铺」只对管理员开放」） */
  readonly label: string;
  readonly capability: Capability;
}

export const pages = {
  /** P04 工单列表（P05 工单详情随 17 号待办挂在它下面） */
  tickets: { path: '/tickets', label: '工单', capability: 'ticket.view' },
  /** P13 登记台账（第一期「售后」只有它） */
  aftersalesLedger: {
    path: '/aftersales/ledger',
    label: '登记台账',
    capability: 'aftersales.view',
  },
  /** P17 报表 */
  reports: { path: '/reports', label: '报表', capability: 'report.view' },
  /** P18 设置 · 渠道与店铺 */
  settingsChannels: {
    path: '/settings/channels',
    label: '渠道与店铺',
    capability: 'settings.channels_team',
  },
  /** P20 设置 · 团队与权限 */
  settingsTeam: {
    path: '/settings/team',
    label: '团队与权限',
    capability: 'settings.channels_team',
  },
  /** P27 审计日志（从头像菜单进入） */
  audit: { path: '/audit', label: '审计日志', capability: 'audit.view' },
} as const satisfies Record<string, PageDefinition>;

/** 导航入口与默认首页的路径：设置入口指向 /settings（进入后落到第一个设置页 P18） */
export const sectionPaths: Record<NavSection, string> = {
  tickets: pages.tickets.path,
  aftersales: pages.aftersalesLedger.path,
  reports: pages.reports.path,
  settings: '/settings',
};
