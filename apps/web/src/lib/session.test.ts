import type { CurrentMember } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api';
import {
  createQueryClient,
  currentMemberQuery,
  resetCacheForMember,
  signedOutTarget,
  takeSessionExpired,
} from './session';

const member: CurrentMember = {
  id: '39550bdf-7cae-59d1-bece-97afd552daa0',
  name: '周敏',
  dept: 'FSH / 客服部',
  roles: ['supervisor'],
  stores: { all: true },
  density: 'comfortable',
  nav: ['tickets', 'aftersales', 'reports'],
  home: 'tickets',
};

describe('会话在使用中结束', () => {
  it('任何接口返回 401：当前成员置空，外壳换成登录入口', async () => {
    const client = createQueryClient();
    resetCacheForMember(client, member);

    await client
      .fetchQuery({
        queryKey: ['tickets'],
        queryFn: () => Promise.reject(new ApiRequestError(401, 'session_expired', '7 天未操作')),
        retry: false,
      })
      .catch(() => undefined);

    expect(client.getQueryData(currentMemberQuery.queryKey)).toBeNull();
  });

  it('其他错误不影响登录状态；登录时换掉上一位成员留下的缓存', async () => {
    const client = createQueryClient();
    client.setQueryData(['tickets'], ['上一位成员能看到的数据']);
    resetCacheForMember(client, member);
    expect(client.getQueryData(['tickets'])).toBeUndefined();

    await client
      .fetchQuery({
        queryKey: ['reports'],
        queryFn: () => Promise.reject(new ApiRequestError(500, 'internal', '服务器内部错误')),
        retry: false,
      })
      .catch(() => undefined);

    expect(client.getQueryData(currentMemberQuery.queryKey)).toEqual(member);
  });
});

describe('没登录时去哪里（G11、G12）', () => {
  it('开启了开发登录（非生产环境）去开发登录页；否则去钉钉扫码登录页，7 天未操作过期的先显示「已退出登录」', () => {
    expect(signedOutTarget(true, true)).toEqual({ to: '/dev-login' });
    expect(signedOutTarget(false, false)).toEqual({ to: '/login', search: {} });
    expect(signedOutTarget(false, true)).toEqual({ to: '/login', search: { expired: true } });
  });

  it('只有 7 天未操作（session_expired）才记为过期，取走一次后清掉', async () => {
    takeSessionExpired();
    const client = createQueryClient();
    resetCacheForMember(client, member);
    const fail = (error: ApiRequestError) =>
      client
        .fetchQuery({
          queryKey: ['x', error.code],
          queryFn: () => Promise.reject(error),
          retry: false,
        })
        .catch(() => undefined);

    await fail(new ApiRequestError(401, 'unauthenticated', '未登录或会话已失效，请重新登录'));
    expect(takeSessionExpired()).toBe(false);

    await fail(new ApiRequestError(401, 'session_expired', '7 天未操作，已退出登录'));
    expect(takeSessionExpired()).toBe(true);
    expect(takeSessionExpired()).toBe(false);
  });
});
