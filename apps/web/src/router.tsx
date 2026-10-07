import type { CurrentMember } from '@forcome/contracts';
import { useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { Toaster, UndoToaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LoadError } from '@/components/load-error';
import { CurrentMemberContext, useCurrentMember } from '@/lib/current-member';
import {
  canOpenPage,
  pages,
  sectionPaths,
  ticketDetailPath,
  type PageDefinition,
} from '@/lib/pages';
import {
  applyDensity,
  currentMemberQuery,
  devMembersQuery,
  LOGOUT_PATH,
  signedOutTarget,
  takeSessionExpired,
} from '@/lib/session';
import { LedgerPage } from '@/pages/aftersales/ledger-page';
import { ledgerSearchSchema } from '@/pages/aftersales/ledger-search';
import { AuditPage } from '@/pages/audit/audit-page';
import { auditSearchSchema } from '@/pages/audit/audit-search';
import { DevLoginPage } from '@/pages/dev-login';
import { LogoutPage } from '@/pages/logout';
import { LoginCallbackPage } from '@/pages/login/login-callback';
import { LoginPage, loginSearchSchema } from '@/pages/login/login-page';
import { ChannelsPage, channelsSearchSchema } from '@/pages/settings/channels-page';
import { TeamPage, teamSearchSchema } from '@/pages/settings/team-page';
import { TicketDetailPage } from '@/pages/tickets/ticket-detail-page';
import { TicketsPage, ticketsSearchSchema } from '@/pages/tickets/tickets-page';

/*
 * 路由（ADR 0007：TanStack Router，代码定义）。登录后的页面都挂在 app 布局下：
 * 没登录（含会话 7 天无操作过期）时，开启了开发登录（非生产环境）就去开发登录页，否则去钉钉扫码登录页（G11，/login；
 * 过期的先显示 G12「已退出登录」）；扫码确认后钉钉把浏览器带到 /login/dingtalk 换会话（待办 05）。
 * 「/」按角色进入默认首页（PRD 4.1）；各页面按能力把关，没有权限时在原地址显示 G2。
 * 第一期各页面的内容随各自的待办加进来（P17 24），在那之前内容区为空；P27 已有（30）、P20 已有（06）、P05 已有（17）；
 * P18 已有（07），P04 先是最简列表（08，完整版随 18），P13 已是第一期完整版（19–22）。
 */

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  // 浮层提示（G5）的容器与悬停说明的 Provider 挂在根上，登录页与外壳里的页面都能用
  component: () => (
    <TooltipProvider>
      <Outlet />
      <Toaster />
      <UndoToaster />
    </TooltipProvider>
  ),
  errorComponent: ({ reset }) => (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <LoadError onRetry={reset} />
    </div>
  ),
});

const devLoginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev-login',
  beforeLoad: async ({ context }) => {
    const members = await context.queryClient.ensureQueryData(devMembersQuery);
    if (!members) throw redirect({ to: '/' });
  },
  component: DevLoginPage,
});

/** 钉钉扫码登录（G11）与会话过期（G12「已退出登录」）；已登录时回到默认首页 */
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: loginSearchSchema,
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(currentMemberQuery)) throw redirect({ to: '/' });
  },
  component: function LoginRouteComponent() {
    const { expired } = loginRoute.useSearch();
    return <LoginPage expired={expired === true} />;
  },
});

/** 扫码确认后钉钉带回的地址（钉钉开放平台「重定向 URL」）：用授权码换会话 */
const loginCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login/dingtalk',
  component: LoginCallbackPage,
});

/** 退出登录（头像菜单）：先导航到这里（离开原页面先过 G8），到了才结束会话；不在 app 布局下，原页面随之卸载 */
const logoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LOGOUT_PATH,
  component: LogoutPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context }) => {
    const member = await context.queryClient.ensureQueryData(currentMemberQuery);
    if (!member) {
      const devLogin = Boolean(await context.queryClient.ensureQueryData(devMembersQuery));
      throw redirect(signedOutTarget(devLogin, takeSessionExpired()));
    }
    // 先落密度再渲染外壳，刷新时不会先闪一下舒适档
    applyDensity(member?.density ?? null);
    return { member };
  },
  component: AppLayout,
});

function AppLayout() {
  // 读缓存而不是路由上下文：切换密度后缓存里的成员会先变（useSaveDensity），会话结束时会被置空（createQueryClient）
  const { data: member } = useSuspenseQuery(currentMemberQuery);
  if (!member) return <SignedOut />;
  return (
    <CurrentMemberContext value={member}>
      <SignedIn member={member} />
    </CurrentMemberContext>
  );
}

