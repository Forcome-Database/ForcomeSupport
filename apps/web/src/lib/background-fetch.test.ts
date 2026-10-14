import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateInBackground, isBackgroundFetch } from './background-fetch';

/*
 * 推送触发的重新拉取是后台请求（ADR 0010 修订「7 天无操作过期」，待办 18）：正在显示的查询失效后重新拉取时，queryFn 认得出
 * 这一次是后台的；没在显示的只标为过期，下次显示时是人的操作。
 */

function recordingQuery(client: QueryClient, key: readonly unknown[]) {
  const calls: boolean[] = [];
  const options = {
    queryKey: key,
    queryFn: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      calls.push(isBackgroundFetch(queryKey));
      return Promise.resolve(calls.length);
    },
  };
  return { calls, options };
}

describe('推送触发的重新拉取', () => {
  it('正在显示的查询：失效后立即重新拉取，这一次是后台请求；之后的再取照常是人的操作', async () => {
    const client = new QueryClient();
    const { calls, options } = recordingQuery(client, ['tickets', 'list', { page: 1 }]);
    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => undefined);
    await client.fetchQuery({ ...options, staleTime: Infinity });
    expect(calls).toEqual([false]);

    await invalidateInBackground(client, ['tickets']);
    expect(calls).toEqual([false, true]);

    await client.refetchQueries({ queryKey: ['tickets'] });
    expect(calls).toEqual([false, true, false]);
    unsubscribe();
  });

  it('没在显示的查询：只标为过期、不重新拉取，下次显示时由人的操作取', async () => {
    const client = new QueryClient();
    const { calls, options } = recordingQuery(client, ['tickets', 'detail', 'T-20260910-0001']);
    await client.fetchQuery(options);
    await invalidateInBackground(client, ['tickets']);
    expect(calls).toEqual([false]);
    expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(true);
    await client.fetchQuery(options);
    expect(calls).toEqual([false, false]);
  });
});
