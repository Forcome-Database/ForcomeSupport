import { BACKGROUND_REQUEST_HEADER } from '@forcome/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestHarness, TEST_CLIENT_IP, type TestHarness } from './harness';

/*
 * 会话（ADR 0010）：服务端会话，无操作 7 天过期、有操作自动续期（时间全由可注入时钟控制）；退出登录；
 * 密度偏好存服务端，刷新与重新登录都保持（AC-ST-04、G9）。
 */
let t: TestHarness;

beforeAll(async () => {
  t = await startTestHarness();
});

afterAll(async () => {
  await t.close();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

describe('会话 7 天无操作过期（可注入时钟）', () => {
  it('不到 7 天有操作就续期，续期后从最后一次操作重新算 7 天', async () => {
    t.clock.set('2026-09-11T02:20:00Z');
    const agent = await t.loginAs('坐席');

    t.clock.advance({ milliseconds: SEVEN_DAYS_MS - 1000 });
    const renewed = await agent.get('/api/me');
    expect(renewed.status).toBe(200);
    // 续期时重发 Cookie，浏览器端的有效期也顺延 7 天
    expect(renewed.headers.getSetCookie()[0]).toMatch(/^forcome_session=.+Max-Age=604800/);

    t.clock.advance({ milliseconds: SEVEN_DAYS_MS - 1000 });
    expect((await agent.get('/api/me')).status).toBe(200);
  });

  it('7 天没有任何操作：会话过期（401 session_expired），Cookie 被清除，之后一直是未登录', async () => {
    t.clock.set('2026-09-11T02:20:00Z');
    const agent = await t.loginAs('坐席');
    const token = agent.cookie('forcome_session');

    t.clock.advance({ milliseconds: SEVEN_DAYS_MS });
    const expired = await agent.get('/api/me');

    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({
      error: 'session_expired',
      message: '7 天未操作，已退出登录',
    });
    expect(expired.headers.getSetCookie()[0]).toMatch(/^forcome_session=; Max-Age=0/);
    expect((await agent.get('/api/me')).status).toBe(401);

    // 时钟拨回去也救不回来：过期的会话已经删掉
    t.clock.set('2026-09-11T02:20:00Z');
    const again = await agent.request('/api/me', {
      headers: { cookie: `forcome_session=${token}` },
    });
    expect(again.status).toBe(401);
    expect(await again.json()).toMatchObject({ error: 'unauthenticated' });
  });

  it('1 分钟内的连续请求不重复续期（不重发 Cookie），过了 1 分钟再续期', async () => {
    t.clock.set('2026-09-11T02:20:00Z');
    const agent = await t.loginAs('坐席');

    t.clock.advance({ seconds: 30 });
    expect((await agent.get('/api/me')).headers.getSetCookie()).toEqual([]);
    t.clock.advance({ seconds: 31 });
    expect((await agent.get('/api/me')).headers.getSetCookie()).toHaveLength(1);
  });

  it('后台请求（轮询、实时推送触发的重新拉取）不算操作：照常校验，但不续期', async () => {
    t.clock.set('2026-09-11T02:20:00Z');
    const agent = await t.loginAs('坐席');
    const background = (path: string) =>
      agent.request(path, { headers: { [BACKGROUND_REQUEST_HEADER]: '1' } });

    t.clock.advance({ days: 6 });
    const polled = await background('/api/me');
    expect(polled.status).toBe(200);
    expect(polled.headers.getSetCookie()).toEqual([]);

    // 距最后一次人的操作（登录）满 7 天：即使中间一直有后台请求，也过期
    t.clock.advance({ days: 1 });
    const expired = await background('/api/me');
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ error: 'session_expired' });
  });
});

describe('退出登录', () => {
  it('结束会话、清除 Cookie，并记一条审计', async () => {
    t.clock.set('2026-09-11T03:00:00Z');
    const owner = await t.loginAs('售后负责人');

    const res = await owner.post('/api/logout');

    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()[0]).toMatch(/^forcome_session=; Max-Age=0/);
    expect((await owner.get('/api/me')).status).toBe(401);
    expect(await t.auditRecords({ action: 'auth.logout' })).toEqual([
      expect.objectContaining({
        occurredAt: new Date('2026-09-11T03:00:00Z'),
        actorName: '王磊',
        actorRoles: ['aftersales_owner'],
        ip: TEST_CLIENT_IP,
        objectType: 'login',
        objectLabel: '退出登录',
      }),
    ]);
  });

  it('没登录时退出返回 401', async () => {
    expect((await t.api.post('/api/logout')).status).toBe(401);
  });
});

describe('密度偏好存服务端（AC-ST-04、G9）', () => {
  it('切到紧凑后，刷新与重新登录都保持；只影响本人', async () => {
    const supervisor = await t.loginAs('客服主管');
    expect(await (await supervisor.get('/api/me')).json()).toMatchObject({
      density: 'comfortable',
    });

    const saved = await supervisor.put('/api/me/preferences', { density: 'compact' });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ density: 'compact' });

    // 刷新：同一会话再取
    expect(await (await supervisor.get('/api/me')).json()).toMatchObject({ density: 'compact' });
    // 重新登录：新会话
    await supervisor.post('/api/logout');
    const again = await t.loginAs('客服主管');
    expect(await (await again.get('/api/me')).json()).toMatchObject({ density: 'compact' });
    // 别人不受影响
    const agent = await t.loginAs('坐席');
    expect(await (await agent.get('/api/me')).json()).toMatchObject({ density: 'comfortable' });

    // 切回舒适
    await again.put('/api/me/preferences', { density: 'comfortable' });
    expect(await (await again.get('/api/me')).json()).toMatchObject({ density: 'comfortable' });
  });

  it('只有舒适、紧凑两档；没登录不能保存', async () => {
    const supervisor = await t.loginAs('客服主管');
    const bad = await supervisor.put('/api/me/preferences', { density: 'spacious' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_request' });
    expect((await t.api.put('/api/me/preferences', { density: 'compact' })).status).toBe(401);
  });
});