/** 会话在使用中结束（过期、被停用、退出）：回到登录入口（开发登录页，或钉钉扫码登录页；7 天未操作过期的先显示「已退出登录」） */
function SignedOut() {
  const { data: devMembers } = useSuspenseQuery(devMembersQuery);
  const [target] = useState(() => signedOutTarget(Boolean(devMembers), takeSessionExpired()));
  useEffect(() => applyDensity(null), []);
  return <Navigate {...target} />;
}

function SignedIn({ member }: { member: CurrentMember }) {
  useEffect(() => applyDensity(member.density), [member.density]);
  return (
    <AppShell member={member}>
      <Outlet />
    </AppShell>
  );
}

/** 「/」：按角色进入默认首页（坐席 / 客服主管 P04，售后负责人 P13，知识库负责人 / 管理员 P17） */
const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: ({ context }) => {
    if (context.member) throw redirect({ to: sectionPaths[context.member.home] });
  },
});

/** 按能力把关的页面：有能力显示页面内容，没有显示 G2（写明哪个角色能看，按钮「返回首页」） */
function PageGate({ page, children }: { page: PageDefinition; children?: ReactNode }) {
  const member = useCurrentMember();
  if (!canOpenPage(member, page)) return <Forbidden page={page} member={member} />;
  return children ?? null;
}

function pageRoute<TPath extends string>(
  page: PageDefinition & { readonly path: TPath },
  Content?: ComponentType,
) {
  return createRoute({
    getParentRoute: () => appRoute,
    path: page.path,
    component: () => <PageGate page={page}>{Content && <Content />}</PageGate>,
  });
}

/** P04 工单列表：地址栏可带 view=unassigned 打开未归属店铺队列（I17，待办 15；筛选条件随 18） */
const ticketsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: pages.tickets.path,
  validateSearch: ticketsSearchSchema,
  component: () => (
    <PageGate page={pages.tickets}>
      <TicketsPage />
    </PageGate>
  ),
});

/** P05 工单详情（待办 17）：与 P04 同一项能力（查看工单），没有时显示 G2 */
const ticketDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: ticketDetailPath,
  component: function TicketDetailRoute() {
    const { number } = ticketDetailRoute.useParams();
    return (
      <PageGate page={pages.tickets}>
        <TicketDetailPage key={number} number={number} />
      </PageGate>
    );
  },
});

/** P13 登记台账：筛选条件在地址栏（点完整率筛出缺字段的已完成单，待办 21） */
const ledgerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: pages.aftersalesLedger.path,
  validateSearch: ledgerSearchSchema,
  component: () => (
    <PageGate page={pages.aftersalesLedger}>
      <LedgerPage />
    </PageGate>
  ),
});

/** P18 渠道与店铺：地址栏可带要打开编辑抽屉的店铺（从 P27 点店铺进来） */
const channelsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: pages.settingsChannels.path,
  validateSearch: channelsSearchSchema,
  component: () => (
    <PageGate page={pages.settingsChannels}>
      <ChannelsPage />
    </PageGate>
  ),
});

/** P20 团队与权限：地址栏可带要选中的成员（从 P27 点成员进来） */
const teamRoute = createRoute({
  getParentRoute: () => appRoute,
  path: pages.settingsTeam.path,
  validateSearch: teamSearchSchema,
  component: () => (
    <PageGate page={pages.settingsTeam}>
      <TeamPage />
    </PageGate>
  ),
});

/** P27 审计日志：筛选条件在地址栏（PRD P27） */
const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: pages.audit.path,
  validateSearch: auditSearchSchema,
  component: () => (
    <PageGate page={pages.audit}>
      <AuditPage />
    </PageGate>
  ),
});

/** 「/aftersales」「/settings」：第一期售后只有 P13，设置先落到 P18（各自再按能力把关） */
const aftersalesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/aftersales',
  beforeLoad: () => {
    throw redirect({ to: pages.aftersalesLedger.path });
  },
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  beforeLoad: () => {
    throw redirect({ to: pages.settingsChannels.path });
  },
});

const routeTree = rootRoute.addChildren([
  devLoginRoute,
  loginRoute,
  loginCallbackRoute,
  logoutRoute,
  appRoute.addChildren([
    homeRoute,
    ticketsRoute,
    ticketDetailRoute,
    aftersalesRoute,
    ledgerRoute,
    pageRoute(pages.reports),
    settingsRoute,
    channelsRoute,
    teamRoute,
    auditRoute,
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient } });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
