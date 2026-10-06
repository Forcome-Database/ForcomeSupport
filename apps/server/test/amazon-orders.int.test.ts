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
import { listOrderStores } from '../src/modules/channel';
import { memberStoreScope, sendWorkNotificationsJob } from '../src/modules/core';
import {
  amazonOrdersClient,
  amazonSqsClient,
  dingtalkClient,
  shopifyClient,
  type FakeAmazonOrderInput,
  type FakeAmazonOrders,
  type FakeAmazonSqs,
} from '../src/modules/integration';
import { amazonPollJob, createOrderFeeds, findOrder, shopifyPollJob } from '../src/modules/order';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 亚马逊订单镜像（待办 12；规格 order「亚马逊：SP-API Orders v2026-01-01」「对外接口」，PRD 6.9、E-01、11.4、G4、K20、P27「第一阶段」，
 * 协调者 2026-10-06 决定 Q1–Q8）：往 Fake SP-API 放订单、往 Fake SQS 放 ORDER_CHANGE 通知、注入故障 → 推进时钟、跑常驻拉取与每 4 分钟的
 * 增量同步 → 经 order 的对外接口（t.findOrder）核对镜像，以管理员、客服主管、坐席的身份看 P18 的亚马逊卡（含 SQS 行）与店铺表、全站横幅、
 * 站内通知、钉钉工作通知与审计。同一个库上的用例按顺序进行，时钟前后相接。
 */

const stores = getDemoFixture().stores;
const DIRECT = stores.find((s) => s.name === 'Forcome Direct')!;
const AUTO = stores.find((s) => s.name === 'Forcome Auto')!;
const SHOPIFY_MX = stores.find((s) => s.name === 'forcome.mx')!;

let t: TestHarness;
let amazon: FakeAmazonOrders;
let sqs: FakeAmazonSqs;
let admin: ApiClient;
let supervisor: ApiClient;
let agent: ApiClient;

async function settings(client: ApiClient = admin) {
  const res = await client.get('/api/channel/settings');
  expect(res.status).toBe(200);
  return channelSettingsSchema.parse(await res.json());
}

async function amazonCard(): Promise<ChannelCard> {
  const card = (await settings()).channels.find((c) => c.kind === 'amazon');
  if (!card) throw new Error('没有亚马逊卡');
  return card;
}

/** 店铺表「状态」列里该店铺的订单（SP-API）状态 */
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

/** 每 4 分钟的增量兜底：给每个亚马逊店铺排一次同步再跑完（每轮也先拉一次 SQS） */
async function pollAmazon(options: { allowFailures?: boolean } = {}) {
  await t.enqueue(amazonPollJob, {});
  return t.runJobs(options);
}

/** 某店铺 Fake SP-API 上某个操作被调用的次数 */
function calls(storeId: string, operation: string): number {
  return amazon.faultsOf(storeId).calls.filter((c) => c === operation).length;
}

let serial = 1000000;
/** 一笔亚马逊订单（订单号 3-7-7），平台更新时间为此刻 */
function order(overrides: Partial<FakeAmazonOrderInput> = {}): FakeAmazonOrderInput {
  serial += 1;
  return { orderId: `112-${serial}-${serial}`, updatedAt: t.clock.now(), ...overrides };
}

