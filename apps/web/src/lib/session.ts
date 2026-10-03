import type { CurrentMember, Density, DevMember } from '@forcome/contracts';
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
      if (error instanceof ApiRequestError && error.status === 401) return null;
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

/**
 * 应用的查询缓存。任何接口返回 401（会话过期、被停用、在别处退出）都视为会话已结束：当前成员置空，
 * 外壳随之换成登录入口，不必等刷新页面。
 */
export function createQueryClient(): QueryClient {
  const onError = (error: Error) => {
    if (error instanceof ApiRequestError && error.status === 401) {
      queryClient.setQueryData(currentMemberQuery.queryKey, null);
    }
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
  });
  return queryClient;
}

/** 登录成功后换掉上一位成员留下的缓存，记下当前成员（不必再请求一次 /api/me） */
export function rememberMember(queryClient: QueryClient, member: CurrentMember): void {
  queryClient.clear();
  queryClient.setQueryData(currentMemberQuery.queryKey, member);
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

/**
 * 切换密度：先改缓存里的当前成员（外壳据此改 <html data-density>，页面立即变化），同时保存到服务端
 * （刷新、重新登录后保持，AC-ST-04）；保存失败退回原来的密度
 */
export function useSaveDensity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (density: Density) => api.savePreferences({ density }),
    onMutate: (density) => {
      const previous = queryClient.getQueryData(currentMemberQuery.queryKey);
      if (previous) {
        const updated: CurrentMember = { ...previous, density };
        queryClient.setQueryData(currentMemberQuery.queryKey, updated);
      }
      return previous;
    },
    onError: (_error, _density, previous) => {
      if (previous) queryClient.setQueryData(currentMemberQuery.queryKey, previous);
    },
  });
}

/** 退出登录：结束服务端会话，清掉本机缓存的数据，回到登录入口 */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: api.logout,
    // 会话已经失效（401）也当作已退出
    onSettled: async () => {
      queryClient.clear();
      applyDensity(null);
      await navigate({ to: '/' });
    },
  });
}
