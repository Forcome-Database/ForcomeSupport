import {
  channelSettingsSchema,
  devMembersResponseSchema,
  loginDeniedSchema,
  notificationListSchema,
  type ChannelCard,
  type DevMember,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendWorkNotificationsJob } from '../src/modules/core';
import { dingtalkClient, factoryHeadUserId } from '../src/modules/integration';
import { dingtalkReconcileJob } from '../src/modules/org';
import type { ApiClient } from './api-client';
import { DEMO_NOW, startTestHarness, type TestHarness } from './harness';
import type { RunJobsOptions } from './run-jobs';

/*
 * 钉钉通讯录同步（待办 05；规格 org「钉钉 Stream 通讯录事件 + 每小时全量对账，同步成员与部门（只读）」、PRD D-16、6.9、E-32、
 * AC-ST-05、AC-P1-22）：Fake 钉钉的通讯录与 Stream 事件 → 跑完任务（每轮先拉 Stream）→ 经接口看成员（开发登录的成员列表、
 * /api/me）、P18 钉钉卡、站内通知与审计。全量对账在测试里用 t.enqueue 显式排一次（定时任务测试不跑）。
 * 同一个库上的用例按顺序进行，通讯录与成员的变化前后相接。
 */

let t: TestHarness;
const dingtalk = () => t.clients.fake(dingtalkClient);

async function reconcile(options?: RunJobsOptions) {
  await t.enqueue(dingtalkReconcileJob, {});
  return t.runJobs(options);
}

/** 在职成员（开发登录列出的就是成员表里的在职成员，含通讯录同步进来、还没有角色的） */
async function activeMembers(): Promise<DevMember[]> {
  const res = await t.api.get('/api/dev/members');
  return devMembersResponseSchema.parse(await res.json()).members;
}

async function memberNamed(name: string): Promise<DevMember | undefined> {
  return (await activeMembers()).find((m) => m.name === name);
}

/** 通讯录里某个部门的钉钉 ID（按「FSH / 客服部」这样的路径找） */
async function departmentId(path: string): Promise<string> {
  const { departments } = await dingtalk().client().readDirectory();
  const byId = new Map(departments.map((d) => [d.id, d]));
  const pathOf = (id: string): string => {
    const d = byId.get(id);
    if (!d || d.parentId === null) return '';
    const parent = pathOf(d.parentId);
    return parent ? `${parent} / ${d.name}` : d.name;
  };
  const found = departments.find((d) => pathOf(d.id) === path);
  if (!found) throw new Error(`通讯录里没有部门 ${path}`);
  return found.id;
}

async function dingtalkCard(admin: ApiClient): Promise<ChannelCard> {
  const res = await admin.get('/api/channel/settings');
  const card = channelSettingsSchema
    .parse(await res.json())
    .channels.find((c) => c.kind === 'dingtalk');
  if (!card) throw new Error('没有钉钉卡');
  return card;
}

async function notificationsOf(client: ApiClient) {
  const res = await client.get('/api/notifications');
  return notificationListSchema.parse(await res.json()).items;
}

/** 某人收到的钉钉同步失败提醒（新的在前）；给了 seen 时只列之后新来的 */
async function syncFailures(client: ApiClient, seen: ReadonlySet<string> = new Set()) {
  return (await notificationsOf(client)).filter(
    (n) => n.type === 'dingtalk_sync_failed' && !seen.has(n.id),
  );
}

beforeAll(async () => {
  t = await startTestHarness();
  dingtalk().replay(getDemoFixture());
  await reconcile();
});

afterAll(async () => {
  await t.close();
});

describe('全量对账：钉钉通讯录里的人都同步成成员', () => {
  it('示例成员按钉钉用户 ID 对上、不重复建；两家生产厂的负责人作为没有角色的成员进来', async () => {
    const members = await activeMembers();
    for (const fixture of getDemoFixture().members) {
      expect(members.filter((m) => m.name === fixture.name)).toEqual([
        expect.objectContaining({ id: fixture.id, dept: fixture.dept }),
      ]);
    }
    expect(members.find((m) => m.name === '刘厂长')).toMatchObject({ dept: 'FQD', roles: [] });
    expect(members.find((m) => m.name === '周厂长')).toMatchObject({ dept: 'FZJ', roles: [] });
  });

  it('P18 钉钉卡：最近同步时间为这次对账的时间，已连接（模拟数据）', async () => {
    const admin = await t.loginAs('管理员');
    expect(await dingtalkCard(admin)).toEqual({
      kind: 'dingtalk',
      status: 'connected',
      simulated: true,
      lastSyncAt: new Date(DEMO_NOW).toISOString(),
    });
  });
});

