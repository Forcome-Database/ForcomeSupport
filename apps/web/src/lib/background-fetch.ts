import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';

/*
 * 推送触发的重新拉取是后台请求（不续期会话，ADR 0010 修订「7 天无操作过期」，待办 18）：失效前把正在显示的查询登记下来，
 * 查询的 queryFn 取数时用 isBackgroundFetch 认出它、带上后台请求头。推送本身在 lib/live-updates.ts。
 */

/** 推送触发、还没取的重新拉取（查询的 hash） */
const backgroundFetches = new Set<string>();

/** 这一次取数是不是推送触发的重新拉取（取一次就用掉）；queryFn 里调用 */
export function isBackgroundFetch(queryKey: QueryKey): boolean {
  return backgroundFetches.delete(hashKey(queryKey));
}

/**
 * 让某类缓存失效并在后台重新拉取：正在显示的查询登记为后台请求后再失效（失效会立即重新拉取它们）；没在显示的只标为过期，
 * 下次显示时由人的操作取，照常续期
 */
export function invalidateInBackground(
  queryClient: QueryClient,
  queryKey: QueryKey,
): Promise<void> {
  for (const query of queryClient.getQueryCache().findAll({ queryKey, type: 'active' })) {
    backgroundFetches.add(query.queryHash);
  }
  return queryClient.invalidateQueries({ queryKey });
}
