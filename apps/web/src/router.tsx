import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { LoadError } from '@/components/load-error';
import { currentMemberQuery, devMembersQuery } from '@/lib/session';
import { DevLoginPage } from '@/pages/dev-login';

/*
 * 路由（ADR 0007：TanStack Router，代码定义）。登录后的页面都挂在 app 布局下：
 * 没登录时，开启了开发登录就去开发登录页；钉钉扫码登录页（G11）随 05 号待办。
 * 各页面（P04、P13、P17 …）与按角色的默认首页随各自的待办加在 app 布局下。
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
    return { member };
  },
  component: AppLayout,
});

function AppLayout() {
  const { member } = appRoute.useRouteContext();
  // 未登录且没有开发登录：钉钉扫码登录页（G11）随 05 号待办，在那之前什么也不显示
  if (!member) return null;
  return (
    <AppShell member={member}>
      <Outlet />
    </AppShell>
  );
}

/** 首页：按角色进入默认首页（PRD 4.1 第一阶段表）随 04 号待办，在那之前内容区为空 */
const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: () => null,
});

const routeTree = rootRoute.addChildren([devLoginRoute, appRoute.addChildren([homeRoute])]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient } });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
