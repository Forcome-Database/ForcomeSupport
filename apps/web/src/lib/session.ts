import {
  densityLabels,
  type CurrentMember,
  type Density,
  type DevMember,
} from '@forcome/contracts';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api, ApiRequestError } from './api';
import { dismissAllToasts, dismissToast, showError } from './notify';

/**
 * 会话是不是因为 7 天未操作而过期的（服务端只在过期后的第一个请求返回 session_expired，之后都是普通的 401）：
 * 记下来，登录入口据此先显示 G12「已退出登录」，取走后清掉
 */
let sessionExpired = false;

function noteSessionEnd(error: unknown): void {
  if (
    error instanceof ApiRequestError &&
    error.status === 401 &&
    error.code === 'session_expired'
  ) {
    sessionExpired = true;
  }
}

/** 取走「会话已过期」的标记（登录入口用一次） */
export function takeSessionExpired(): boolean {
  const expired = sessionExpired;
  sessionExpired = false;
  return expired;
}

/**
 * 当前成员；未登录或会话过期（401）为 null（不当作错误）。一分钟后过期：切回窗口时重新取，
 * 管理员在 P20 改了角色与店铺范围，不刷新页面也能跟上。
 */
export const currentMemberQuery = queryOptions({
  queryKey: ['session', 'me'],
  queryFn: async (): Promise<CurrentMember | null> => {
    try {
      return await api.me();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        noteSessionEnd(error);
        return null;
      }
      throw error;
    }
  },
  retry: false,
  staleTime: 60 * 1000,
});

/** 开发登录可选的成员；没开启开发登录（含生产环境）时为 null */
export const devMembersQuery = queryOptions({
  queryKey: ['session', 'dev-members'],
  queryFn: async (): Promise<DevMember[] | null> => {
    try {
      return await api.devMembers();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return null;
      throw error;
    }
  },
  retry: false,
  staleTime: Infinity,
});

/** 在职的管理员（G2 写「如需开通请联系管理员刘洋」） */
export const adminContactsQuery = queryOptions({
  queryKey: ['org', 'admin-contacts'],
  queryFn: api.adminContacts,
  staleTime: 5 * 60 * 1000,
});

/** 会话结束时要撤掉的本机待办（退出登录、会话失效、换成别的成员；例如还在撤销窗口里、到点才提交的「指定店铺」） */
const sessionEndListeners = new Set<() => void>();

/** 登记一件会话结束时要撤掉的事，返回取消登记 */
export function onSessionEnd(listener: () => void): () => void {
  sessionEndListeners.add(listener);
  return () => sessionEndListeners.delete(listener);
}

function sessionEnded(): void {
  for (const listener of sessionEndListeners) listener();
}

/**
 * 会话已结束（接口返回 401：过期、被停用、在别处退出）时：当前成员置空，外壳随之换成登录入口，
 * 留着的浮层一并撤掉。返回是否是这种情况。查询与写操作的统一处理、以及不经查询缓存的请求（如浮层里的重试）都用它。
 */
export function endSessionIfUnauthenticated(queryClient: QueryClient, error: unknown): boolean {
  if (!(error instanceof ApiRequestError && error.status === 401)) return false;
  noteSessionEnd(error);
  sessionEnded();
  queryClient.setQueryData(currentMemberQuery.queryKey, null);
  dismissAllToasts();
  return true;
}

/** 应用的查询缓存：任何查询或写操作返回 401 都视为会话已结束（endSessionIfUnauthenticated），不必等刷新页面 */
export function createQueryClient(): QueryClient {
  const onError = (error: Error) => {
    endSessionIfUnauthenticated(queryClient, error);
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
  });
  return queryClient;
}

/** 登录成功后换掉上一位成员留下的缓存，记下当前成员（不必再请求一次 /api/me） */
export function resetCacheForMember(queryClient: QueryClient, member: CurrentMember): void {
  sessionEnded();
  queryClient.clear();
  queryClient.setQueryData(currentMemberQuery.queryKey, member);
}

/**
 * 没登录时去哪里：开启了开发登录（非生产环境）去开发登录页；否则去钉钉扫码登录页（G11），会话是 7 天未操作过期的
 * 先显示 G12「已退出登录」（expired）
 */
export function signedOutTarget(
  devLogin: boolean,
  expired: boolean,
): { to: '/dev-login' } | { to: '/login'; search: { expired?: true } } {
  if (devLogin) return { to: '/dev-login' };
  return { to: '/login', search: expired ? { expired: true } : {} };
}

/**
 * 把密度落到页面上（G9）：<html data-density> 切换 globals.css 里的两套变量。
 * 未登录（开发登录页、登录页）用默认的舒适。
 */
export function applyDensity(density: Density | null): void {
  if (density) {
    document.documentElement.dataset.density = density;
  } else {
    delete document.documentElement.dataset.density;
  }
}

/** 密度保存失败的浮层：同一时间只留一条，之后保存成功就撤掉 */
const DENSITY_TOAST = 'density-save';

/**
 * 切换密度：先改缓存里的当前成员（外壳据此改 <html data-density>，页面立即变化），同时保存到服务端
 * （刷新、重新登录后保持，AC-ST-04）。保存失败退回原来的密度，并弹出不自动消失的失败浮层（G5），
 * 「立即重试」保存成功后改为新的密度、浮层消失；会话已结束（401）时不弹，外壳换成登录入口。
 */
export function useSaveDensity() {
  const queryClient = useQueryClient();
  const currentDensity = () => queryClient.getQueryData(currentMemberQuery.queryKey)?.density;
  const showDensity = (density: Density) => {
    const current = queryClient.getQueryData(currentMemberQuery.queryKey);
    if (current) {
      const updated: CurrentMember = { ...current, density };
      queryClient.setQueryData(currentMemberQuery.queryKey, updated);
    }
  };
  const save = (density: Density) => api.savePreferences({ density });

  return useMutation({
    mutationFn: save,
    onMutate: (density) => {
      const previous = currentDensity();
      showDensity(density);
      return previous;
    },
    onSuccess: () => dismissToast(DENSITY_TOAST),
    onError: (error, density, previous) => {
      if (!previous) return;
      showDensity(previous);
      if (endSessionIfUnauthenticated(queryClient, error)) return;
      showError({
        id: DENSITY_TOAST,
        action: '保存',
        error,
        description: `密度已恢复为「${densityLabels[previous]}」，重试成功后改为「${densityLabels[density]}」。`,
        retry: async () => {
          try {
            await save(density);
          } catch (retryError) {
            // 会话已结束：浮层随之撤掉，外壳换成登录入口
            if (endSessionIfUnauthenticated(queryClient, retryError)) return;
            throw retryError;
          }
          showDensity(density);
        },
      });
    },
  });
}

/** 头像菜单「退出登录」去的地址（退出登录页，`pages/logout.tsx`） */
export const LOGOUT_PATH = '/logout';

/**
 * 结束会话：结束服务端会话，清掉本机缓存的数据，回到登录入口。只在退出登录页（`pages/logout.tsx`）里用——头像菜单先导航
 * 到那里，离开当前页面先过 G8，不在原页面上直接结束会话
 */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: api.logout,
    // 会话已经失效（401）也当作已退出
    onSettled: async () => {
      sessionEnded();
      queryClient.clear();
      dismissAllToasts();
      applyDensity(null);
      await navigate({ to: '/', replace: true });
    },
  });
}