describe('Stream 通讯录事件：新增、变更、离职分别反映到成员与部门', () => {
  it('新增：新部门与新成员（没有角色），部门显示为从组织下第一级起的路径', async () => {
    const fsh = await departmentId('FSH');
    dingtalk().addDepartment({ id: '300', name: '物流部', parentId: fsh });
    dingtalk().addUser({
      userId: 'sunyue',
      name: '孙悦',
      departmentIds: ['300'],
      email: 'sunyue@forcome.com',
    });
    // 新部门的事件漏了（只改了通讯录）：处理成员事件时向钉钉取来
    dingtalk().addDepartment({ id: '301', name: '仓储部', parentId: fsh }, { silent: true });
    dingtalk().addUser({ userId: 'qianfeng', name: '钱峰', departmentIds: ['301'], email: null });
    await t.runJobs();

    expect(await memberNamed('孙悦')).toMatchObject({ dept: 'FSH / 物流部', roles: [] });
    expect(await memberNamed('钱峰')).toMatchObject({ dept: 'FSH / 仓储部', roles: [] });
    expect(dingtalk().unacknowledged).toBe(0);
  });

  it('变更：改名后已登录的会话里也是新名字；部门改名后该部门的成员显示跟着变', async () => {
    const liting = await t.loginAs({ member: 'liting' });
    dingtalk().updateUser('liting', { name: '李婷婷' });
    dingtalk().updateDepartment(await departmentId('FSH / 售后部'), { name: '售后服务部' });
    await t.runJobs();

    expect(await (await liting.get('/api/me')).json()).toMatchObject({ name: '李婷婷' });
    expect(await memberNamed('王磊')).toMatchObject({ dept: 'FSH / 售后服务部' });
    // 改的只是通讯录资料，角色不变
    expect(await memberNamed('李婷婷')).toMatchObject({ roles: ['agent'] });
  });

  it('离职（AC-ST-05）：立即停用，现有会话立即失效；再扫码登录被拒「账号已停用」；审计「钉钉离职停用」（系统）', async () => {
    const chenchen = await t.loginAs({ member: 'chenchen' });
    expect((await chenchen.get('/api/me')).status).toBe(200);

    dingtalk().removeUser('chenchen');
    await t.runJobs();

    expect((await chenchen.get('/api/me')).status).toBe(401);
    expect(await memberNamed('陈晨')).toBeUndefined();
    // 离职的人在本组织里没有用户 ID 了：钉钉只认得出 unionid，按它认出是陈晨
    const { response } = await t.scanLogin('chenchen');
    expect(response.status).toBe(403);
    expect(loginDeniedSchema.parse(await response.json())).toMatchObject({
      reason: 'disabled',
      message: '你的账号已停用（钉钉离职或管理员停用）。',
    });
    expect(await t.auditRecords({ action: 'member.dingtalk_left' })).toEqual([
      expect.objectContaining({
        actorType: 'system',
        actorName: '系统',
        objectType: 'member',
        objectLabel: '陈晨',
        before: expect.objectContaining({ status: 'active', roles: ['agent'] }) as unknown,
        after: expect.objectContaining({ status: 'disabled', roles: ['agent'] }) as unknown,
      }),
    ]);
  });

  it('激活与部门删除：激活事件同样取最新的样子；部门删掉后，改挂别的部门的成员显示跟着变', async () => {
    // 物流部撤销：孙悦先在钉钉里改挂到 FSH（这次没推事件），再删部门、他激活钉钉
    dingtalk().updateUser(
      'sunyue',
      { departmentIds: [await departmentId('FSH')] },
      { silent: true },
    );
    dingtalk().removeDepartment('300');
    dingtalk().activateUser('sunyue');
    await t.runJobs();
    expect(await memberNamed('孙悦')).toMatchObject({ dept: 'FSH', roles: [] });
    expect(dingtalk().unacknowledged).toBe(0);
  });

  it('同一个人离职后重新入职、钉钉给了新的用户 ID：按 unionid 认作同一个人，恢复在职（角色清空），不另建一份', async () => {
    dingtalk().removeUser('qianfeng');
    await t.runJobs();
    expect(await memberNamed('钱峰')).toBeUndefined();
    dingtalk().addUser({
      userId: 'qianfeng-2',
      unionId: 'union-qianfeng',
      name: '钱峰',
      departmentIds: [await departmentId('FSH / 仓储部')],
      email: null,
    });
    await t.runJobs();
    expect((await activeMembers()).filter((m) => m.name === '钱峰')).toEqual([
      expect.objectContaining({ dept: 'FSH / 仓储部', roles: [] }),
    ]);
    expect(await t.auditRecords({ action: 'member.dingtalk_rejoined' })).toContainEqual(
      expect.objectContaining({ objectLabel: '钱峰' }),
    );
    // 之后对账：新的用户 ID 在通讯录里，不当成离职
    await reconcile();
    expect(await memberNamed('钱峰')).toBeDefined();
  });

  it('用户 ID 给了另一个人（unionid 不同）：旧成员按钉钉离职停用并解绑，新人另建、没有角色，不接手旧成员的角色', async () => {
    await t.addMember({
      dingtalkUserId: 'reused-id',
      name: '老员工',
      dept: 'FSH / 客服部',
      roles: ['agent'],
      allStores: true,
    });
    dingtalk().addUser({
      userId: 'reused-id',
      unionId: 'union-old-staff',
      name: '老员工',
      departmentIds: [await departmentId('FSH / 客服部')],
      email: null,
    });
    await t.runJobs();
    expect(await memberNamed('老员工')).toMatchObject({ roles: ['agent'] });

    // 老员工离职的事件漏了；钉钉把这个用户 ID 给了新来的人
    dingtalk().removeUser('reused-id', { silent: true });
    dingtalk().addUser({
      userId: 'reused-id',
      unionId: 'union-new-staff',
      name: '新员工',
      departmentIds: [await departmentId('FSH / 客服部')],
      email: null,
    });
    await t.runJobs();
    expect(await memberNamed('老员工')).toBeUndefined();
    expect(await memberNamed('新员工')).toMatchObject({ dept: 'FSH / 客服部', roles: [] });
    expect(await t.auditRecords({ action: 'member.dingtalk_left' })).toContainEqual(
      expect.objectContaining({ objectLabel: '老员工' }),
    );
    // 之后对账两人都对得上，不再变化
    await reconcile();
    expect(await memberNamed('老员工')).toBeUndefined();
    expect(await memberNamed('新员工')).toBeDefined();
  });

  it('离职没同步到就换了新的用户 ID 重新入职：按离职后又回来处理，恢复在职但角色清空', async () => {
    await t.addMember({
      dingtalkUserId: 'rehire-1',
      name: '回来的人',
      dept: 'FSH / 客服部',
      roles: ['supervisor'],
      allStores: true,
    });
    dingtalk().addUser({
      userId: 'rehire-1',
      unionId: 'union-rehire',
      name: '回来的人',
      departmentIds: [await departmentId('FSH / 客服部')],
      email: null,
    });
    await t.runJobs();
    dingtalk().removeUser('rehire-1', { silent: true });
    dingtalk().addUser({
      userId: 'rehire-2',
      unionId: 'union-rehire',
      name: '回来的人',
      departmentIds: [await departmentId('FSH / 客服部')],
      email: null,
    });
    await t.runJobs();
    expect((await activeMembers()).filter((m) => m.name === '回来的人')).toEqual([
      expect.objectContaining({ roles: [] }),
    ]);
    const audits = async (action: 'member.dingtalk_left' | 'member.dingtalk_rejoined') =>
      (await t.auditRecords({ action })).filter((r) => r.objectLabel === '回来的人');
    expect(await audits('member.dingtalk_left')).toHaveLength(1);
    expect(await audits('member.dingtalk_rejoined')).toHaveLength(1);
  });

  it('断线期间漏掉的离职事件，由每小时的全量对账补上', async () => {
    dingtalk().removeUser('zhaoqian', { silent: true });
    await t.runJobs();
    expect(await memberNamed('赵倩')).toBeDefined();

    await reconcile();
    expect(await memberNamed('赵倩')).toBeUndefined();
  });

  it('钉钉离职停用的又回到通讯录：恢复在职，但角色与店铺范围清空，扫码登录「未分配角色」；审计「钉钉恢复在职」', async () => {
    dingtalk().addUser({
      userId: 'chenchen',
      name: '陈晨',
      departmentIds: [await departmentId('FSH / 客服部')],
      email: 'chenchen@forcome.com',
    });
    await t.runJobs();

    expect(await memberNamed('陈晨')).toMatchObject({ roles: [] });
    const { response } = await t.scanLogin('chenchen');
    expect(response.status).toBe(403);
    expect(loginDeniedSchema.parse(await response.json())).toMatchObject({ reason: 'no_role' });
    expect(
      (await t.auditRecords({ action: 'member.dingtalk_rejoined' })).filter(
        (r) => r.objectLabel === '陈晨',
      ),
    ).toEqual([
      expect.objectContaining({
        actorType: 'system',
        before: expect.objectContaining({ status: 'disabled', roles: ['agent'] }) as unknown,
        after: expect.objectContaining({ status: 'active', roles: [] }) as unknown,
      }),
    ]);
  });

  it('管理员停用的成员（不是钉钉离职）不随通讯录恢复', async () => {
    await t.addMember({
      dingtalkUserId: 'manual-off',
      name: '停用的人',
      dept: 'FSH / 客服部',
      roles: ['agent'],
      allStores: true,
      status: 'disabled',
    });
    dingtalk().addUser(
      { userId: 'manual-off', name: '停用的人', departmentIds: ['300'], email: null },
      { silent: true },
    );
    await reconcile();
    expect(await memberNamed('停用的人')).toBeUndefined();
  });
});

