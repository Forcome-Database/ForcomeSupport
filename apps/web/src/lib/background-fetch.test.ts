import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateInBackground, isBackgroundFetch } from './background-fetch';
import { LIVE_COALESCE_MS, liveInvalidator } from './live-updates';

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

describe('一阵推送合成一次', () => {
  it('同一类变化在合并窗口内只失效一次；resync 让全部缓存失效', async () => {
    vi.useFakeTimers();
    try {
      const client = new QueryClient();
      const spy = vi.spyOn(client, 'invalidateQueries');
      const invalidator = liveInvalidator(client);
      for (let i = 0; i < 5; i += 1) invalidator.apply('tickets');
      expect(spy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(LIVE_COALESCE_MS);
      expect(spy.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['tickets']]);
      invalidator.apply('resync');
      await vi.advanceTimersByTimeAsync(LIVE_COALESCE_MS);
      expect(spy.mock.calls.slice(1).map(([filters]) => filters?.queryKey)).toEqual([
        ['tickets'],
        ['unassigned-mail'],
        ['notifications'],
      ]);
      // 停掉后还没到点的不再失效
      invalidator.apply('tickets');
      invalidator.stop();
      await vi.advanceTimersByTimeAsync(LIVE_COALESCE_MS);
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
