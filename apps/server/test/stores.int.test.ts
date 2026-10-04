import {
  apiErrorSchema,
  channelSettingsSchema,
  storeOptionsSchema,
  storeSchema,
  type StoreInput,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiClient } from './api-client';
import { DEMO_NOW, startTestHarness, TEST_CLIENT_IP, type TestHarness } from './harness';

/*
 * P18 渠道与店铺：店铺表与新增 / 编辑抽屉（待办 07；PRD P18「第一阶段」、K8、K20，AC-ST-01）。
 * 店铺是来信识别店铺与订单匹配的前提：示例数据夹具的 4 个店铺作为种子；保存店铺记审计（完整前后值），
 * 并发出「店铺已变更」事件（待办 15 据此让未归属来信自动归位）。
 */

const fixtureStores = getDemoFixture().stores;
const fixtureStore = (name: string) => fixtureStores.find((s) => s.name === name)!;
const DIRECT = fixtureStore('Forcome Direct');
const MX = fixtureStore('forcome.mx');

const STORE_CHANGED = 'channel.store_changed';

/** 一个填对了的新店铺（Shopify 加拿大站），各用例在它上面改出要测的情形 */
function newStore(overrides: Partial<StoreInput> = {}): StoreInput {
  return {
    name: 'forcome.ca',
    platform: 'shopify',
    sites: ['CA'],
    defaultSite: 'CA',
    mailboxes: ['support@forcome.ca'],
    platformId: 'forcome-ca.myshopify.com',
    ...overrides,
  };
}

async function settings(client: ApiClient) {
  const res = await client.get('/api/channel/settings');
  expect(res.status).toBe(200);
  return channelSettingsSchema.parse(await res.json());
}

async function storeNames(client: ApiClient) {
  return (await settings(client)).stores.map((s) => s.name);
}

async function fieldErrors(res: Response) {
  expect(res.status).toBe(400);
  const body = apiErrorSchema.parse(await res.json());
  expect(body.error).toBe('invalid_request');
  return body.fields;
}

