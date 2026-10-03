import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { ServerDeps } from '../src/deps';
import { ManualClock, OptimisticLockError, silentLogger, type Runtime } from '../src/modules/core';
import { IntegrationClients } from '../src/modules/integration';

// 不连数据库的场景：用一个总是失败的数据库句柄
function runtimeWithBrokenDatabase(): Runtime {
  return {
    db: { execute: () => Promise.reject(new Error('connection refused')) },
    boss: {},
    clock: new ManualClock('2026-09-11T02:20:00Z'),
  } as unknown as Runtime;
}

function deps(config: Partial<ServerDeps['config']> = {}): ServerDeps {
  const appEnv = config.appEnv ?? 'test';
  return {
    runtime: runtimeWithBrokenDatabase(),
    logger: silentLogger,
    config: { appEnv, devLoginEnabled: config.devLoginEnabled ?? false },
    clients: new IntegrationClients({ appEnv }),
  };
}

describe('HTTP 应用', () => {
  it('数据库不可用时健康检查返回 503', async () => {
    const app = createApp(deps());
    const res = await app.request('/api/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'unavailable',
      checks: { database: 'unavailable' },
      time: '2026-09-11T02:20:00.000Z',
    });
  });

  it('乐观锁冲突统一返回 409（G7）', async () => {
    const app = createApp(deps());
    app.get('/api/__conflict', () => {
      throw new OptimisticLockError('aftersales', 'S-20260911-0018');
    });
    const res = await app.request('/api/__conflict');
    expect(res.status).toBe(409);
    // 只给前端错误码与通用提示，不带表名与行 ID（G7 的文案由前端按错误码显示）
    expect(await res.json()).toEqual({ error: 'optimistic_lock', message: '数据已被他人修改' });
  });

  it('未预期的错误返回 500，不把内部信息带给前端', async () => {
    const app = createApp(deps());
    app.get('/api/__boom', () => {
      throw new Error('secret internal detail');
    });
    const res = await app.request('/api/__boom');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });

  it('提供 OpenAPI 文档', async () => {
    const app = createApp(deps());
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toContain('/api/health');
  });
});

describe('生产环境没有开发登录（ADR 0010 修订）', () => {
  const login = (app: ReturnType<typeof createApp>) =>
    app.request('/api/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId: '00000000-0000-4000-8000-000000000000' }),
    });

  it('生产环境即使配置写了开启，也不挂开发登录接口，OpenAPI 文档里也没有', async () => {
    const app = createApp(deps({ appEnv: 'production', devLoginEnabled: true }));

    expect((await app.request('/api/dev/members')).status).toBe(404);
    expect((await login(app)).status).toBe(404);
    const doc = (await (await app.request('/api/openapi.json')).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(doc.paths).filter((p) => p.startsWith('/api/dev/'))).toEqual([]);
  });

  it('非生产环境没开启时同样没有', async () => {
    const app = createApp(deps({ appEnv: 'staging', devLoginEnabled: false }));
    expect((await app.request('/api/dev/members')).status).toBe(404);
    expect((await login(app)).status).toBe(404);
  });

  it('非生产环境开启后列出示例数据里可登录的成员', async () => {
    const app = createApp(deps({ appEnv: 'staging', devLoginEnabled: true }));
    const res = await app.request('/api/dev/members');
    expect(res.status).toBe(200);
    const { members } = (await res.json()) as { members: { name: string; roles: string[] }[] };
    expect(members.map((m) => m.roles[0])).toEqual(
      expect.arrayContaining(['坐席', '客服主管', '售后负责人', '知识库负责人', '管理员']),
    );
  });

  it('请求参数不符合模式时返回 400 并写明哪里不对', async () => {
    const app = createApp(deps({ appEnv: 'test', devLoginEnabled: true }));
    const res = await app.request('/api/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('不存在的接口返回 404 的 JSON', async () => {
    const res = await createApp(deps()).request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found', message: '接口不存在' });
  });
});
