import {
  auditLogSchema,
  channelAlertsSchema,
  channelSettingsSchema,
  connectionTestResultSchema,
  notificationListSchema,
  type ChannelCard,
  type ConnectionStatus,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gmailPollJob, listOrderStores } from '../src/modules/channel';
import { memberStoreScope, sendWorkNotificationsJob } from '../src/modules/core';
import {
  dingtalkClient,
  gmailClient,
  shopifyClient,
  type FakeShopify,
  type FakeShopifyOrderInput,
} from '../src/modules/integration';
import { findOrder, findOrdersByEmail, shopifyPollJob } from '../src/modules/order';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * Shopify 订单镜像（待办 11；规格 order「Shopify：Admin GraphQL」「对外接口」，PRD 6.9、E-01、11.4、G4、K20、P27「第一阶段」，R-ST-03）：
 * 往 Fake Shopify 放订单、注入故障 → 推进时钟、跑每分钟的同步 → 经 order 的对外接口（测试工具 t.findOrder / t.ordersByEmail）
 * 核对镜像，以管理员、客服主管、坐席的身份看 P18 的 Shopify 卡与店铺表、全站横幅、站内通知、钉钉工作通知与审计。
 * 同一个库上的用例按顺序进行，时钟前后相接。
 */

const stores = getDemoFixture().stores;
const COM = stores.find((s) => s.name === 'forcome.com')!;
const MX = stores.find((s) => s.name === 'forcome.mx')!;
const DIRECT = stores.find((s) => s.name === 'Forcome Direct')!;

let t: TestHarness;
let shopify: FakeShopify;
let admin: ApiClient;
let supervisor: ApiClient;
let agent: ApiClient;

async function settings(client: ApiClient = admin) {
  const res = await client.get('/api/channel/settings');
  expect(res.status).toBe(200);
  return channelSettingsSchema.parse(await res.json());
}

async function shopifyCard(): Promise<ChannelCard> {
  const card = (await settings()).channels.find((c) => c.kind === 'shopify');
  if (!card) throw new Error('没有 Shopify 卡');
  return card;
}

/** 店铺表「状态」列里该店铺的订单（Admin API）状态 */
async function storeOrdersStatus(name: string): Promise<ConnectionStatus | undefined> {
  const store = (await settings()).stores.find((s) => s.name === name);
  return store?.connections.find((c) => c.kind === 'orders')?.status;
}

async function alerts(client: ApiClient) {
  const res = await client.get('/api/channel/alerts');
  expect(res.status).toBe(200);
  return channelAlertsSchema.parse(await res.json()).alerts;
}

/** 示例数据里已有的通知（G10 的示例）：只看测试里新产生的 */
const demoNotices = new Set<string>();

async function noticeItems(client: ApiClient) {
  const res = await client.get('/api/notifications');
  return notificationListSchema.parse(await res.json()).items;
}

/** 某人收到的渠道连接异常与恢复通知（新的在前，不含示例数据里的） */
async function channelNotices(client: ApiClient) {
  return (await noticeItems(client))
    .filter((n) => n.type === 'channel_disconnected' || n.type === 'channel_recovered')
    .filter((n) => !demoNotices.has(n.id))
    .map((n) => ({ type: n.type, title: n.title, body: n.body, object: n.object }));
}

/** 每分钟的增量同步：给每个 Shopify 店铺排一次同步再跑完 */
async function pollShopify(options: { allowFailures?: boolean } = {}) {
  await t.enqueue(shopifyPollJob, {});
  return t.runJobs(options);
}

/** 镜像里这位客户在该店铺的订单名（每笔测试订单的邮箱各不相同：核对「不产生重复行」） */
async function namesByEmail(storeId: string, email: string | null): Promise<(string | null)[]> {
  return (await t.ordersByEmail(storeId, email ?? '')).map((o) => o.name);
}

let orderNo = 2000;
/** 一笔 Shopify 订单，平台更新时间为此刻 */
function order(overrides: Partial<FakeShopifyOrderInput> = {}): FakeShopifyOrderInput {
  orderNo += 1;
  return {
    name: `#${orderNo}`,
    email: `buyer${orderNo}@example.com`,
    updatedAt: t.clock.now(),
    ...overrides,
  };
}

