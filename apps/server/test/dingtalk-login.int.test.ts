import {
  currentMemberSchema,
  dingtalkLoginStartSchema,
  ledgerSchema,
  loginDeniedSchema,
  loginFailedSchema,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dingtalkClient, factoryHeadUserId } from '../src/modules/integration';
import { dingtalkReconcileJob } from '../src/modules/org';
import { createApiClient } from './api-client';
import { startTestHarness, TEST_CLIENT_IP, type TestHarness } from './harness';

/*
 * 钉钉扫码登录（待办 05；G11、G12、AC-ST-06、AC-P1-21；ADR 0010）：开一次登录（state 记在 Cookie）→ 扫码确认（Fake 钉钉发授权码）
 * → 授权码与 state 换会话。扫码登录换出的是与开发登录同一种会话；被拒按 G12 的三种原因写明；失败（授权码失效、state 对不上、
 * 连不上钉钉）分别报出。
 */

let t: TestHarness;
const dingtalk = () => t.clients.fake(dingtalkClient);
const fixture = getDemoFixture();
const DIRECT = fixture.stores.find((s) => s.name === 'Forcome Direct')!.id;

beforeAll(async () => {
  t = await startTestHarness();
  await t.loadFixtures();
  dingtalk().replay(fixture);
  await t.enqueue(dingtalkReconcileJob, {});
  await t.runJobs();
});

afterAll(async () => {
  await t.close();
});

describe('扫码登录换出与开发登录同一种会话', () => {
  it('开一次登录：Fake 钉钉画示意二维码，给出这次的 state（Cookie 里也有一份）与钉钉带回的地址', async () => {
    const browser = createApiClient(
      { request: (input, init) => t.api.request(input, init) },
      { ip: TEST_CLIENT_IP },
    );
    const res = await browser.request('/api/auth/dingtalk/start', {
      method: 'POST',
      headers: { host: 'support-dev.forcome.internal:4510', 'x-forwarded-proto': 'https' },
    });
    expect(res.status).toBe(200);
    const start = dingtalkLoginStartSchema.parse(await res.json());
    expect(start).toEqual({
      mode: 'fake',
      clientId: null,
      redirectUri: 'https://support-dev.forcome.internal:4510/login/dingtalk',
      state: expect.any(String) as string,
    });
    expect(browser.cookie('forcome_login_state')).toBe(start.state);
    expect(res.headers.get('set-cookie')).toMatch(
      /Path=\/api\/auth\/dingtalk; HttpOnly; SameSite=Lax/,
    );
  });

  it('已分配角色与店铺的成员扫码后进入默认首页，只见授权店铺的数据（AC-ST-06）；审计「登录（钉钉扫码）」', async () => {
    // 新同事：先在钉钉通讯录里，管理员（P20，待办 06）给了坐席角色与 Forcome Direct 一个店铺
    const memberId = await t.addMember({
      dingtalkUserId: 'zhaolei',
      name: '赵磊',
      dept: 'FSH / 客服部',
      roles: ['agent'],
      allStores: false,
      storeIds: [DIRECT],
    });
    dingtalk().addUser({ userId: 'zhaolei', name: '赵磊', departmentIds: ['101'], email: null });
    await t.runJobs();

    const { client, response } = await t.scanLogin('zhaolei');
    expect(response.status).toBe(200);
    expect(currentMemberSchema.parse(await response.json())).toMatchObject({
      id: memberId,
      name: '赵磊',
      home: 'tickets',
      nav: ['tickets', 'aftersales'],
      stores: { all: false, storeIds: [DIRECT] },
    });
    expect(client.cookie('forcome_session')).toBeDefined();
    // state 只用一次
    expect(client.cookie('forcome_login_state')).toBeUndefined();

    // 台账（坐席只读）只有 Forcome Direct 的单
    const ledger = await client.get('/api/aftersales/ledger?from=2026-09-01&to=2026-09-30');
    expect(ledger.status).toBe(200);
    const rows = ledgerSchema.parse(await ledger.json()).items;
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.store.id))).toEqual(new Set([DIRECT]));
    const all = await (
      await t.loginAs('售后负责人')
    ).get('/api/aftersales/ledger?from=2026-09-01&to=2026-09-30');
    expect(ledgerSchema.parse(await all.json()).items.length).toBeGreaterThan(rows.length);

    expect(await t.auditRecords({ action: 'auth.login' })).toContainEqual(
      expect.objectContaining({
        actorName: '赵磊',
        objectType: 'login',
        objectLabel: '钉钉扫码',
        after: { method: 'dingtalk' },
      }),
    );
  });

  it('示例成员（钉钉用户 ID 是夹具的 key）扫码登录：客服主管进入 P04', async () => {
    const { response } = await t.scanLogin('zhoumin');
    expect(currentMemberSchema.parse(await response.json())).toMatchObject({
      name: '周敏',
      home: 'tickets',
    });
  });
});