beforeAll(async () => {
  t = await startTestHarness();
  await t.loadFixtures();
  amazon = t.clients.fake(amazonOrdersClient);
  sqs = t.clients.fake(amazonSqsClient);
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

describe('亚马逊订单镜像', () => {
  it('还没同步过为未连接、SQS 行未连接；第一次增量同步后亚马逊卡与两个店铺为已连接，SQS 正常 · 积压 0（6.9、K20）', async () => {
    expect(await amazonCard()).toEqual({
      kind: 'amazon',
      status: 'not_connected',
      simulated: true,
      lastSyncAt: null,
      issues: [],
      queue: { status: 'not_connected', backlog: null },
      // 没有连接上的店铺：没有订单回补行（待办 13）
      backfill: null,
    });
    expect(await storeOrdersStatus(DIRECT.name)).toBe('not_connected');

    await pollAmazon();
    expect(await amazonCard()).toMatchObject({
      status: 'connected',
      lastSyncAt: t.clock.now().toISOString(),
      issues: [],
      queue: { status: 'normal', backlog: 0 },
    });
    expect(await storeOrdersStatus(DIRECT.name)).toBe('connected');
    expect(await storeOrdersStatus(AUTO.name)).toBe('connected');
    // 别的卡没有队列行
    expect((await settings()).channels.filter((c) => c.queue !== null).map((c) => c.kind)).toEqual([
      'amazon',
    ]);
  });

  it('SQS 的 ORDER_CHANGE 通知触发按订单号拉取并写镜像（字段齐全）；订单再变时再拉、镜像更新；消息处理后删除', async () => {
    t.clock.advance({ minutes: 1 });
    const placed = amazon.put(
      DIRECT.id,
      order({
        createdAt: new Date('2026-09-11T01:30:00Z'),
        marketplaceId: 'A2EUQ1WTGCTBG2',
        status: 'UNSHIPPED',
        fulfilledBy: 'MERCHANT',
        shipBy: new Date('2026-09-12T15:59:00Z'),
        deliverBy: new Date('2026-09-17T15:59:00Z'),
        total: { amount: '67.99', currency: 'CAD' },
        items: [{ title: '车载吸尘器 V2 黑色', sku: 'FC-V2-BK', asin: 'B0C1V2BK01', quantity: 1 }],
        shipTo: { city: 'Toronto', stateOrRegion: 'ON', postalCode: 'M5V 2T6', countryCode: 'CA' },
      }),
    );
    const searchesBefore = calls(DIRECT.id, 'searchOrders');
    sqs.orderChanged(DIRECT.platformId, placed.orderId, t.clock.now());
    await t.runJobs();

    expect(await t.findOrder(DIRECT.id, { platformOrderId: placed.orderId })).toMatchObject({
      storeId: DIRECT.id,
      platform: 'amazon',
      platformOrderId: placed.orderId,
      name: null,
      status: 'UNSHIPPED',
      fulfillmentChannel: 'MFN',
      promisedShipBy: placed.shipBy,
      promisedDeliveryBy: placed.deliverBy,
      total: { amount: '67.99', currency: 'CAD' },
      lineItems: [{ title: '车载吸尘器 V2 黑色', sku: 'FC-V2-BK', quantity: 1 }],
      customerEmail: null,
      shipCountry: 'CA',
      shipAddress: {
        name: null,
        address1: null,
        address2: null,
        city: 'Toronto',
        province: 'ON',
        zip: 'M5V 2T6',
        country: 'CA',
        phone: null,
      },
      tracking: [],
      placedAt: placed.createdAt,
      platformUpdatedAt: placed.updatedAt,
    });
    // 通知触发的是按订单号的 getOrder，不是增量搜索；消息已删除
    expect(calls(DIRECT.id, 'getOrder')).toBe(1);
    expect(calls(DIRECT.id, 'searchOrders')).toBe(searchesBefore);
    expect([sqs.waiting, sqs.inFlight]).toEqual([0, 0]);

    // 发货：再来一条通知（同一笔的通知重复投递两次也只是再取一遍），镜像更新为新版本
    t.clock.advance({ minutes: 1 });
    const shipped = amazon.put(DIRECT.id, {
      ...placed,
      status: 'SHIPPED',
      packages: [{ carrier: 'Canada Post', trackingNumber: '7316204855219087' }],
      updatedAt: t.clock.now(),
    });
    sqs.orderChanged(DIRECT.platformId, placed.orderId, t.clock.now());
    sqs.orderChanged(DIRECT.platformId, placed.orderId, t.clock.now());
    await t.runJobs();
    expect(await t.findOrder(DIRECT.id, { platformOrderId: placed.orderId })).toMatchObject({
      status: 'SHIPPED',
      tracking: [{ company: 'Canada Post', number: '7316204855219087' }],
      platformUpdatedAt: shipped.updatedAt,
    });
    expect([sqs.waiting, sqs.inFlight]).toEqual([0, 0]);

    // 只进不退：迟到的旧通知取到的是更旧的版本（平台那边的副本滞后）时，镜像不改回去
    amazon.put(DIRECT.id, {
      ...shipped,
      status: 'UNSHIPPED',
      updatedAt: new Date(shipped.updatedAt.getTime() - 30_000),
    });
    sqs.orderChanged(DIRECT.platformId, placed.orderId, t.clock.now());
    await t.runJobs();
    expect(await t.findOrder(DIRECT.id, { platformOrderId: placed.orderId })).toMatchObject({
      status: 'SHIPPED',
      platformUpdatedAt: shipped.updatedAt,
    });
  });

  it('未登记卖家的通知、别的通知类型与坏消息照样删掉，不调平台、不出错', async () => {
    const before = calls(DIRECT.id, 'getOrder') + calls(AUTO.id, 'getOrder');
    sqs.orderChanged('A9UNKNOWNSELLER', '113-0000000-0000001', t.clock.now());
    sqs.sendRaw(JSON.stringify({ NotificationType: 'FEED_PROCESSING_FINISHED', Payload: {} }));
    sqs.sendRaw('not json');
    await t.runJobs();
    expect([sqs.waiting, sqs.inFlight]).toEqual([0, 0]);
    expect(calls(DIRECT.id, 'getOrder') + calls(AUTO.id, 'getOrder')).toBe(before);
  });

  it('通知丢失时每 4 分钟的增量兜底仍能补上（含分页）；重复拉取不改镜像', async () => {
    t.clock.advance({ minutes: 1 });
    // 一次 60 笔、没有任何通知：Fake 每页 50 笔，两页
    const missed = Array.from({ length: 60 }, () => amazon.put(AUTO.id, order()));
    const pages = calls(AUTO.id, 'searchOrders');
    t.clock.advance({ minutes: 4 });
    await pollAmazon();
    expect(calls(AUTO.id, 'searchOrders') - pages).toBe(2);
    for (const o of missed) {
      expect(await t.findOrder(AUTO.id, { platformOrderId: o.orderId })).toMatchObject({
        platformOrderId: o.orderId,
        platformUpdatedAt: o.updatedAt,
      });
    }
    // 下一轮（水位前 5 分钟起重叠，同一批又拉到一遍）：镜像不变，同步写入为 0（恢复通知里的「补拉 N 笔」不会把它们算进去）
    const first = await t.findOrder(AUTO.id, { platformOrderId: missed[0]!.orderId });
    t.clock.advance({ minutes: 4 });
    await pollAmazon();
    expect(await t.findOrder(AUTO.id, { platformOrderId: missed[0]!.orderId })).toEqual(first);
  });

  it('镜像没有的订单号触发 getOrder 补拉并入库；再查不再调平台；平台也没有的为空；不像订单号的不调平台；范围外不补拉', async () => {
    // 上线前的历史订单（回补随 13）：平台更新时间早于水位，增量拉不到，也没有通知
    const old = amazon.put(DIRECT.id, {
      orderId: '114-7788990-2233441',
      createdAt: new Date('2026-08-19T02:22:00Z'),
      updatedAt: new Date('2026-08-23T01:10:00Z'),
      fulfilledBy: 'AMAZON',
      status: 'SHIPPED',
    });
    await pollAmazon();
    const fetches = () => calls(DIRECT.id, 'getOrder');
    const before = fetches();
    // 来信里抽到的订单号给成 name 也行（亚马逊没有订单名，订单号就是平台订单号）
    expect(await t.findOrder(DIRECT.id, { name: ' 114-7788990-2233441 ' })).toMatchObject({
      platformOrderId: old.orderId,
      fulfillmentChannel: 'AFN',
      placedAt: old.createdAt,
    });
    expect(fetches()).toBe(before + 1);
    // 已在镜像里：不再调平台
    expect(await t.findOrder(DIRECT.id, { platformOrderId: old.orderId })).not.toBeNull();
    expect(fetches()).toBe(before + 1);
    // 订单号在该店铺内匹配：另一个亚马逊店铺没有这笔
    expect(await t.findOrder(AUTO.id, { platformOrderId: old.orderId })).toBeNull();
    // 平台也没有：为空
    expect(await t.findOrder(DIRECT.id, { platformOrderId: '113-9999999-9999999' })).toBeNull();
    expect(fetches()).toBe(before + 2);
    // 不像亚马逊订单号的：只查镜像，不调平台
    expect(await t.findOrder(DIRECT.id, { name: '#1063' })).toBeNull();
    expect(fetches()).toBe(before + 2);
    // 店铺范围外（ADR 0010）：只授权 Forcome Auto 的范围查不到 Forcome Direct 的订单，也不去平台补拉
    const onlyAuto = memberStoreScope({ allStores: false, storeIds: [AUTO.id] });
    const direct = (await listOrderStores(t.runtime.db)).find((s) => s.id === DIRECT.id)!;
    expect(
      await findOrder(t.runtime, t.clients, onlyAuto, direct, { name: old.orderId }),
    ).toBeNull();
    expect(
      await findOrder(t.runtime, t.clients, onlyAuto, direct, { name: '113-4242424-4242424' }),
    ).toBeNull();
    expect(fetches()).toBe(before + 2);
  });

  it('SQS 积压与拉取失败分别反映为卡上的 SQS 状态，不改卡片与店铺的连接状态、不出横幅、不发通知（Q7）', async () => {
    // 每分钟检查一次等待拉取的通知：一下来了 12 条（≥ 10 条）为积压
    t.clock.advance({ minutes: 1 });
    for (let i = 0; i < 12; i += 1) sqs.orderChanged(AUTO.platformId, `113-555000${i}-0000001`);
    await pollAmazon();
    const backlogged = await amazonCard();
    expect(backlogged.queue).toEqual({ status: 'backlog', backlog: 12 });
    expect(backlogged.status).toBe('connected');
    // 下一分钟检查时已拉完：回到正常
    t.clock.advance({ minutes: 1 });
    await t.runJobs();
    expect((await amazonCard()).queue).toEqual({ status: 'normal', backlog: 0 });

    // 少于 10 条：仍是正常（写出条数）
    t.clock.advance({ minutes: 1 });
    for (let i = 0; i < 3; i += 1) sqs.orderChanged(AUTO.platformId, `113-555100${i}-0000001`);
    await t.runJobs();
    expect((await amazonCard()).queue).toEqual({ status: 'normal', backlog: 3 });

    // 拉取失败：连续 2 次仍是正常，第 3 次为拉取失败（常驻拉取出错时测试的「跑完任务」照常抛出）
    sqs.faults.failNext(
      { kind: 'error', status: 403, message: 'AccessDenied' },
      {
        operation: 'ReceiveMessage',
        times: 3,
      },
    );
    await expect(t.runJobs()).rejects.toThrow(/AccessDenied/);
    await expect(t.runJobs()).rejects.toThrow(/AccessDenied/);
    expect((await amazonCard()).queue?.status).toBe('normal');
    await expect(t.runJobs()).rejects.toThrow(/AccessDenied/);
    const failed = await amazonCard();
    expect(failed.queue?.status).toBe('failed');
    expect(failed.status).toBe('connected');
    expect(failed.issues).toEqual([]);
    expect(await storeOrdersStatus(AUTO.name)).toBe('connected');
    expect(await alerts(agent)).toEqual([]);
    expect(await channelNotices(admin)).toEqual([]);
    expect(await t.auditRecords({ objectType: 'channel' })).toEqual([]);

    // 恢复：拉取成功即回到正常
    await t.runJobs();
    expect((await amazonCard()).queue?.status).toBe('normal');
  });

  it('超过 10 分钟没有同步成功为同步延迟：卡片列出延迟的店铺，店铺表为同步延迟，不出横幅（6.9）', async () => {
    await pollAmazon();
    const syncedAt = t.clock.now().toISOString();
    t.clock.advance({ minutes: 10 });
    expect((await amazonCard()).status).toBe('connected');

    t.clock.advance({ minutes: 1 });
    const card = await amazonCard();
    expect(card.status).toBe('delayed');
    expect(card.lastSyncAt).toBe(syncedAt);
    // 按店铺名排序
    expect(card.issues).toEqual([
      {
        target: AUTO.name,
        status: 'delayed',
        lastSuccessAt: syncedAt,
        failingSince: null,
        failures: 0,
      },
      {
        target: DIRECT.name,
        status: 'delayed',
        lastSuccessAt: syncedAt,
        failingSince: null,
        failures: 0,
      },
    ]);
    expect(await storeOrdersStatus(DIRECT.name)).toBe('delayed');
    expect(await alerts(agent)).toEqual([]);

    await pollAmazon();
    expect(await amazonCard()).toMatchObject({ status: 'connected', issues: [] });
  });

  it('某店铺连续 3 次失败进入连接异常 → 全站横幅 → 管理员与客服主管收到站内通知与钉钉工作通知（E-01）；恢复后横幅消失并发「渠道连接恢复」', async () => {
    const syncedAt = (await amazonCard()).lastSyncAt;
    t.clock.advance({ minutes: 4 });
    const failingFrom = t.clock.now().toISOString();
    amazon
      .faultsOf(AUTO.id)
      .failNext(
        { kind: 'error', status: 403, message: 'Access to requested resource is denied.' },
        { operation: 'searchOrders', times: 4 },
      );
    // 断开期间的新订单（通知也丢了）：恢复后由增量补拉
    const waiting = amazon.put(AUTO.id, order());

    // 第 1、2 次失败：仍是已连接，没有横幅与通知
    await pollAmazon({ allowFailures: true });
    t.clock.advance({ minutes: 4 });
    await pollAmazon({ allowFailures: true });
    expect((await amazonCard()).status).toBe('connected');
    expect(await alerts(agent)).toEqual([]);
    expect(await channelNotices(admin)).toEqual([]);

    // 第 3 次：连接异常（另一个店铺照常）
    t.clock.advance({ minutes: 1 });
    await pollAmazon({ allowFailures: true });
    const card = await amazonCard();
    expect(card.status).toBe('error');
    expect(card.issues).toEqual([
      {
        target: AUTO.name,
        status: 'error',
        lastSuccessAt: syncedAt,
        failingSince: failingFrom,
        failures: 3,
      },
    ]);
    expect(await storeOrdersStatus(AUTO.name)).toBe('error');
    expect(await storeOrdersStatus(DIRECT.name)).toBe('connected');
    for (const client of [agent, supervisor, admin]) {
      expect(await alerts(client)).toEqual([
        { kind: 'amazon', targets: [AUTO.name], since: failingFrom },
      ]);
    }
    const disconnected = {
      type: 'channel_disconnected',
      title: '亚马逊 SP-API 连接异常',
      body: 'Forcome Auto 连续 3 次失败，订单暂停同步',
      object: { type: 'channel', id: 'amazon', label: 'P18 · 亚马逊 SP-API' },
    };
    expect(await channelNotices(admin)).toEqual([disconnected]);
    expect(await channelNotices(supervisor)).toEqual([disconnected]);
    expect(await channelNotices(agent)).toEqual([]);
    const [audit] = await t.auditRecords({ action: 'channel.disconnected' });
    expect(audit).toMatchObject({
      actorType: 'system',
      objectType: 'channel',
      objectId: `amazon:${AUTO.id}`,
      objectLabel: '亚马逊 SP-API · Forcome Auto',
      // 按店铺的记录：P27 按查看者的店铺范围过滤
      storeId: AUTO.id,
    });
    const p27 = auditLogSchema.parse(
      await (await admin.get('/api/audit?period=today&type=channel')).json(),
    );
    expect(
      p27.entries.map((row) => [row.objectLabel, row.actionLabel, row.summary]),
    ).toContainEqual([
      '亚马逊 SP-API · Forcome Auto',
      '连接异常',
      '状态：已连接 → 连接异常（连续 3 次失败）',
    ]);

    // 第 4 次失败：不再重复通知
    t.clock.advance({ minutes: 4 });
    await pollAmazon({ allowFailures: true });
    expect(await channelNotices(admin)).toHaveLength(1);
    expect((await amazonCard()).issues[0]?.failures).toBe(4);

    // 恢复：同步成功，补拉断开期间的订单
    t.clock.advance({ minutes: 4 });
    await pollAmazon();
    expect(await t.findOrder(AUTO.id, { platformOrderId: waiting.orderId })).not.toBeNull();
    expect(await amazonCard()).toMatchObject({
      status: 'connected',
      lastSyncAt: t.clock.now().toISOString(),
      issues: [],
    });
    for (const client of [agent, supervisor, admin]) expect(await alerts(client)).toEqual([]);
    const recovered = {
      type: 'channel_recovered',
      title: '亚马逊 SP-API 已恢复',
      body: 'Forcome Auto 已重新连接，补拉 1 笔订单',
      object: { type: 'channel', id: 'amazon', label: 'P18 · 亚马逊 SP-API' },
    };
    expect(await channelNotices(admin)).toEqual([recovered, disconnected]);
    expect(await channelNotices(supervisor)).toEqual([recovered, disconnected]);
    const p27After = auditLogSchema.parse(
      await (await admin.get('/api/audit?period=today&type=channel')).json(),
    );
    const recoveredRow = p27After.entries.find(
      (row) => row.actionLabel === '恢复连接' && row.objectLabel === '亚马逊 SP-API · Forcome Auto',
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
    const disconnectedSent = sent.filter((n) => n.text.includes('亚马逊 SP-API 连接异常'));
    expect(disconnectedSent.map((n) => n.text).join('\n')).toContain(
      'Forcome Auto 连续 3 次失败，订单暂停同步',
    );
    // 接收人：在职的管理员与客服主管（钉钉用户 ID 是示例成员的 key），坐席没有
    const recipients = getDemoFixture()
      .members.filter((m) => m.role === '管理员' || m.role === '客服主管')
      .map((m) => m.key)
      .sort();
    expect([...new Set(disconnectedSent.flatMap((n) => n.userIds))].sort()).toEqual(recipients);
    expect(sent.map((n) => n.text).join('\n')).not.toContain('亚马逊 SP-API 已恢复');
  });

  it('亚马逊与 Shopify 同时连接异常：横幅各一条，亚马逊在 Shopify 前（Q3）', async () => {
    const shopify = t.clients.fake(shopifyClient);
    await t.enqueue(shopifyPollJob, {});
    await pollAmazon();
    t.clock.advance({ minutes: 1 });
    amazon
      .faultsOf(DIRECT.id)
      .failNext({ kind: 'timeout' }, { operation: 'searchOrders', times: 3 });
    shopify
      .faultsOf(SHOPIFY_MX.id)
      .failNext({ kind: 'error', status: 503 }, { operation: 'orders', times: 3 });
    for (let i = 0; i < 3; i += 1) {
      await t.enqueue(shopifyPollJob, {});
      await pollAmazon({ allowFailures: true });
      t.clock.advance({ minutes: 1 });
    }
    expect((await alerts(agent)).map((a) => [a.kind, a.targets])).toEqual([
      ['amazon', [DIRECT.name]],
      ['shopify', [SHOPIFY_MX.name]],
    ]);
    // 恢复时一笔也没补拉到：照写「补拉 0 笔订单」
    await t.enqueue(shopifyPollJob, {});
    await pollAmazon();
    expect(await alerts(agent)).toEqual([]);
    expect(
      (await channelNotices(admin)).find((n) => n.title === '亚马逊 SP-API 已恢复')?.body,
    ).toBe('Forcome Direct 已重新连接，补拉 0 笔订单');
  });

  it('测试连接（K20、Q6）：逐个店铺读卖家参与的站点并探一次 SQS；全部可访问 200，访问不了 502 写店铺名、队列在后；不改状态，测完排一次同步；只有管理员', async () => {
    const res = await admin.post('/api/channel/connection-tests/amazon');
    expect(res.status).toBe(200);
    expect(connectionTestResultSchema.parse(await res.json())).toEqual({
      kind: 'amazon',
      targets: [DIRECT.name, AUTO.name],
    });

    t.clock.advance({ minutes: 3 });
    amazon
      .faultsOf(AUTO.id)
      .failNext({ kind: 'error', status: 403 }, { operation: 'getMarketplaceParticipations' });
    const storeFailed = await admin.post('/api/channel/connection-tests/amazon');
    expect(storeFailed.status).toBe(502);
    expect(await storeFailed.json()).toEqual({
      error: 'connection_test_failed',
      message: 'Forcome Auto 无法访问',
    });

    sqs.faults.failNext({ kind: 'error', status: 400 }, { operation: 'GetQueueAttributes' });
    const queueFailed = await admin.post('/api/channel/connection-tests/amazon');
    expect(queueFailed.status).toBe(502);
    expect(await queueFailed.json()).toEqual({
      error: 'connection_test_failed',
      message: '订单通知队列（SQS） 无法访问',
    });

    amazon
      .faultsOf(DIRECT.id)
      .failNext({ kind: 'timeout' }, { operation: 'getMarketplaceParticipations' });
    sqs.faults.failNext({ kind: 'timeout' }, { operation: 'GetQueueAttributes' });
    const bothFailed = await admin.post('/api/channel/connection-tests/amazon');
    expect(await bothFailed.json()).toMatchObject({
      message: 'Forcome Direct、订单通知队列（SQS） 无法访问',
    });

    // 不改状态：仍是已连接、没有失败记录，SQS 行照旧
    expect(await amazonCard()).toMatchObject({
      status: 'connected',
      issues: [],
      queue: { status: 'normal' },
    });
    // 测完排了同步：跑完后最近同步时间前进到此刻
    await t.runJobs();
    expect((await amazonCard()).lastSyncAt).toBe(t.clock.now().toISOString());

    expect((await supervisor.post('/api/channel/connection-tests/amazon')).status).toBe(403);
  });

  it('新登记的亚马逊店铺立即同步一次（不等定时）；改成真实接口（没有 SP-API 凭据）按新配置从头算，为未连接、不算失败', async () => {
    const res = await admin.post('/api/channel/stores', {
      name: 'Forcome Home',
      platform: 'amazon',
      sites: ['US'],
      defaultSite: 'US',
      mailboxes: ['amz-home@forcome.com'],
      platformId: 'A7HOME2SELLER9',
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; version: number };
    expect(await storeOrdersStatus('Forcome Home')).toBe('not_connected');
    await t.runJobs();
    expect(await storeOrdersStatus('Forcome Home')).toBe('connected');

    const updated = await admin.put(`/api/channel/stores/${created.id}`, {
      name: 'Forcome Home',
      platform: 'amazon',
      sites: ['US'],
      defaultSite: 'US',
      mailboxes: ['amz-home@forcome.com'],
      platformId: 'A7HOME2SELLER9',
      adapterMode: 'real',
      version: created.version,
    });
    expect(updated.status).toBe(200);
    for (let i = 0; i < 3; i += 1) {
      t.clock.advance({ minutes: 4 });
      await pollAmazon();
    }
    expect(await storeOrdersStatus('Forcome Home')).toBe('not_connected');
    expect((await amazonCard()).issues).toEqual([]);
    expect(await alerts(agent)).toEqual([]);
  });
});

describe('生产环境没有配置 SP-API 与 SQS（用户 2026-10-04 口径：亚马逊资质还没有）', () => {
  let p: TestHarness;
  let prodAdmin: ApiClient;

  beforeAll(async () => {
    // 只起订单的常驻拉取（SQS）：生产没有 SQS 配置时它要安静跳过
    p = await startTestHarness({
      appEnv: 'production',
      feeds: (deps) => createOrderFeeds({ clients: deps.clients, stores: listOrderStores }),
    });
    prodAdmin = await p.loginAs('管理员');
  });

  afterAll(async () => {
    await p.close();
  });

  it('照常运行：亚马逊店铺（真实接口）与亚马逊卡为未连接、SQS 行未连接，没有异常的店铺、不出横幅、不发通知、不记审计；按订单号查订单为空', async () => {
    const res = await prodAdmin.post('/api/channel/stores', {
      name: 'Forcome Direct',
      platform: 'amazon',
      sites: ['US', 'CA', 'MX'],
      defaultSite: 'US',
      mailboxes: ['amz-direct@forcome.com'],
      platformId: 'A1FD7Q2M9XK3LC',
    });
    expect(res.status).toBe(201);
    const storeId = ((await res.json()) as { id: string }).id;
    // 每 4 分钟的同步与 SQS 拉取跑几轮：都不抛错、不记失败
    for (let i = 0; i < 4; i += 1) {
      p.clock.advance({ minutes: 4 });
      await p.enqueue(amazonPollJob, {});
      await p.runJobs();
    }
    const data = channelSettingsSchema.parse(
      await (await prodAdmin.get('/api/channel/settings')).json(),
    );
    expect(data.channels.find((c) => c.kind === 'amazon')).toEqual({
      kind: 'amazon',
      status: 'not_connected',
      simulated: false,
      lastSyncAt: null,
      issues: [],
      queue: { status: 'not_connected', backlog: null },
      backfill: null,
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
    expect(await p.findOrder(storeId, { platformOrderId: '113-4567890-1234567' })).toBeNull();
    // 测试连接：未配置也写「无法访问」（同 Gmail、Shopify），不改状态
    const tested = await prodAdmin.post('/api/channel/connection-tests/amazon');
    expect(tested.status).toBe(502);
    expect(await tested.json()).toMatchObject({
      message: 'Forcome Direct、订单通知队列（SQS） 无法访问',
    });
  });
});
