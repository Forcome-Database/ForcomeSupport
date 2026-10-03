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