beforeAll(async () => {
  t = await startTestHarness();
  await t.loadFixtures();
  shopify = t.clients.fake(shopifyClient);
  // 钉钉的示例通讯录：工作通知发给成员
  t.clients.fake(dingtalkClient).replay(getDemoFixture());
  admin = await t.loginAs('管理员');
  supervisor = await t.loginAs('客服主管');
  agent = await t.loginAs('坐席');
  for (const client of [admin, supervisor, agent]) {
    for (const item of await noticeItems(client)) demoNotices.add(item.id);
  }
});

afterAll(async () => {
  await t.close();
});

describe('Shopify 订单镜像', () => {
  it('还没同步过为未连接；第一次同步后 Shopify 卡与两个店铺为已连接，卡上写最近同步时间（6.9、K20）', async () => {
    expect(await shopifyCard()).toMatchObject({
      status: 'not_connected',
      simulated: true,
      lastSyncAt: null,
      issues: [],
    });
    expect(await storeOrdersStatus(COM.name)).toBe('not_connected');

    await pollShopify();
    expect(await shopifyCard()).toMatchObject({
      status: 'connected',
      lastSyncAt: t.clock.now().toISOString(),
      issues: [],
    });
    expect(await storeOrdersStatus(COM.name)).toBe('connected');
    expect(await storeOrdersStatus(MX.name)).toBe('connected');
    // 亚马逊店铺的订单按自己的同步记录（待办 12），Shopify 的同步不影响它（这里还没同步过，为未连接）
    expect(await storeOrdersStatus(DIRECT.name)).toBe('not_connected');
  });

  it('增量拉取写入镜像（含分页）；重复拉取不产生重复行；订单更新后镜像跟着更新、仍是一行', async () => {
    t.clock.advance({ minutes: 1 });
    const first = shopify.put(COM.id, order({ email: 'Olivia.Turner@Example.com' }));
    // 一次 60 笔：Fake 每页 50 笔，两页
    const many = Array.from({ length: 60 }, () => shopify.put(MX.id, order()));
    t.clock.advance({ minutes: 1 });
    await pollShopify();

    const mirrored = await t.findOrder(COM.id, { name: first.name });
    expect(mirrored).toMatchObject({
      storeId: COM.id,
      platform: 'shopify',
      platformOrderId: first.id,
      name: first.name,
      status: 'UNFULFILLED',
      financialStatus: 'PAID',
      total: { amount: '54.99', currency: 'USD' },
      customerEmail: 'olivia.turner@example.com',
      platformUpdatedAt: first.updatedAt,
    });
    const eachOnce = async () => {
      expect(await namesByEmail(COM.id, first.email)).toEqual([first.name]);
      for (const o of many) expect(await namesByEmail(MX.id, o.email)).toEqual([o.name]);
    };
    await eachOnce();

    // 下一分钟再拉（水位前 2 分钟起重叠，同一批订单又拉到一遍）：不重复
    t.clock.advance({ minutes: 1 });
    await pollShopify();
    await eachOnce();

    // 订单发货：平台更新时间前进，镜像改成新版本
    const shipped = shopify.put(COM.id, {
      ...first,
      fulfillmentStatus: 'FULFILLED',
      tracking: [{ company: 'UPS', number: '1Z999' }],
      shippingAddress: {
        name: 'Olivia Turner',
        address1: '1550 Larimer St',
        address2: null,
        city: 'Denver',
        province: 'CO',
        zip: '80202',
        country: 'CA',
        phone: null,
      },
      updatedAt: t.clock.now(),
    });
    t.clock.advance({ minutes: 1 });
    await pollShopify();
    expect(await t.findOrder(COM.id, { platformOrderId: first.id })).toMatchObject({
      status: 'FULFILLED',
      tracking: [{ company: 'UPS', number: '1Z999' }],
      shipCountry: 'CA',
      platformUpdatedAt: shipped.updatedAt,
    });
    expect(await namesByEmail(COM.id, first.email)).toEqual([first.name]);

    // 只进不退：重叠窗口里拉到一个更旧的版本（平台搜索索引滞后），镜像不改回去
    shopify.put(COM.id, {
      ...shipped,
      fulfillmentStatus: 'UNFULFILLED',
      updatedAt: new Date(shipped.updatedAt.getTime() - 30_000),
    });
    t.clock.advance({ minutes: 1 });
    await pollShopify();
    expect(await t.findOrder(COM.id, { platformOrderId: first.id })).toMatchObject({
      status: 'FULFILLED',
      platformUpdatedAt: shipped.updatedAt,
    });
  });

  it('镜像中没有的订单名触发补拉并入库；再查不再补拉；平台也没有的为空；亚马逊店铺不按订单名补拉', async () => {
    // 上线前的历史订单（回补随 13）：平台更新时间早于水位，增量拉不到
    const old = shopify.put(COM.id, {
      name: '#1063',
      email: 'olivia.t@example.com',
      updatedAt: new Date('2026-08-09T08:45:00Z'),
      createdAt: new Date('2026-08-05T05:30:00Z'),
    });
    await pollShopify();
    expect(await namesByEmail(COM.id, old.email)).toEqual([]);

    const calls = () => shopify.faultsOf(COM.id).calls.filter((c) => c === 'order_by_name').length;
    // 来信里常写成「order 1063」：补上 # 再找
    expect(await t.findOrder(COM.id, { name: '1063' })).toMatchObject({
      platformOrderId: old.id,
      name: '#1063',
      placedAt: old.createdAt,
    });
    expect(calls()).toBe(1);
    expect(await namesByEmail(COM.id, old.email)).toEqual(['#1063']);
    // 已在镜像里：不再调平台
    expect(await t.findOrder(COM.id, { name: '#1063' })).toMatchObject({ platformOrderId: old.id });
    expect(calls()).toBe(1);
    // 订单名在该店铺内匹配：别的店铺没有这笔
    expect(await t.findOrder(MX.id, { name: '#1063' })).toBeNull();
    // 平台也没有：为空，镜像不变
    expect(await t.findOrder(COM.id, { name: '#9999' })).toBeNull();
    expect(await namesByEmail(COM.id, old.email)).toEqual(['#1063']);
    // 店铺范围外（ADR 0010）：只授权 forcome.mx 的范围查不到 forcome.com 的订单，也不去平台补拉
    const onlyMx = memberStoreScope({ allStores: false, storeIds: [MX.id] });
    const comStore = (await listOrderStores(t.runtime.db)).find((s) => s.id === COM.id)!;
    const before = calls();
    expect(await findOrder(t.runtime, t.clients, onlyMx, comStore, { name: '#1063' })).toBeNull();
    expect(await findOrder(t.runtime, t.clients, onlyMx, comStore, { name: '#4242' })).toBeNull();
    expect(calls()).toBe(before);
    expect(
      await findOrdersByEmail(t.runtime.db, onlyMx, { storeId: COM.id, email: old.email ?? '' }),
    ).toEqual([]);
    // 亚马逊店铺不调 Shopify（亚马逊按订单号 getOrder 补拉随 12）
    expect(await t.findOrder(DIRECT.id, { name: '#1063' })).toBeNull();
    expect(shopify.faultsOf(DIRECT.id).calls).toEqual([]);
  });

  it('邮箱反查只在指定店铺内匹配，不分大小写（R-ST-03）', async () => {
    const email = 'same.buyer@example.com';
    t.clock.advance({ minutes: 1 });
    const inCom = shopify.put(COM.id, order({ email }));
    const inMx = shopify.put(MX.id, order({ email: 'Same.Buyer@example.com' }));
    t.clock.advance({ minutes: 1 });
    await pollShopify();

    expect((await t.ordersByEmail(COM.id, 'SAME.BUYER@example.com')).map((o) => o.name)).toEqual([
      inCom.name,
    ]);
    expect((await t.ordersByEmail(MX.id, email)).map((o) => o.name)).toEqual([inMx.name]);
    // 亚马逊店铺没有这位客户的订单（非受限角色读不到买家邮箱）
    expect(await t.ordersByEmail(DIRECT.id, email)).toEqual([]);
    expect(await t.ordersByEmail(COM.id, 'nobody@example.com')).toEqual([]);
  });

  it('超过 10 分钟没有同步成功为同步延迟：卡片列出延迟的店铺，店铺表为同步延迟，不出横幅（6.9）', async () => {
    await pollShopify();
    const syncedAt = t.clock.now().toISOString();
    t.clock.advance({ minutes: 10 });
    expect((await shopifyCard()).status).toBe('connected');

    t.clock.advance({ minutes: 1 });
    const card = await shopifyCard();
    expect(card.status).toBe('delayed');
    expect(card.lastSyncAt).toBe(syncedAt);
    expect(card.issues).toEqual([
      {
        target: COM.name,
        status: 'delayed',
        lastSuccessAt: syncedAt,
        failingSince: null,
        failures: 0,
      },
      {
        target: MX.name,
        status: 'delayed',
        lastSuccessAt: syncedAt,
        failingSince: null,
        failures: 0,
      },
    ]);
    expect(await storeOrdersStatus(COM.name)).toBe('delayed');
    expect(await alerts(agent)).toEqual([]);

    await pollShopify();
    expect(await shopifyCard()).toMatchObject({ status: 'connected', issues: [] });
  });

  it('某店铺连续 3 次失败进入连接异常 → 全站横幅 → 管理员与客服主管收到站内通知与钉钉工作通知（E-01）；恢复后横幅消失并发「渠道连接恢复」', async () => {
    const syncedAt = (await shopifyCard()).lastSyncAt;
    t.clock.advance({ minutes: 1 });
    const failingFrom = t.clock.now().toISOString();
    shopify.faultsOf(MX.id).failNext(
      { kind: 'error', status: 401, message: 'Invalid API key or access token' },
      {
        operation: 'orders',
        times: 4,
      },
    );
    // 断开期间的新订单：恢复后补拉
    const waiting = shopify.put(MX.id, order());

    // 第 1、2 次失败：仍是已连接，没有横幅与通知
    await pollShopify({ allowFailures: true });
    t.clock.advance({ minutes: 1 });
    await pollShopify({ allowFailures: true });
    expect((await shopifyCard()).status).toBe('connected');
    expect(await alerts(agent)).toEqual([]);
    expect(await channelNotices(admin)).toEqual([]);

    // 第 3 次：连接异常（另一个店铺照常）
    t.clock.advance({ minutes: 1 });
    await pollShopify({ allowFailures: true });
    const card = await shopifyCard();
    expect(card.status).toBe('error');
    expect(card.issues).toEqual([
      {
        target: MX.name,
        status: 'error',
        lastSuccessAt: syncedAt,
        failingSince: failingFrom,
        failures: 3,
      },
    ]);
    expect(await storeOrdersStatus(MX.name)).toBe('error');
    expect(await storeOrdersStatus(COM.name)).toBe('connected');
    for (const client of [agent, supervisor, admin]) {
      expect(await alerts(client)).toEqual([
        { kind: 'shopify', targets: [MX.name], since: failingFrom },
      ]);
    }
    const disconnected = {
      type: 'channel_disconnected',
      title: 'Shopify 连接异常',
      body: 'forcome.mx 连续 3 次失败，订单暂停同步',
      object: { type: 'channel', id: 'shopify', label: 'P18 · Shopify' },
    };
    expect(await channelNotices(admin)).toEqual([disconnected]);
    expect(await channelNotices(supervisor)).toEqual([disconnected]);
    expect(await channelNotices(agent)).toEqual([]);
    const [audit] = await t.auditRecords({ action: 'channel.disconnected' });
    expect(audit).toMatchObject({
      actorType: 'system',
      objectType: 'channel',
      objectId: `shopify:${MX.id}`,
      objectLabel: 'Shopify · forcome.mx',
      // 按店铺的记录：P27 按查看者的店铺范围过滤
      storeId: MX.id,
    });
    const p27 = auditLogSchema.parse(
      await (await admin.get('/api/audit?period=today&type=channel')).json(),
    );
    expect(
      p27.entries.map((row) => [row.objectLabel, row.actionLabel, row.summary]),
    ).toContainEqual([
      'Shopify · forcome.mx',
      '连接异常',
      '状态：已连接 → 连接异常（连续 3 次失败）',
    ]);

    // 第 4 次失败：不再重复通知
    t.clock.advance({ minutes: 1 });
    await pollShopify({ allowFailures: true });
    expect(await channelNotices(admin)).toHaveLength(1);
    expect((await shopifyCard()).issues[0]?.failures).toBe(4);

    // 恢复：同步成功，补拉断开期间的订单
    t.clock.advance({ minutes: 1 });
    await pollShopify();
    expect(await t.findOrder(MX.id, { name: waiting.name })).not.toBeNull();
    expect(await shopifyCard()).toMatchObject({
      status: 'connected',
      lastSyncAt: t.clock.now().toISOString(),
      issues: [],
    });
    for (const client of [agent, supervisor, admin]) expect(await alerts(client)).toEqual([]);
    const recovered = {
      type: 'channel_recovered',
      title: 'Shopify 已恢复',
      body: 'forcome.mx 已重新连接，补拉 1 笔订单',
      object: { type: 'channel', id: 'shopify', label: 'P18 · Shopify' },
    };
    expect(await channelNotices(admin)).toEqual([recovered, disconnected]);
    expect(await channelNotices(supervisor)).toEqual([recovered, disconnected]);
    const p27After = auditLogSchema.parse(
      await (await admin.get('/api/audit?period=today&type=channel')).json(),
    );
    const recoveredRow = p27After.entries.find(
      (row) => row.actionLabel === '恢复连接' && row.objectLabel === 'Shopify · forcome.mx',
    );
    expect(recoveredRow?.summary).toBe('状态：连接异常 → 已连接（补拉 1 笔订单）');
    expect(recoveredRow?.fields.map((f) => [f.label, f.before, f.after])).toEqual([
      ['状态', '连接异常', '已连接'],
      ['最近同步成功', expect.any(String), expect.any(String)],
      ['补拉', '—', expect.stringMatching(/^1 笔订单（\d\d:\d\d–\d\d:\d\d 更新）$/)],
      ['触发', '连续 4 次失败', '第 5 次重试成功'],
    ]);
    // 连接异常另发钉钉工作通知（11.4，同一接收人 5 分钟合并后发出）；恢复只发站内
    t.clock.advance({ minutes: 6 });
    await t.enqueue(sendWorkNotificationsJob, {});
    await t.runJobs();
    const sent = t.clients.fake(dingtalkClient).sent;
    const disconnectedSent = sent.filter((n) => n.text.includes('Shopify 连接异常'));
    expect(disconnectedSent.map((n) => n.text).join('\n')).toContain(
      'forcome.mx 连续 3 次失败，订单暂停同步',
    );
    // 接收人：在职的管理员与客服主管（钉钉用户 ID 是示例成员的 key），坐席没有
    const recipients = getDemoFixture()
      .members.filter((m) => m.role === '管理员' || m.role === '客服主管')
      .map((m) => m.key)
      .sort();
    expect([...new Set(disconnectedSent.flatMap((n) => n.userIds))].sort()).toEqual(recipients);
    expect(sent.map((n) => n.text).join('\n')).not.toContain('Shopify 已恢复');
  });

  it('恢复时一笔也没补拉到：照写「补拉 0 笔订单」', async () => {
    await pollShopify();
    t.clock.advance({ minutes: 1 });
    shopify.faultsOf(COM.id).failNext({ kind: 'timeout' }, { operation: 'orders', times: 3 });
    for (let i = 0; i < 3; i += 1) {
      await pollShopify({ allowFailures: true });
      t.clock.advance({ minutes: 1 });
    }
    expect((await shopifyCard()).issues.map((i) => [i.target, i.status])).toEqual([
      [COM.name, 'error'],
    ]);
    await pollShopify();
    expect((await channelNotices(admin))[0]).toMatchObject({
      title: 'Shopify 已恢复',
      body: 'forcome.com 已重新连接，补拉 0 笔订单',
    });
  });

  it('Gmail 与 Shopify 同时连接异常：横幅各一条，Gmail 在前（协调者 2026-10-06 决定）', async () => {
    const gmail = t.clients.fake(gmailClient);
    // 开始监听各邮箱
    await t.runJobs();
    await t.enqueue(gmailPollJob, {});
    await t.runJobs();
    t.clock.advance({ minutes: 1 });
    gmail.faults.failNext(
      { kind: 'error', status: 503 },
      { operation: 'users.history.list', times: 3 },
    );
    shopify
      .faultsOf(MX.id)
      .failNext({ kind: 'error', status: 503 }, { operation: 'orders', times: 3 });
    gmail.deliver({
      to: MX.mailbox,
      from: { name: 'Buyer', address: 'buyer@example.com' },
      subject: 'Where is my order',
      text: 'Hello',
      at: t.clock.now(),
    });
    // 每轮：Shopify 每分钟的同步，Gmail 的同步任务重试一次（推送来的同步失败后进入重试）
    for (let i = 0; i < 3; i += 1) {
      await pollShopify({ allowFailures: true });
      t.clock.advance({ minutes: 1 });
    }
    expect((await alerts(agent)).map((a) => [a.kind, a.targets])).toEqual([
      ['gmail', [MX.mailbox]],
      ['shopify', [MX.name]],
    ]);
    // 恢复
    await t.enqueue(gmailPollJob, {});
    await pollShopify();
    expect(await alerts(agent)).toEqual([]);
  });

  it('测试连接（K20）：逐个 Shopify 店铺读店铺信息；全部可访问 200，访问不了 502 写店铺名；不改状态，测完排一次同步；只有管理员', async () => {
    const res = await admin.post('/api/channel/connection-tests/shopify');
    expect(res.status).toBe(200);
    expect(connectionTestResultSchema.parse(await res.json())).toEqual({
      kind: 'shopify',
      targets: [COM.name, MX.name],
    });

    t.clock.advance({ minutes: 3 });
    shopify.faultsOf(MX.id).failNext({ kind: 'error', status: 403 }, { operation: 'shop' });
    const failed = await admin.post('/api/channel/connection-tests/shopify');
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({
      error: 'connection_test_failed',
      message: 'forcome.mx 无法访问',
    });
    // 不改状态：仍是已连接、没有失败记录
    expect((await shopifyCard()).issues).toEqual([]);
    // 测完排了同步：跑完后最近同步时间前进到此刻
    await t.runJobs();
    expect((await shopifyCard()).lastSyncAt).toBe(t.clock.now().toISOString());

    expect((await supervisor.post('/api/channel/connection-tests/shopify')).status).toBe(403);
  });

  it('新登记的 Shopify 店铺立即同步一次（不等每分钟的定时）；改了平台标识或数据来源时按新配置从头算', async () => {
    const res = await admin.post('/api/channel/stores', {
      name: 'forcome.ca',
      platform: 'shopify',
      sites: ['CA'],
      defaultSite: 'CA',
      mailboxes: ['support@forcome.ca'],
      platformId: 'forcome-ca.myshopify.com',
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; version: number };
    expect(await storeOrdersStatus('forcome.ca')).toBe('not_connected');
    await t.runJobs();
    expect(await storeOrdersStatus('forcome.ca')).toBe('connected');

    // 改成真实接口（测试里没有 Shopify 凭据）：之前模拟数据的同步不算数，为未连接，也不算失败
    const updated = await admin.put(`/api/channel/stores/${created.id}`, {
      name: 'forcome.ca',
      platform: 'shopify',
      sites: ['CA'],
      defaultSite: 'CA',
      mailboxes: ['support@forcome.ca'],
      platformId: 'forcome-ca.myshopify.com',
      adapterMode: 'real',
      version: created.version,
    });
    expect(updated.status).toBe(200);
    await t.runJobs();
    expect(await storeOrdersStatus('forcome.ca')).toBe('not_connected');
    expect((await shopifyCard()).issues).toEqual([]);
  });
});

describe('生产环境没有配置 Shopify 凭据（用户 2026-10-04 口径：Shopify 资质还没有）', () => {
  let p: TestHarness;
  let prodAdmin: ApiClient;

  beforeAll(async () => {
    p = await startTestHarness({ appEnv: 'production', feeds: () => [] });
    prodAdmin = await p.loginAs('管理员');
  });

  afterAll(async () => {
    await p.close();
  });

  it('照常运行：Shopify 店铺（真实接口）与 Shopify 卡为未连接，没有异常的店铺、不出横幅、不发通知、不记审计；按订单名查订单为空', async () => {
    const res = await prodAdmin.post('/api/channel/stores', {
      name: 'forcome.mx',
      platform: 'shopify',
      sites: ['MX'],
      defaultSite: 'MX',
      mailboxes: ['support@forcome.mx'],
      platformId: 'forcome-mx.myshopify.com',
    });
    expect(res.status).toBe(201);
    const storeId = ((await res.json()) as { id: string }).id;
    // 每分钟的同步跑几轮：都不抛错、不记失败
    for (let i = 0; i < 4; i += 1) {
      p.clock.advance({ minutes: 1 });
      await p.enqueue(shopifyPollJob, {});
      await p.runJobs();
    }
    const data = channelSettingsSchema.parse(
      await (await prodAdmin.get('/api/channel/settings')).json(),
    );
    expect(data.channels.find((c) => c.kind === 'shopify')).toMatchObject({
      status: 'not_connected',
      simulated: false,
      lastSyncAt: null,
      issues: [],
    });
    expect(data.stores[0]?.connections.find((c) => c.kind === 'orders')?.status).toBe(
      'not_connected',
    );
    const alertsRes = await prodAdmin.get('/api/channel/alerts');
    expect(channelAlertsSchema.parse(await alertsRes.json()).alerts).toEqual([]);
    const notices = notificationListSchema
      .parse(await (await prodAdmin.get('/api/notifications')).json())
      .items.filter((n) => n.type === 'channel_disconnected' || n.type === 'channel_recovered');
    expect(notices).toEqual([]);
    expect(await p.auditRecords({ objectType: 'channel' })).toEqual([]);
    expect(await p.findOrder(storeId, { name: '#1063' })).toBeNull();
  });
});
