import {
  apiErrorSchema,
  currentMemberSchema,
  devDingtalkRejoinResponseSchema,
  storeOptionsSchema,
  teamCandidatesSchema,
  teamMemberSchema,
  teamMessages,
  teamSchema,
  type StoreScopeValue,
  type Team,
  type TeamChange,
  type TeamMember,
  type TeamMemberAdd,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dingtalkClient } from '../src/modules/integration';
import { dingtalkReconcileJob } from '../src/modules/org';
import type { ApiClient } from './api-client';
import { DEMO_NOW, startTestHarness, TEST_CLIENT_IP, type TestHarness } from './harness';

/*
 * P20 设置 · 团队与权限（待办 06；PRD P20 与「第一阶段」小节、K6、K17、G7，AC-ST-06、R-ST-06）：
 * 成员表、「从钉钉添加」（从通讯录同步进来、还没有角色的人里选人，必填角色与店铺范围）、吸底保存栏统一保存角色与店铺范围。
 * 角色与店铺范围每次请求从成员表读，改了下一次请求即生效（ADR 0010）；所有修改记审计。
 * Fake 钉钉回放示例通讯录并对账一次：两家生产厂负责人作为没有角色的成员进来，以及新入职待添加的吴桐（示例数据的 DINGTALK_NEWCOMERS）。
 * 同一个库上的用例按顺序进行，前面的修改留给后面。
 */

const fixture = getDemoFixture();
const memberId = (key: string) => fixture.members.find((m) => m.key === key)!.id;
const storeId = (name: string) => fixture.stores.find((s) => s.name === name)!.id;
const DIRECT = storeId('Forcome Direct');
const FORCOME_COM = storeId('forcome.com');

let t: TestHarness;
let admin: ApiClient;

async function team(client: ApiClient = admin): Promise<Team> {
  const res = await client.get('/api/org/team');
  expect(res.status).toBe(200);
  return teamSchema.parse(await res.json());
}

async function memberOf(id: string): Promise<TeamMember | undefined> {
  return (await team()).members.find((m) => m.id === id);
}

async function candidates(client: ApiClient = admin) {
  const res = await client.get('/api/org/team/candidates');
  expect(res.status).toBe(200);
  return teamCandidatesSchema.parse(await res.json()).candidates;
}

function addMember(input: TeamMemberAdd, client: ApiClient = admin) {
  return client.post('/api/org/team/members', input);
}

function save(changes: TeamChange[], client: ApiClient = admin) {
  return client.put('/api/org/team', { changes });
}

/** 一位成员改成这些角色与店铺范围（带他现在的版本号） */
async function change(
  id: string,
  roles: TeamChange['roles'],
  stores: StoreScopeValue,
): Promise<TeamChange> {
  const current = await memberOf(id);
  if (!current) throw new Error(`成员表里没有 ${id}`);
  return { id, version: current.version, roles, stores };
}

async function fieldErrors(res: Response) {
  expect(res.status).toBe(400);
  const body = apiErrorSchema.parse(await res.json());
  expect(body.error).toBe('invalid_request');
  return body.fields;
}

async function me(client: ApiClient) {
  const res = await client.get('/api/me');
  expect(res.status).toBe(200);
  return currentMemberSchema.parse(await res.json());
}

async function storeOptions(client: ApiClient) {
  const res = await client.get('/api/channel/store-options');
  expect(res.status).toBe(200);
  return storeOptionsSchema.parse(await res.json()).stores.map((s) => s.name);
}

const candidateNamed = async (name: string) =>
  (await candidates()).find((c) => c.name === name)?.id ?? null;

beforeAll(async () => {
  t = await startTestHarness();
  await t.loadFixtures();
  t.clients.fake(dingtalkClient).replay(fixture);
  await t.enqueue(dingtalkReconcileJob, {});
  await t.runJobs();
  admin = await t.loginAs('管理员');
});

afterAll(async () => {
  await t.close();
});

