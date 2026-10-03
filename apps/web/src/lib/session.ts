import type { CurrentMember, DevMember } from '@forcome/contracts';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from './api';

/** 当前成员；未登录为 null（不当作错误） */
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
  staleTime: Infinity,
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

/** 登录成功后记下当前成员（不必再请求一次 /api/me） */
export function rememberMember(queryClient: QueryClient, member: CurrentMember): void {
  queryClient.setQueryData(currentMemberQuery.queryKey, member);
}

/** 头像里的字：原型取名字的最后一个字（李婷 → 婷） */
export function avatarText(name: string): string {
  return [...name].at(-1) ?? '';
}