describe('P18 店铺表（非生产环境）', () => {
  let t: TestHarness;
  let admin: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    admin = await t.loginAs('管理员');
  });

  afterAll(async () => {
    await t.close();
  });

  it('示例数据夹具的 4 个店铺作为种子：店铺、站点与默认站点、进线邮箱、平台标识；开发测试环境接模拟数据', async () => {
    const data = await settings(admin);

    expect(data.dataSourceEditable).toBe(true);
    expect(
      data.stores.map((s) => ({
        id: s.id,
        name: s.name,
        platform: s.platform,
        sites: s.sites,
        defaultSite: s.defaultSite,
        mailboxes: s.mailboxes,
        platformId: s.platformId,
        adapterMode: s.adapterMode,
      })),
    ).toEqual([
      {
        id: DIRECT.id,
        name: 'Forcome Direct',
        platform: 'amazon',
        sites: ['US', 'CA', 'MX'],
        defaultSite: 'US',
        mailboxes: ['amz-direct@forcome.com'],
        platformId: 'A1FD7Q2M9XK3LC',
        adapterMode: 'fake',
      },
      {
        id: fixtureStore('Forcome Auto').id,
        name: 'Forcome Auto',
        platform: 'amazon',
        sites: ['US'],
        defaultSite: 'US',
        mailboxes: ['amz-auto@forcome.com'],
        platformId: 'A3KA8V1T6RW2NB',
        adapterMode: 'fake',
      },
      {
        id: fixtureStore('forcome.com').id,
        name: 'forcome.com',
        platform: 'shopify',
        sites: ['US', 'CA'],
        defaultSite: 'US',
        mailboxes: ['support@forcome.com'],
        platformId: 'forcome-com.myshopify.com',
        adapterMode: 'fake',
      },
      {
        id: MX.id,
        name: 'forcome.mx',
        platform: 'shopify',
        sites: ['MX'],
        defaultSite: 'MX',
        mailboxes: ['support@forcome.mx'],
        platformId: 'forcome-mx.myshopify.com',
        adapterMode: 'fake',
      },
    ]);
    // 店铺表「状态」列：模拟数据的连接视为已连接（K20 卡头另标「模拟数据」）
    for (const store of data.stores) {
      expect(store.connections).toEqual([
        { kind: 'gmail', status: 'connected' },
        { kind: 'orders', status: 'connected' },
      ]);
      expect(store.updatedBy).toBeNull();
    }
    // 渠道卡：亚马逊 SP-API、Shopify Admin API、Gmail、钉钉；同步记录随后续待办，暂无最近同步时间
    expect(data.channels).toEqual([
      { kind: 'amazon', status: 'connected', simulated: true, lastSyncAt: null },
      { kind: 'shopify', status: 'connected', simulated: true, lastSyncAt: null },
      { kind: 'gmail', status: 'connected', simulated: true, lastSyncAt: null },
      { kind: 'dingtalk', status: 'connected', simulated: true, lastSyncAt: null },
    ]);
  });

  it('重复灌示例数据不会重复建店铺', async () => {
    await t.loadFixtures();
    expect(await storeNames(admin)).toEqual([
      'Forcome Direct',
      'Forcome Auto',
      'forcome.com',
      'forcome.mx',
    ]);
  });

  it('只有管理员能打开 P18 与保存店铺（PRD 10.1）', async () => {
    for (const role of ['坐席', '客服主管', '售后负责人', '知识库负责人']) {
      const client = await t.loginAs(role);
      expect((await client.get('/api/channel/settings')).status).toBe(403);
      expect((await client.post('/api/channel/stores', newStore())).status).toBe(403);
      expect((await client.put(`/api/channel/stores/${MX.id}`, newStore())).status).toBe(403);
    }
    expect((await t.api.get('/api/channel/settings')).status).toBe(401);
  });

  describe('三类校验错误各自返回字段级错误，不保存（AC-ST-01、K8）', () => {
    it('店铺名重复（不分大小写、去掉首尾空白）', async () => {
      const fields = await fieldErrors(
        await admin.post('/api/channel/stores', newStore({ name: '  FORCOME.MX ' })),
      );
      expect(fields).toEqual({ name: '店铺名已存在，请换一个' });
    });

    it('平台标识为空：按平台写出该填什么', async () => {
      expect(
        await fieldErrors(await admin.post('/api/channel/stores', newStore({ platformId: ' ' }))),
      ).toEqual({ platformId: '请填写店铺域名' });
      expect(
        await fieldErrors(
          await admin.post(
            '/api/channel/stores',
            newStore({ platform: 'amazon', sites: ['CA'], platformId: '' }),
          ),
        ),
      ).toEqual({ platformId: '请填写卖家 ID' });
    });

    it('邮箱格式错误：逐个校验，错误落在那一个邮箱上', async () => {
      const fields = await fieldErrors(
        await admin.post(
          '/api/channel/stores',
          newStore({ mailboxes: ['support@forcome.ca', 'info@forcome'] }),
        ),
      );
      expect(fields).toEqual({ 'mailboxes.1': '邮箱格式不正确，例如 info@forcome.mx' });
    });

    it('三类同时出错时一次列全', async () => {
      const fields = await fieldErrors(
        await admin.post(
          '/api/channel/stores',
          newStore({ name: 'forcome.com', mailboxes: ['info@forcome'], platformId: '' }),
        ),
      );
      expect(fields).toEqual({
        name: '店铺名已存在，请换一个',
        'mailboxes.0': '邮箱格式不正确，例如 info@forcome.mx',
        platformId: '请填写店铺域名',
      });
    });

    it('进线邮箱不能与其他店铺重复（含大小写不同的写法）', async () => {
      const fields = await fieldErrors(
        await admin.post(
          '/api/channel/stores',
          newStore({ mailboxes: ['ventas@forcome.ca', 'Support@Forcome.MX'] }),
        ),
      );
      expect(fields).toEqual({ 'mailboxes.1': 'support@forcome.mx 已是 forcome.mx 的进线邮箱' });
    });

    it('以上请求都没有保存：店铺表不变、没有审计、没有发出「店铺已变更」', async () => {
      expect(await storeNames(admin)).toEqual([
        'Forcome Direct',
        'Forcome Auto',
        'forcome.com',
        'forcome.mx',
      ]);
      expect(await t.auditRecords({ objectType: 'store' })).toEqual([]);
      const report = await t.runJobs();
      expect(report.completed.filter((j) => j.name === STORE_CHANGED)).toEqual([]);
    });
  });

  describe('保存店铺', () => {
    let created: ReturnType<typeof storeSchema.parse>;

    it('新增店铺：出现在店铺表，记审计（完整后值），发出「店铺已变更」事件', async () => {
      t.clock.set('2026-09-11T10:24:00+08:00');
      const res = await admin.post(
        '/api/channel/stores',
        newStore({
          name: ' forcome.ca ',
          sites: ['US', 'CA'],
          mailboxes: [' Support@Forcome.CA ', 'ventas@forcome.ca'],
        }),
      );
      expect(res.status).toBe(201);
      created = storeSchema.parse(await res.json());
      expect(created).toMatchObject({
        name: 'forcome.ca',
        platform: 'shopify',
        sites: ['US', 'CA'],
        defaultSite: 'CA',
        mailboxes: ['support@forcome.ca', 'ventas@forcome.ca'],
        platformId: 'forcome-ca.myshopify.com',
        // 非生产环境没选数据来源时接模拟数据（ADR 0009：开发测试环境外部客户端默认 Fake）
        adapterMode: 'fake',
        version: 1,
        updatedBy: '刘洋',
      });
      expect(new Date(created.updatedAt).toISOString()).toBe('2026-09-11T02:24:00.000Z');
      expect(await storeNames(admin)).toEqual([
        'Forcome Direct',
        'Forcome Auto',
        'forcome.com',
        'forcome.mx',
        'forcome.ca',
      ]);

      const [audit, ...rest] = await t.auditRecords({ action: 'store.create' });
      expect(rest).toEqual([]);
      expect(audit).toMatchObject({
        actorType: 'member',
        actorName: '刘洋',
        actorRoles: ['admin'],
        ip: TEST_CLIENT_IP,
        objectType: 'store',
        objectId: created.id,
        objectLabel: 'forcome.ca',
        storeId: created.id,
        before: null,
        after: {
          name: 'forcome.ca',
          platform: 'shopify',
          sites: ['US', 'CA'],
          defaultSite: 'CA',
          mailboxes: ['support@forcome.ca', 'ventas@forcome.ca'],
          platformId: 'forcome-ca.myshopify.com',
          adapterMode: 'fake',
        },
      });
      expect(audit?.occurredAt.toISOString()).toBe('2026-09-11T02:24:00.000Z');

      const report = await t.runJobs();
      expect(report.completed.filter((j) => j.name === STORE_CHANGED).map((j) => j.data)).toEqual([
        { storeId: created.id, addedMailboxes: ['support@forcome.ca', 'ventas@forcome.ca'] },
      ]);
    });

    it('编辑店铺：记审计（完整前后值），新增的进线邮箱（含别名）随「店铺已变更」发出', async () => {
      t.clock.set('2026-09-11T10:30:00+08:00');
      const res = await admin.put(`/api/channel/stores/${created.id}`, {
        ...newStore({
          name: 'forcome.ca',
          sites: ['CA'],
          mailboxes: ['support@forcome.ca', 'help+ca@forcome.ca'],
          adapterMode: 'real',
        }),
        version: created.version,
      });
      expect(res.status).toBe(200);
      const updated = storeSchema.parse(await res.json());
      expect(updated).toMatchObject({
        sites: ['CA'],
        mailboxes: ['support@forcome.ca', 'help+ca@forcome.ca'],
        adapterMode: 'real',
        version: 2,
        // 真实接口的连接要等 Gmail、Shopify 客户端接上（09、11），在那之前是未连接
        connections: [
          { kind: 'gmail', status: 'not_connected' },
          { kind: 'orders', status: 'not_connected' },
        ],
      });

      const [audit] = await t.auditRecords({ action: 'store.update' });
      expect(audit).toMatchObject({
        actorName: '刘洋',
        objectId: created.id,
        objectLabel: 'forcome.ca',
        storeId: created.id,
        before: {
          name: 'forcome.ca',
          platform: 'shopify',
          sites: ['US', 'CA'],
          defaultSite: 'CA',
          mailboxes: ['support@forcome.ca', 'ventas@forcome.ca'],
          platformId: 'forcome-ca.myshopify.com',
          adapterMode: 'fake',
        },
        after: {
          name: 'forcome.ca',
          platform: 'shopify',
          sites: ['CA'],
          defaultSite: 'CA',
          mailboxes: ['support@forcome.ca', 'help+ca@forcome.ca'],
          platformId: 'forcome-ca.myshopify.com',
          adapterMode: 'real',
        },
      });

      const report = await t.runJobs();
      expect(report.completed.filter((j) => j.name === STORE_CHANGED).map((j) => j.data)).toEqual([
        { storeId: created.id, addedMailboxes: ['help+ca@forcome.ca'] },
      ]);

      // 去掉的别名不再占用：别的店铺可以登记它
      const fields = await fieldErrors(
        await admin.post(
          '/api/channel/stores',
          newStore({ name: 'forcome.us', mailboxes: ['ventas@forcome.ca'], platformId: '' }),
        ),
      );
      expect(fields).toEqual({ platformId: '请填写店铺域名' });
    });

    it('编辑时店铺名可以保持不变；改成其他店铺的名字、用其他店铺的邮箱同样报错，与表单本身的错误一次列全', async () => {
      const current = (await settings(admin)).stores.find((s) => s.id === created.id)!;
      const fields = await fieldErrors(
        await admin.put(`/api/channel/stores/${created.id}`, {
          ...newStore({
            name: 'Forcome Auto',
            mailboxes: ['amz-auto@forcome.com'],
            platformId: '',
          }),
          version: current.version,
        }),
      );
      expect(fields).toEqual({
        name: '店铺名已存在，请换一个',
        'mailboxes.0': 'amz-auto@forcome.com 已是 Forcome Auto 的进线邮箱',
        platformId: '请填写店铺域名',
      });
    });

    it('别人先保存了：带旧版本号保存返回 409，不覆盖（G7）', async () => {
      const res = await admin.put(`/api/channel/stores/${created.id}`, {
        ...newStore({ name: 'forcome.ca 旧版' }),
        version: 1,
      });
      expect(res.status).toBe(409);
      expect(apiErrorSchema.parse(await res.json()).error).toBe('optimistic_lock');
      expect(await storeNames(admin)).toContain('forcome.ca');
      expect(await t.auditRecords({ action: 'store.update' })).toHaveLength(1);
    });

    it('不存在的店铺返回 404', async () => {
      const res = await admin.put('/api/channel/stores/0199a0c0-0000-7000-8000-000000000000', {
        ...newStore(),
        version: 1,
      });
      expect(res.status).toBe(404);
    });
  });

  it('新增的店铺立即出现在各角色的店铺范围选项里；范围受限的成员只看到授权的店铺', async () => {
    const res = await admin.post(
      '/api/channel/stores',
      newStore({
        name: 'Forcome Canada',
        platform: 'amazon',
        mailboxes: ['amz-canada@forcome.com'],
        platformId: 'A9CANADA00001',
      }),
    );
    expect(res.status).toBe(201);
    const canada = storeSchema.parse(await res.json());

    for (const role of ['坐席', '客服主管', '售后负责人', '知识库负责人', '管理员']) {
      const client = await t.loginAs(role);
      const options = await client.get('/api/channel/store-options');
      expect(options.status).toBe(200);
      const { stores } = storeOptionsSchema.parse(await options.json());
      expect(stores.find((s) => s.id === canada.id)).toEqual({
        id: canada.id,
        name: 'Forcome Canada',
        platform: 'amazon',
        sites: ['CA'],
        defaultSite: 'CA',
      });
    }

    const limited = await t.addMember({
      name: '赵敏',
      dept: 'FSH / 客服部',
      roles: ['supervisor'],
      allStores: false,
      storeIds: [DIRECT.id],
    });
    const client = await t.loginAs({ memberId: limited });
    const { stores } = storeOptionsSchema.parse(
      await (await client.get('/api/channel/store-options')).json(),
    );
    expect(stores.map((s) => s.name)).toEqual(['Forcome Direct']);
    expect((await t.api.get('/api/channel/store-options')).status).toBe(401);
  });

  it('非生产环境可以选择真实接口：该店铺各连接为未连接，渠道卡显示最差状态', async () => {
    const data = await settings(admin);
    // forcome.ca 在上面改成了真实接口：Shopify 与 Gmail 卡都有一个未连接的店铺
    expect(data.channels.find((c) => c.kind === 'shopify')).toEqual({
      kind: 'shopify',
      status: 'not_connected',
      simulated: true,
      lastSyncAt: null,
    });
    expect(data.channels.find((c) => c.kind === 'gmail')?.status).toBe('not_connected');
    expect(data.channels.find((c) => c.kind === 'amazon')?.status).toBe('connected');
  });
});