describe('同步失败（E-32、AC-P1-22）：保留上次的成员与部门，只提醒管理员，不出全站横幅', () => {
  it('通讯录一个人都没有时不同步（多半是权限范围没配好），不会把所有人停用', async () => {
    const before = await activeMembers();
    const directory = await dingtalk().client().readDirectory();
    dingtalk().reset();
    const report = await reconcile({ allowFailures: true });
    expect(report.failed.map((f) => f.name)).toEqual(['org.dingtalk_reconcile']);
    expect(await activeMembers()).toEqual(before);
    // 恢复通讯录，记一次成功，失败计数清零
    for (const department of directory.departments) {
      dingtalk().addDepartment(department, { silent: true });
    }
    for (const user of directory.users) dingtalk().addUser(user, { silent: true });
    await reconcile();
  });

  it('每个整点对账一次、失败不重试：第 1 次提醒「钉钉同步失败」，超过 2 小时为同步延迟（K20），连续 3 次为连接异常并再提醒「钉钉连接异常」；成员不变，登录照常', async () => {
    const admin = await t.loginAs('管理员');
    const supervisor = await t.loginAs('客服主管');
    const before = await activeMembers();
    const syncedAt = (await dingtalkCard(admin)).lastSyncAt;
    // 上一个用例（通讯录为空）已经提醒过一次：只看这一轮新来的
    const seen = new Set((await syncFailures(admin)).map((n) => n.id));
    // 王磊在钉钉里离职了，但同步一直失败：成员表保持上次的结果
    dingtalk().removeUser('wanglei', { silent: true });
    dingtalk().faults.failNext(
      { kind: 'error', status: 500 },
      { operation: 'directory', times: 4 },
    );

    // 1 小时后的整点：第 1 次失败
    t.clock.advance({ hours: 1 });
    await reconcile({ allowFailures: true });
    expect(await activeMembers()).toEqual(before);
    expect(await syncFailures(admin, seen)).toEqual([
      expect.objectContaining({
        title: '钉钉同步失败',
        body: '通讯录同步失败，成员与部门保持上次结果，登录与权限不受影响',
        object: { type: 'channel', id: 'dingtalk', label: 'P18 · 钉钉' },
      }),
    ]);
    // 只提醒管理员（11.4）
    expect(await syncFailures(supervisor)).toEqual([]);
    expect(await dingtalkCard(admin)).toMatchObject({ status: 'connected', lastSyncAt: syncedAt });

    // 再 1 小时：第 2 次失败，不再提醒；上次成功正好 2 小时前，还算已连接
    t.clock.advance({ hours: 1 });
    await reconcile({ allowFailures: true });
    expect(await syncFailures(admin, seen)).toHaveLength(1);
    expect((await dingtalkCard(admin)).status).toBe('connected');
    // 超过 2 小时没同步成功：同步延迟（K20「最近同步 08:00，超过 2 小时」）
    t.clock.advance({ minutes: 12 });
    expect(await dingtalkCard(admin)).toMatchObject({ status: 'delayed', lastSyncAt: syncedAt });

    // 下一个整点：连续第 3 次失败，连接异常
    t.clock.advance({ minutes: 48 });
    await reconcile({ allowFailures: true });
    expect(await dingtalkCard(admin)).toMatchObject({ status: 'error', lastSyncAt: syncedAt });
    expect((await syncFailures(admin, seen)).map((n) => [n.title, n.body])).toEqual([
      ['钉钉连接异常', '通讯录连续 3 次同步失败，成员与部门保持上次结果，登录与权限不受影响'],
      ['钉钉同步失败', '通讯录同步失败，成员与部门保持上次结果，登录与权限不受影响'],
    ]);
    expect(await activeMembers()).toEqual(before);

    // 再下一个整点：连续第 4 次失败，不再重复提醒（只在第 1 次与第 3 次提醒，2026-10-06 用户确认）
    t.clock.advance({ hours: 1 });
    await reconcile({ allowFailures: true });
    expect((await dingtalkCard(admin)).status).toBe('error');
    expect((await syncFailures(admin, seen)).map((n) => n.title)).toEqual([
      '钉钉连接异常',
      '钉钉同步失败',
    ]);

    // 不出全站横幅：横幅跟着「渠道连接异常」（钉钉除外，6.9），这里一条都没有；钉钉同步失败也只发站内，不发钉钉工作通知
    for (const client of [admin, supervisor]) {
      expect(
        (await notificationsOf(client)).filter((n) => n.type === 'channel_disconnected'),
      ).toEqual([]);
    }
    t.clock.advance({ minutes: 6 });
    await t.enqueue(sendWorkNotificationsJob, {});
    await t.runJobs();
    expect(dingtalk().sent).toEqual([]);

    // 登录与权限不受影响：开发登录、扫码登录照常
    expect((await (await t.loginAs('坐席')).get('/api/me')).status).toBe(200);
    expect((await t.scanLogin('zhoumin')).response.status).toBe(200);
  });

  it('恢复后自动补同步：卡片回到已连接，漏掉的离职一并处理，失败计数清零；恢复不发提醒', async () => {
    const admin = await t.loginAs('管理员');
    const beforeRecovery = new Set((await syncFailures(admin)).map((n) => n.id));
    await reconcile();
    // 11.4 没有钉钉恢复这一类（2026-10-06 用户确认）
    expect(await syncFailures(admin, beforeRecovery)).toEqual([]);
    expect(await dingtalkCard(admin)).toMatchObject({
      status: 'connected',
      lastSyncAt: t.clock.now().toISOString(),
    });
    expect(await memberNamed('王磊')).toBeUndefined();

    // 之后再失败一次，又从第 1 次算起
    const seen = new Set((await syncFailures(admin)).map((n) => n.id));
    dingtalk().faults.failNext({ kind: 'timeout' }, { operation: 'directory' });
    await reconcile({ allowFailures: true });
    expect((await dingtalkCard(admin)).status).toBe('connected');
    expect((await syncFailures(admin, seen)).map((n) => n.title)).toEqual(['钉钉同步失败']);
  });

  it('超过 2 小时没有同步成功为同步延迟（6.9），再同步成功回到已连接', async () => {
    const admin = await t.loginAs('管理员');
    await reconcile();
    t.clock.advance({ hours: 2 });
    expect((await dingtalkCard(admin)).status).toBe('connected');
    t.clock.advance({ minutes: 1 });
    expect((await dingtalkCard(admin)).status).toBe('delayed');
    await reconcile();
    expect((await dingtalkCard(admin)).status).toBe('connected');
  });
});

describe('开发测试环境：重灌示例数据恢复示例成员（联调真实钉钉后切回 Fake，docs/部署说明.md 第 11.2 节）', () => {
  it('被钉钉离职停用的、回到通讯录后角色被清空的示例成员，恢复成示例数据的角色；其他人不动', async () => {
    // 前面的用例里：王磊离职停用，陈晨回到通讯录后没有角色
    expect(await memberNamed('王磊')).toBeUndefined();
    expect(await memberNamed('陈晨')).toMatchObject({ roles: [] });
    await t.loadFixtures();
    expect(await memberNamed('王磊')).toMatchObject({ roles: ['aftersales_owner'] });
    expect(await memberNamed('陈晨')).toMatchObject({ roles: ['agent'] });
    // 不是示例成员的不动
    expect(await memberNamed('孙悦')).toMatchObject({ roles: [] });
  });
});

describe('示例数据：两家生产厂负责人的钉钉用户 ID', () => {
  it('取 factory-head-<厂代码>', () => {
    expect(factoryHeadUserId('FQD')).toBe('factory-head-fqd');
  });
});