describe('成员表（P20「成员」页签）', () => {
  it('列出已分配角色的成员：按角色、同角色按加入先后（原型 P20 的顺序），不列生产厂对接人与还没分配角色的人', async () => {
    const data = await team();
    expect(data.members.map((m) => m.name)).toEqual([
      '李婷',
      '陈晨',
      '周敏',
      '王磊',
      '赵倩',
      '刘洋',
    ]);
    expect(data.members[0]).toEqual({
      id: memberId('liting'),
      name: '李婷',
      email: 'liting@forcome.com',
      dept: 'FSH / 客服部',
      roles: ['agent'],
      stores: { all: true },
      status: 'active',
      // 示例数据的最近登录（原型 08:02）
      lastLoginAt: new Date('2026-09-11T08:02:00+08:00').toISOString(),
      version: expect.any(Number) as number,
      changedBy: null,
      changedAt: null,
    });
    // 刘洋刚才开发登录过：最近登录是这次登录的时刻
    expect(data.members.find((m) => m.name === '刘洋')?.lastLoginAt).toBe(
      new Date(DEMO_NOW).toISOString(),
    );
  });

  it('授权可选的全部店铺、钉钉通讯录最近一次对账成功的时刻（「10:00 同步」）与服务端的当前时刻', async () => {
    const data = await team();
    expect(data.stores.map((s) => s.name)).toEqual(fixture.stores.map((s) => s.name));
    expect(data.syncedAt).toBe(new Date(DEMO_NOW).toISOString());
    expect(data.now).toBe(new Date(DEMO_NOW).toISOString());
  });

  it('「从钉钉添加」可选的人：通讯录里在职、还没分配角色的人（含两家生产厂负责人），按姓名排序', async () => {
    const list = await candidates();
    expect(list.map((c) => c.name)).toEqual(['刘厂长', '吴桐', '周厂长']);
    expect(list.find((c) => c.name === '吴桐')).toMatchObject({
      dept: expect.stringContaining('FSH') as string,
      email: 'wutong@forcome.com',
    });
  });

  it('非管理员访问 P20 的接口一律 403（PRD 10.1：成员与角色、店铺数据范围只有管理员），未登录 401', async () => {
    for (const role of ['坐席', '客服主管', '售后负责人', '知识库负责人']) {
      const client = await t.loginAs(role);
      expect((await client.get('/api/org/team')).status, role).toBe(403);
      expect((await client.get('/api/org/team/candidates')).status, role).toBe(403);
      expect(
        (await addMember({ memberId: null, roles: ['agent'], stores: { all: true } }, client))
          .status,
        role,
      ).toBe(403);
      expect(
        (await save([await change(memberId('liting'), ['agent'], { all: true })], client)).status,
        role,
      ).toBe(403);
    }
    expect((await t.api.get('/api/org/team')).status).toBe(401);
  });
});

describe('从钉钉添加成员（AC-ST-06）', () => {
  it('不选人、不填角色、不选数据范围：三处一次报全，不保存、不记审计', async () => {
    const before = await t.auditRecords({ action: 'member.add' });
    const fields = await fieldErrors(await addMember({ memberId: null, roles: [], stores: null }));
    expect(fields).toEqual({
      memberId: teamMessages.memberRequired,
      roles: teamMessages.rolesRequired,
      stores: teamMessages.scopeRequired,
    });
    expect(await t.auditRecords({ action: 'member.add' })).toHaveLength(before.length);
  });

  it('选了人但不填角色或店铺范围：同样不能保存；「指定店铺」没勾店铺也不行', async () => {
    const wutong = await candidateNamed('吴桐');
    expect(
      await fieldErrors(await addMember({ memberId: wutong, roles: [], stores: { all: true } })),
    ).toEqual({
      roles: teamMessages.rolesRequired,
    });
    expect(
      await fieldErrors(await addMember({ memberId: wutong, roles: ['agent'], stores: null })),
    ).toEqual({
      stores: teamMessages.scopeRequired,
    });
    expect(
      await fieldErrors(
        await addMember({
          memberId: wutong,
          roles: ['agent'],
          stores: { all: false, storeIds: [] },
        }),
      ),
    ).toEqual({ stores: teamMessages.storesRequired });
    expect(await candidateNamed('吴桐')).toBe(wutong);
  });

  it('不能分配生产厂对接人（P20「第一阶段」）', async () => {
    const wutong = await candidateNamed('吴桐');
    expect(
      await fieldErrors(
        await addMember({ memberId: wutong, roles: ['factory_contact'], stores: { all: true } }),
      ),
    ).toEqual({ roles: teamMessages.factoryRole });
  });

  it('选人并分配角色与店铺范围：出现在成员表、不再是候选；记审计「添加成员」（前后值含角色与店铺范围）', async () => {
    const wutong = (await candidateNamed('吴桐'))!;
    const res = await addMember({
      memberId: wutong,
      roles: ['agent'],
      stores: { all: false, storeIds: [DIRECT] },
    });
    expect(res.status).toBe(201);
    const added = teamMemberSchema.parse(await res.json());
    expect(added).toMatchObject({
      id: wutong,
      name: '吴桐',
      roles: ['agent'],
      stores: { all: false, storeIds: [DIRECT] },
      status: 'active',
      lastLoginAt: null,
      changedBy: '刘洋',
      changedAt: new Date(DEMO_NOW).toISOString(),
    });
    expect((await team()).members.map((m) => m.name)).toEqual([
      '李婷',
      '陈晨',
      '吴桐',
      '周敏',
      '王磊',
      '赵倩',
      '刘洋',
    ]);
    expect(await candidateNamed('吴桐')).toBeNull();

    const [audit] = await t.auditRecords({ action: 'member.add', objectId: wutong });
    expect(audit).toMatchObject({
      actorName: '刘洋',
      actorRoles: ['admin'],
      ip: TEST_CLIENT_IP,
      objectType: 'member',
      objectLabel: '吴桐',
      storeId: null,
      before: { name: '吴桐', status: 'active', roles: [], stores: { all: false, storeIds: [] } },
      after: {
        name: '吴桐',
        status: 'active',
        roles: ['agent'],
        stores: { all: false, storeIds: [DIRECT] },
      },
    });
  });

  it('新成员登录后进入该角色的默认首页，只看到授权店铺（AC-ST-06）', async () => {
    const { client, response } = await t.scanLogin('wutong');
    expect(response.status).toBe(200);
    expect(await me(client)).toMatchObject({
      roles: ['agent'],
      stores: { all: false, storeIds: [DIRECT] },
      home: 'tickets',
    });
    expect(await storeOptions(client)).toEqual(['Forcome Direct']);
    // 最近登录随之更新
    expect((await memberOf((await me(client)).id))?.lastLoginAt).toBe(
      new Date(DEMO_NOW).toISOString(),
    );
  });

  it('开发工具「模拟回到通讯录」：角色与店铺范围清空、又成为候选（P20 的 e2e 在开发测试环境重复执行靠它）', async () => {
    const before = (await team()).members.find((m) => m.name === '吴桐')!;
    expect(before.roles).toEqual(['agent']);
    const res = await t.api.post('/api/dev/dingtalk/rejoin', { userId: 'wutong' });
    expect(res.status).toBe(200);
    expect(devDingtalkRejoinResponseSchema.parse(await res.json())).toEqual({
      memberId: before.id,
    });
    expect((await team()).members.some((m) => m.name === '吴桐')).toBe(false);
    expect(await candidateNamed('吴桐')).toBe(before.id);
    const actions = (await t.auditRecords({ objectId: before.id })).map((r) => r.action);
    expect(actions.slice(-2)).toEqual(['member.dingtalk_left', 'member.dingtalk_rejoined']);
    expect((await t.api.post('/api/dev/dingtalk/rejoin', { userId: 'nobody' })).status).toBe(404);
    // 恢复成上一条用例添加后的样子
    expect(
      (await addMember({ memberId: before.id, roles: ['agent'], stores: before.stores })).status,
    ).toBe(201);
  });

  it('已经添加过的人不能再添加（另一位管理员刚添加过）', async () => {
    const wutong = (await team()).members.find((m) => m.name === '吴桐')!.id;
    expect(
      await fieldErrors(
        await addMember({ memberId: wutong, roles: ['agent'], stores: { all: true } }),
      ),
    ).toEqual({ memberId: teamMessages.alreadyAdded('吴桐') });
  });
});

