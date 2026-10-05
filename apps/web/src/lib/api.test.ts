import { BACKGROUND_REQUEST_HEADER } from '@forcome/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError, failureReason, NetworkError } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('接口错误与失败原因（G5 浮层标题「<动作>失败：原因」）', () => {
  it('连不上服务器：抛 NetworkError，原因写「网络不可用」', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const error = await api.adminContacts().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(failureReason(error)).toBe('网络不可用');
    expect((error as NetworkError).cause).toBeInstanceOf(TypeError);
  });

  it('主动中止的请求不当作断网', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new DOMException('aborted', 'AbortError')));
    const error = await api.adminContacts().catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('接口返回错误：原因取后端的中文说明', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'internal', message: '服务器内部错误' }), {
          status: 500,
        }),
      ),
    );
    const error = await api.adminContacts().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect(failureReason(error)).toBe('服务器内部错误');
  });

  it('其他错误（代码里的缺陷等）不冒充成网络问题', () => {
    expect(failureReason(new TypeError('x is undefined'))).toBe('请稍后再试');
  });
});

describe('站内通知的后台请求（ADR 0010 修订「7 天无操作过期」，待办 04 留给 31）', () => {
  function recordRequests(body: unknown, status = 200) {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return Promise.resolve(
        status === 204
          ? new Response(null, { status })
          : new Response(JSON.stringify(body), { status }),
      );
    });
    return requests;
  }
  const header = (init: RequestInit | undefined) =>
    new Headers(init?.headers).get(BACKGROUND_REQUEST_HEADER);

  it('铃铛的未读数与面板开着时的定时重新拉取是后台请求：带请求头，服务端不续期会话', async () => {
    const requests = recordRequests({ unread: 3, items: [], now: '2026-09-11T02:20:00.000Z' });
    expect(await api.notificationUnread()).toBe(3);
    await api.notifications('unread', { background: true });
    expect(requests.map((r) => [r.url, header(r.init)])).toEqual([
      ['/api/notifications/unread-count', '1'],
      ['/api/notifications?view=unread', '1'],
    ]);
  });

  it('打开面板、切换页签时取列表是人的操作：不带后台请求头', async () => {
    const requests = recordRequests({ unread: 0, items: [], now: '2026-09-11T02:20:00.000Z' });
    await api.notifications('all', { background: false });
    expect(requests.map((r) => [r.url, header(r.init)])).toEqual([
      ['/api/notifications?view=all', null],
    ]);
  });

  it('点一条、全部已读是人的操作：不带后台请求头', async () => {
    const requests = recordRequests(null, 204);
    await api.markNotificationRead('0190a1b2-0000-7000-8000-000000000001');
    await api.markAllNotificationsRead();
    expect(requests.map((r) => [r.url, r.init?.method, header(r.init)])).toEqual([
      ['/api/notifications/0190a1b2-0000-7000-8000-000000000001/read', 'POST', null],
      ['/api/notifications/read-all', 'POST', null],
    ]);
  });
});
