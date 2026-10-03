import { can, type CurrentMember } from '@forcome/contracts';
import { useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { LoadError } from '@/components/load-error';
import { pages, sectionPaths, type PageDefinition } from '@/lib/pages';
import { applyDensity, currentMemberQuery, devMembersQuery } from '@/lib/session';
import { DevLoginPage } from '@/pages/dev-login';

/*
 * 路由（ADR 0007：TanStack Router，代码定义）。登录后的页面都挂在 app 布局下：
 * 没登录（含会话 7 天无操作过期）时，开启了开发登录就去开发登录页；钉钉扫码登录页（G11）随 05 号待办。
 * 「/」按角色进入默认首页（PRD 4.1）；各页面按能力把关，没有权限时在原地址显示 G2。
 * 第一期各页面的内容随各自的待办加进来（P04 18、P05 17、P13 19、P17 24、P18 07、P20 06、P27 30），在那之前内容区为空。
 */

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
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

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context }) => {
    const member = await context.queryClient.ensureQueryData(currentMemberQuery);
    if (!member && (await context.queryClient.ensureQueryData(devMembersQuery))) {
      throw redirect({ to: '/dev-login' });
    }
    // 先落密度再渲染外壳，刷新时不会先闪一下舒适档
    applyDensity(member?.density ?? null);
    return { member };
  },
  component: AppLayout,
});

function AppLayout() {
  // 读缓存而不是路由上下文：切换密度后缓存里的成员会先变（useSaveDensity）
  const { data: member } = useSuspenseQuery(currentMemberQuery);
  // 未登录且没有开发登录：钉钉扫码登录页（G11）随 05 号待办，在那之前什么也不显示
  if (!member) return null;
  return <SignedIn member={member} />;
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
  const { data: member } = useSuspenseQuery(currentMemberQuery);
  if (!member) return null;
  if (!can(member.roles, page.capability)) return <Forbidden page={page} member={member} />;
  return children ?? null;
}

function pageRoute<TPath extends string>(page: PageDefinition & { readonly path: TPath }) {
  return createRoute({
    getParentRoute: () => appRoute,
    path: page.path,
    component: () => <PageGate page={page} />,
  });
}

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
  appRoute.addChildren([
    homeRoute,
    pageRoute(pages.tickets),
    aftersalesRoute,
    pageRoute(pages.aftersalesLedger),
    pageRoute(pages.reports),
    settingsRoute,
    pageRoute(pages.settingsChannels),
    pageRoute(pages.settingsTeam),
    pageRoute(pages.audit),
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