describe('P18 店铺表（生产环境配置）', () => {
  let t: TestHarness;
  let admin: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness({ appEnv: 'production', now: DEMO_NOW });
    admin = await t.loginAs('管理员');
  });

  afterAll(async () => {
    await t.close();
  });

  it('上线初期没有店铺；不显示「数据来源」，渠道卡都是未连接、不标模拟数据', async () => {
    const data = await settings(admin);
    expect(data.stores).toEqual([]);
    expect(data.dataSourceEditable).toBe(false);
    expect(data.channels.map((c) => [c.kind, c.status, c.simulated])).toEqual([
      ['amazon', 'not_connected', false],
      ['shopify', 'not_connected', false],
      ['gmail', 'not_connected', false],
      ['dingtalk', 'not_connected', false],
    ]);
  });

  it('提交「模拟数据」被拒绝，不保存', async () => {
    const fields = await fieldErrors(
      await admin.post('/api/channel/stores', newStore({ adapterMode: 'fake' })),
    );
    expect(fields).toEqual({ adapterMode: '生产环境不能使用模拟数据' });
    expect((await settings(admin)).stores).toEqual([]);
    expect(await t.auditRecords({ objectType: 'store' })).toEqual([]);
  });

  it('不传数据来源时为真实接口；编辑时同样不接受「模拟数据」', async () => {
    const res = await admin.post('/api/channel/stores', newStore());
    expect(res.status).toBe(201);
    const store = storeSchema.parse(await res.json());
    expect(store.adapterMode).toBe('real');

    const fields = await fieldErrors(
      await admin.put(`/api/channel/stores/${store.id}`, {
        ...newStore({ adapterMode: 'fake' }),
        version: store.version,
      }),
    );
    expect(fields).toEqual({ adapterMode: '生产环境不能使用模拟数据' });
  });
});