describe('修改角色与店铺范围（吸底保存栏统一保存，K6）', () => {
  it('修改后该成员下一次请求即按新权限生效：角色、店铺范围、默认首页与导航；不用重新登录', async () => {
    const zhaoqian = memberId('zhaoqian');
    const client = await t.loginAs({ member: 'zhaoqian' });
    expect(await me(client)).toMatchObject({ roles: ['knowledge_owner'], home: 'reports' });
    // 知识库负责人没有台账
    expect((await client.get('/api/aftersales/ledger')).status).toBe(403);
    expect(await storeOptions(client)).toHaveLength(fixture.stores.length);

    const res = await save([
      await change(zhaoqian, ['agent', 'knowledge_owner'], { all: false, storeIds: [FORCOME_COM] }),
    ]);
    expect(res.status).toBe(200);

    // 同一个会话，下一次请求
    expect(await me(client)).toMatchObject({
      roles: ['agent', 'knowledge_owner'],
      stores: { all: false, storeIds: [FORCOME_COM] },
      home: 'tickets',
      nav: ['tickets', 'aftersales', 'reports'],
    });
    expect((await client.get('/api/aftersales/ledger')).status).toBe(200);
    expect(await storeOptions(client)).toEqual(['forcome.com']);
    // 范围外的店铺：越权被拒并记审计（E-24）
    expect((await client.get(`/api/aftersales/ledger?store=${DIRECT}`)).status).toBe(403);
    const denied = await t.auditRecords({ action: 'access.denied' });
    expect(denied.filter((r) => r.actorId === zhaoqian)).toHaveLength(1);
  });

  it('保存返回最新的成员表；改了什么记什么审计：只改店铺范围「修改店铺范围」、只改角色「修改角色」、都改「修改角色与店铺范围」', async () => {
    const zhaoqian = memberId('zhaoqian');
    const chenchen = memberId('chenchen');
    const res = await save([
      await change(zhaoqian, ['agent', 'knowledge_owner'], { all: true }),
      await change(chenchen, ['agent', 'supervisor'], { all: true }),
    ]);
    expect(res.status).toBe(200);
    const data = teamSchema.parse(await res.json());
    expect(data.members.find((m) => m.id === zhaoqian)).toMatchObject({
      stores: { all: true },
      changedBy: '刘洋',
    });

    const [stores] = await t.auditRecords({ action: 'member.change_stores', objectId: zhaoqian });
    expect(stores).toMatchObject({
      objectLabel: '赵倩',
      before: {
        roles: ['agent', 'knowledge_owner'],
        stores: { all: false, storeIds: [FORCOME_COM] },
      },
      after: { roles: ['agent', 'knowledge_owner'], stores: { all: true } },
    });
    const [roles] = await t.auditRecords({ action: 'member.change_roles', objectId: chenchen });
    expect(roles).toMatchObject({
      before: { roles: ['agent'], stores: { all: true } },
      after: { roles: ['agent', 'supervisor'], stores: { all: true } },
    });
    const access = await t.auditRecords({ action: 'member.change_access', objectId: zhaoqian });
    expect(access).toHaveLength(1);
  });

  it('没有变化的成员不保存、不记审计、版本号不变', async () => {
    const liting = (await memberOf(memberId('liting')))!;
    const before = (await t.auditRecords({ objectId: liting.id })).length;
    expect((await save([await change(liting.id, ['agent'], { all: true })])).status).toBe(200);
    expect((await memberOf(liting.id))?.version).toBe(liting.version);
    expect(await t.auditRecords({ objectId: liting.id })).toHaveLength(before);
  });

  it('校验：角色不能清空、「指定店铺」要勾店铺、不能分配生产厂对接人；一次报全，整批都不保存', async () => {
    const liting = memberId('liting');
    const wanglei = memberId('wanglei');
    const zhoumin = memberId('zhoumin');
    const res = await save([
      await change(liting, [], { all: true }),
      await change(wanglei, ['aftersales_owner'], { all: false, storeIds: [] }),
      await change(zhoumin, ['supervisor', 'factory_contact'], { all: true }),
    ]);
    expect(await fieldErrors(res)).toEqual({
      [`${liting}.roles`]: teamMessages.rolesRequired,
      [`${wanglei}.stores`]: teamMessages.storesRequired,
      [`${zhoumin}.roles`]: teamMessages.factoryRole,
    });
    expect((await memberOf(liting))?.roles).toEqual(['agent']);
  });

  it('至少要有一位在职的管理员：去掉最后一位管理员的「管理员」角色报错，不保存', async () => {
    const liuyang = memberId('liuyang');
    expect(
      await fieldErrors(await save([await change(liuyang, ['agent'], { all: true })])),
    ).toEqual({
      [`${liuyang}.roles`]: teamMessages.lastAdmin,
    });
    // 先给另一位加上管理员，同一次保存里再去掉自己的：可以
    const zhoumin = memberId('zhoumin');
    expect(
      (
        await save([
          await change(zhoumin, ['supervisor', 'admin'], { all: true }),
          await change(liuyang, ['agent', 'admin'], { all: true }),
        ])
      ).status,
    ).toBe(200);
  });

  it('并发（G7）：有人已被别人改过时整批都不保存，返回 409；成员表给出谁、几点改的', async () => {
    const liting = memberId('liting');
    const wanglei = memberId('wanglei');
    const stale = await change(liting, ['agent'], { all: false, storeIds: [DIRECT] });
    // 周敏上一个用例里成了管理员，由她先改了李婷
    const other = await t.loginAs({ member: 'zhoumin' });
    expect(
      (await save([await change(liting, ['agent', 'supervisor'], { all: true })], other)).status,
    ).toBe(200);

    const res = await save([
      stale,
      await change(wanglei, ['aftersales_owner'], { all: false, storeIds: [DIRECT] }),
    ]);
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(await res.json()).error).toBe('optimistic_lock');
    expect((await memberOf(wanglei))?.stores).toEqual({ all: true });
    expect(await memberOf(liting)).toMatchObject({
      roles: ['agent', 'supervisor'],
      changedBy: '周敏',
      changedAt: new Date(DEMO_NOW).toISOString(),
    });
  });

  it('已停用的成员（钉钉离职）不能改；成员表里写已停用，最近一次修改人是「系统」', async () => {
    t.clients.fake(dingtalkClient).removeUser('chenchen');
    await t.runJobs();
    const chenchen = (await memberOf(memberId('chenchen')))!;
    expect(chenchen).toMatchObject({ status: 'disabled', changedBy: '系统' });
    expect(
      await fieldErrors(await save([await change(chenchen.id, ['agent'], { all: true })])),
    ).toEqual({ [`${chenchen.id}.roles`]: teamMessages.disabledMember });
  });
});