describe('登录被拒（G12）', () => {
  it('未分配角色的钉钉用户（生产厂负责人）：写出原因与在职管理员', async () => {
    const { client, response } = await t.scanLogin(factoryHeadUserId('FQD'));
    expect(response.status).toBe(403);
    expect(loginDeniedSchema.parse(await response.json())).toMatchObject({
      reason: 'no_role',
      message: '你的钉钉账号还没有在本系统分配角色，请联系管理员刘洋。',
      member: { name: '刘厂长', dept: 'FQD', roles: [] },
    });
    expect(client.cookie('forcome_session')).toBeUndefined();
  });

  it('刚加入钉钉、还没同步进来的人扫码：当场补进成员表，按未分配角色拒绝', async () => {
    dingtalk().addUser(
      { userId: 'newcomer', name: '新同事', departmentIds: ['101'], email: null },
      { silent: true },
    );
    const { response } = await t.scanLogin('newcomer');
    expect(loginDeniedSchema.parse(await response.json())).toMatchObject({
      reason: 'no_role',
      member: { name: '新同事', dept: 'FSH / 客服部', roles: [] },
    });
  });

  it('离职事件漏了、成员表里还是在职时扫码：钉钉认不出他在本组织，当场停用并拒绝「账号已停用」', async () => {
    await t.addMember({
      dingtalkUserId: 'leaver',
      name: '要离职的人',
      dept: 'FSH / 客服部',
      roles: ['agent'],
      allStores: true,
    });
    dingtalk().addUser({
      userId: 'leaver',
      name: '要离职的人',
      departmentIds: ['101'],
      email: null,
    });
    await t.runJobs();
    expect((await t.scanLogin('leaver')).response.status).toBe(200);

    dingtalk().removeUser('leaver', { silent: true });
    const { response } = await t.scanLogin('leaver');
    expect(response.status).toBe(403);
    expect(loginDeniedSchema.parse(await response.json())).toMatchObject({
      reason: 'disabled',
      message: '你的账号已停用（钉钉离职或管理员停用）。',
    });
    expect(await t.auditRecords({ action: 'member.dingtalk_left' })).toContainEqual(
      expect.objectContaining({ objectLabel: '要离职的人' }),
    );
  });

  it('钉钉认得出、成员表里没有的人（不是本组织的，或通讯录权限范围没覆盖）：按未分配角色拒绝', async () => {
    const { response } = await t.scanLogin('stranger');
    expect(response.status).toBe(403);
    expect(loginDeniedSchema.parse(await response.json())).toEqual({
      error: 'login_denied',
      reason: 'no_role',
      message: '你的钉钉账号还没有在本系统分配角色，请联系管理员刘洋。',
    });
  });

  it('只有生产厂对接人角色（第一期，AC-P1-21）：「工厂工作台第二阶段上线，目前无法进入」，带上是谁', async () => {
    const { response } = await t.scanLogin('chengong');
    expect(response.status).toBe(403);
    expect(loginDeniedSchema.parse(await response.json())).toEqual({
      error: 'login_denied',
      reason: 'factory_phase1',
      message: '工厂工作台第二阶段上线，目前无法进入。',
      member: { name: '陈工', dept: 'FQD / 品质部', roles: ['factory_contact'] },
    });
  });

  it('会话过期：7 天无操作后受保护接口返回 session_expired（「7 天未操作，已退出登录」）', async () => {
    const { client } = await t.scanLogin('liuyang');
    t.clock.advance({ days: 7 });
    const res = await client.get('/api/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'session_expired',
      message: '7 天未操作，已退出登录',
    });
  });
});

describe('扫码登录失败', () => {
  it('授权码只能用一次：再用同一个授权码报「扫码结果已失效」', async () => {
    const browser = createApiClient(
      { request: (input, init) => t.api.request(input, init) },
      { ip: TEST_CLIENT_IP },
    );
    const start = dingtalkLoginStartSchema.parse(
      await (await browser.post('/api/auth/dingtalk/start')).json(),
    );
    const authCode = dingtalk().issueAuthCode('liting');
    expect(
      (await browser.post('/api/auth/dingtalk/login', { authCode, state: start.state })).status,
    ).toBe(200);

    const again = await browser.post('/api/auth/dingtalk/start');
    const { state } = dingtalkLoginStartSchema.parse(await again.json());
    const reused = await browser.post('/api/auth/dingtalk/login', { authCode, state });
    expect(reused.status).toBe(400);
    expect(loginFailedSchema.parse(await reused.json())).toEqual({
      error: 'login_failed',
      reason: 'code_invalid',
      message: '扫码结果已失效',
    });
  });

  it('state 对不上（没开过登录、换了浏览器、或已经用过）：「登录已过期」，不调钉钉', async () => {
    const browser = createApiClient(
      { request: (input, init) => t.api.request(input, init) },
      { ip: TEST_CLIENT_IP },
    );
    const authCode = dingtalk().issueAuthCode('liting');
    const loginCalls = () => dingtalk().faults.calls.filter((call) => call === 'login').length;
    const callsBefore = loginCalls();
    const noStart = await browser.post('/api/auth/dingtalk/login', { authCode, state: 'forged' });
    expect(loginFailedSchema.parse(await noStart.json())).toMatchObject({
      reason: 'state_mismatch',
      message: '登录已过期',
    });
    expect(noStart.status).toBe(400);

    await browser.post('/api/auth/dingtalk/start');
    const wrong = await browser.post('/api/auth/dingtalk/login', { authCode, state: 'forged' });
    expect(loginFailedSchema.parse(await wrong.json()).reason).toBe('state_mismatch');
    // 没调钉钉，授权码也没被消耗
    expect(loginCalls()).toBe(callsBefore);
    await browser.post('/api/auth/dingtalk/start');
    const { state } = dingtalkLoginStartSchema.parse(
      await (await browser.post('/api/auth/dingtalk/start')).json(),
    );
    expect((await browser.post('/api/auth/dingtalk/login', { authCode, state })).status).toBe(200);
  });

  it('连不上钉钉：502「暂时连不上钉钉」', async () => {
    dingtalk().faults.failNext({ kind: 'timeout' }, { operation: 'login' });
    const { response } = await t.scanLogin('liting');
    expect(response.status).toBe(502);
    expect(loginFailedSchema.parse(await response.json())).toMatchObject({
      reason: 'dingtalk_unavailable',
      message: '暂时连不上钉钉',
    });
  });
});
