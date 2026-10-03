import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { ManualClock, OptimisticLockError, silentLogger, type Runtime } from '../src/modules/core';

// 不连数据库的场景：用一个总是失败的数据库句柄
function runtimeWithBrokenDatabase(): Runtime {
  return {
    db: { execute: () => Promise.reject(new Error('connection refused')) },
    boss: {},
    clock: new ManualClock('2026-09-11T02:20:00Z'),
  } as unknown as Runtime;
}

describe('HTTP 应用', () => {
  it('数据库不可用时健康检查返回 503', async () => {
    const app = createApp({ runtime: runtimeWithBrokenDatabase(), logger: silentLogger });
    const res = await app.request('/api/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'unavailable',
      checks: { database: 'unavailable' },
      time: '2026-09-11T02:20:00.000Z',
    });
  });

  it('乐观锁冲突统一返回 409（G7）', async () => {
    const app = createApp({ runtime: runtimeWithBrokenDatabase(), logger: silentLogger });
    app.get('/api/__conflict', () => {
      throw new OptimisticLockError('aftersales', 'S-20260911-0018');
    });
    const res = await app.request('/api/__conflict');
    expect(res.status).toBe(409);
    // 只给前端错误码与通用提示，不带表名与行 ID（G7 的文案由前端按错误码显示）
    expect(await res.json()).toEqual({ error: 'optimistic_lock', message: '数据已被他人修改' });
  });

  it('未预期的错误返回 500，不把内部信息带给前端', async () => {
    const app = createApp({ runtime: runtimeWithBrokenDatabase(), logger: silentLogger });
    app.get('/api/__boom', () => {
      throw new Error('secret internal detail');
    });
    const res = await app.request('/api/__boom');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });

  it('提供 OpenAPI 文档', async () => {
    const app = createApp({ runtime: runtimeWithBrokenDatabase(), logger: silentLogger });
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toContain('/api/health');
  });
});
