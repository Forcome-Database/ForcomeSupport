import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestHarness, TEST_CLIENT_IP, type TestHarness } from './harness';

/*
 * 示范用例（待办 02）：后续各待办的集成测试照这个样子写，只经主接缝（规格「测试接缝」）——
 * 在测试进程内调用 HTTP 接口、真实 PostgreSQL、外部客户端全部用 Fake、可注入时钟、同步跑完任务，
 * 断言接口输出与审计记录，不调用模块内部函数，也不直接查表。
 *
 * 典型写法：往 Fake 里放数据（t.clients.fake(…)）→ 推进时钟（t.clock.advance）→ 跑完任务（t.runJobs）
 * → 以某个角色登录（t.loginAs）调接口 → 断言输出与 t.auditRecords。
 */
let t: TestHarness;

beforeAll(async () => {
  t = await startTestHarness();
});

afterAll(async () => {
  await t.close();
});

describe('开发登录（ADR 0010 修订：只在非生产环境由环境变量开启）', () => {
  it('开发登录后能调用受保护的接口，审计里有登录记录', async () => {
    t.clock.set('2026-09-11T02:20:00Z');
    expect((await t.api.get('/api/me')).status).toBe(401);

    const supervisor = await t.loginAs('客服主管');
    const me = await supervisor.get('/api/me');

    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ name: '周敏', roles: ['客服主管'] });
    expect(await t.auditRecords({ action: 'auth.login' })).toEqual([
      expect.objectContaining({
        occurredAt: new Date('2026-09-11T02:20:00Z'),
        actorType: 'member',
        actorName: '周敏',
        actorRoles: ['客服主管'],
        ip: TEST_CLIENT_IP,
        objectType: 'login',
        objectLabel: '开发登录',
      }),
    ]);
  });

  it('不同成员各有各的会话，按成员 key 也能登录', async () => {
    const agent = await t.loginAs({ member: 'liting' });
    const owner = await t.loginAs('售后负责人');

    expect(await (await agent.get('/api/me')).json()).toMatchObject({ name: '李婷' });
    expect(await (await owner.get('/api/me')).json()).toMatchObject({ name: '王磊' });
  });

  it('没有会话或会话 Cookie 是伪造的，受保护接口返回 401', async () => {
    const forged = await t.api.request('/api/me', {
      headers: { cookie: 'forcome_session=forged-token' },
    });
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({
      error: 'unauthenticated',
      message: '未登录或会话已失效，请重新登录',
    });
  });

  it('登录不存在的成员返回 404，不建会话', async () => {
    const res = await t.api.post('/api/dev/login', {
      memberId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).toBe(404);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('会话 Cookie 只给服务端读（httpOnly），本机与测试环境不要求 HTTPS', async () => {
    const members = (await (await t.api.get('/api/dev/members')).json()) as {
      members: { id: string; name: string }[];
    };
    const liting = members.members.find((m) => m.name === '李婷');
    const res = await t.api.post('/api/dev/login', { memberId: liting?.id });

    const [cookie] = res.headers.getSetCookie();
    expect(cookie).toMatch(/^forcome_session=[\w-]{43}; /);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure');
  });
});
