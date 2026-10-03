import { currentMemberSchema, type NavSection, type Role } from '@forcome/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 角色、导航与默认首页（PRD 4.1「第一阶段」表）；第一期只有生产厂对接人角色的成员登录被拒（AC-P1-21、G12）。
 * 导航与默认首页由后端按角色算好放在 /api/me，前端照它显示（能力矩阵在 contracts，前后端同一份）。
 * 先跑登录被拒与管理员联系人（它们断言只有示例数据里的管理员刘洋），再跑会新增兼岗管理员的多角色用例。
 */
let t: TestHarness;

beforeAll(async () => {
  t = await startTestHarness();
});

afterAll(async () => {
  await t.close();
});

async function me(client: Awaited<ReturnType<TestHarness['loginAs']>>) {
  const res = await client.get('/api/me');
  expect(res.status).toBe(200);
  return currentMemberSchema.parse(await res.json());
}

describe('第一期只有生产厂对接人角色的成员登录被拒（AC-P1-21、G12）', () => {
  it('开发登录列出生产厂对接人，但登录返回无权限，不建会话、不记登录', async () => {
    const list = (await (await t.api.get('/api/dev/members')).json()) as {
      members: { id: string; name: string; roles: Role[] }[];
    };
    // 成员表里的在职成员（示例数据的 8 位）：五种客服系统角色，加上第一期会被拒的生产厂对接人
    expect(new Set(list.members.flatMap((m) => m.roles))).toEqual(
      new Set([
        'agent',
        'supervisor',
        'aftersales_owner',
        'knowledge_owner',
        'admin',
        'factory_contact',
      ]),
    );
    const chengong = list.members.find((m) => m.name === '陈工');
    expect(chengong?.roles).toEqual(['factory_contact']);
    const loginsBefore = (await t.auditRecords({ action: 'auth.login' })).length;

    const res = await t.api.post('/api/dev/login', { memberId: chengong?.id });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'login_denied',
      reason: 'factory_phase1',
      message: '工厂工作台第二阶段上线，目前无法进入。',
    });
    expect(res.headers.getSetCookie()).toEqual([]);
    expect((await t.api.get('/api/me')).status).toBe(401);
    expect(await t.auditRecords({ action: 'auth.login' })).toHaveLength(loginsBefore);
  });

  it('兼有客服系统角色的生产厂对接人照常进入，权限取并集', async () => {
    const memberId = await t.addMember({
      name: '兼岗对接人',
      dept: 'FQD / 品质部',
      roles: ['factory_contact', 'agent'],
      allStores: true,
      factoryCode: 'FQD',
    });
    const current = await me(await t.loginAs({ memberId }));
    expect(current.nav).toEqual(['tickets', 'aftersales']);
    expect(current.home).toBe('tickets');
  });

  it('另两种被拒（G12）：未分配角色写出管理员，已停用写明原因', async () => {
    const noRole = await t.addMember({
      name: '新同事',
      dept: 'FSH / 客服部',
      roles: [],
      allStores: true,
    });
    const disabled = await t.addMember({
      name: '已离职',
      dept: 'FSH / 客服部',
      roles: ['agent'],
      allStores: true,
      status: 'disabled',
    });

    const a = await t.api.post('/api/dev/login', { memberId: noRole });
    const b = await t.api.post('/api/dev/login', { memberId: disabled });

    expect(a.status).toBe(403);
    expect(await a.json()).toMatchObject({
      reason: 'no_role',
      message: '你的钉钉账号还没有在本系统分配角色，请联系管理员刘洋。',
    });
    expect(b.status).toBe(403);
    expect(await b.json()).toMatchObject({
      reason: 'disabled',
      message: '你的账号已停用（钉钉离职或管理员停用）。',
    });
  });

  it('管理员联系人：在职的管理员（无权限页面 G2 写「请联系管理员刘洋」）', async () => {
    const agent = await t.loginAs('坐席');
    const res = await agent.get('/api/org/admin-contacts');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      admins: [{ id: expect.any(String) as string, name: '刘洋' }],
    });
    expect((await t.api.get('/api/org/admin-contacts')).status).toBe(401);
  });
});

describe('登录后的导航与默认首页（PRD 4.1 第一阶段表）', () => {
  const table: [string, NavSection[], NavSection][] = [
    ['坐席', ['tickets', 'aftersales'], 'tickets'],
    ['客服主管', ['tickets', 'aftersales', 'reports'], 'tickets'],
    ['售后负责人', ['tickets', 'aftersales', 'reports'], 'aftersales'],
    ['知识库负责人', ['tickets', 'reports'], 'reports'],
    ['管理员', ['reports', 'settings'], 'reports'],
  ];

  it.each(table)('%s：导航 %j，默认首页 %s', async (role, nav, home) => {
    const current = await me(await t.loginAs(role));
    expect(current.nav).toEqual(nav);
    expect(current.home).toBe(home);
  });

  it('多角色成员导航取并集，默认首页按 坐席/客服主管 → 售后负责人 → 知识库负责人/管理员 取第一个', async () => {
    const cases: [Role[], NavSection[], NavSection][] = [
      [['knowledge_owner', 'admin'], ['tickets', 'reports', 'settings'], 'reports'],
      [
        ['admin', 'aftersales_owner'],
        ['tickets', 'aftersales', 'reports', 'settings'],
        'aftersales',
      ],
      [['aftersales_owner', 'agent'], ['tickets', 'aftersales', 'reports'], 'tickets'],
    ];
    for (const [roles, nav, home] of cases) {
      const memberId = await t.addMember({
        name: `兼岗 ${roles.join('+')}`,
        dept: 'FSH / 客服部',
        roles,
        allStores: true,
      });
      const current = await me(await t.loginAs({ memberId }));
      expect(current.roles).toEqual(roles);
      expect(current.nav).toEqual(nav);
      expect(current.home).toBe(home);
    }
  });

  it('当前成员带店铺数据范围与密度偏好（示例成员都是全部店铺、舒适）', async () => {
    const current = await me(await t.loginAs('坐席'));
    expect(current).toMatchObject({
      name: '李婷',
      dept: 'FSH / 客服部',
      stores: { all: true },
      density: 'comfortable',
    });
  });
});
