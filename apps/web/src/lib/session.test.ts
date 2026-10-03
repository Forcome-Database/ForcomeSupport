import type { CurrentMember } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api';
import { createQueryClient, currentMemberQuery, rememberMember } from './session';

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
    rememberMember(client, member);

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
    rememberMember(client, member);
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
