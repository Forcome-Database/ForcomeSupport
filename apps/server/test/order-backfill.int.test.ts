import { channelSettingsSchema, type ChannelCard } from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listOrderStores } from '../src/modules/channel';
import {
  amazonOrdersClient,
  shopifyClient,
  type FakeAmazonOrderInput,
  type FakeAmazonOrders,
  type FakeShopify,
  type FakeShopifyOrderInput,
} from '../src/modules/integration';
import {
  amazonPollJob,
  amazonSyncJob,
  orderBackfills,
  orderReconcileJob,
  orderSweepResumeJob,
  orderSyncHealths,
  shopifyPollJob,
  shopifySyncJob,
  startOrderBackfill,
} from '../src/modules/order';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 订单回补与夜间对账（待办 13；规格 order「回补 90 天（Shopify 61–90 天依赖 read_all_orders，否则 60 天并由报表注明）；每天夜间对账近 7 天」
 * 「增量优先、回补与对账让路」，PRD P18「第一阶段」K20，协调者 2026-10-06 决定 Q1–Q3）：往 Fake SP-API / Fake Shopify 放历史订单、
 * 注入故障与配额 → 用部署子命令同一个函数开始回补、排夜间对账 → 跑 worker → 经 order 的对外接口核对镜像，以管理员看 P18 两张卡的回补行。
 */

const stores = getDemoFixture().stores;
const DIRECT = stores.find((s) => s.name === 'Forcome Direct')!;
const AUTO = stores.find((s) => s.name === 'Forcome Auto')!;
const SHOPIFY_COM = stores.find((s) => s.name === 'forcome.com')!;
const SHOPIFY_MX = stores.find((s) => s.name === 'forcome.mx')!;

const DAY = 24 * 60 * 60_000;

/** 在一个新库上起测试工具：示例店铺，管理员登录，两个平台先各增量同步一次（店铺为已连接） */
async function start(): Promise<{
  t: TestHarness;
  admin: ApiClient;
  amazon: FakeAmazonOrders;
  shopify: FakeShopify;
}> {
  const t = await startTestHarness();
  await t.loadFixtures();
  const admin = await t.loginAs('管理员');
  const amazon = t.clients.fake(amazonOrdersClient);
  const shopify = t.clients.fake(shopifyClient);
  await t.enqueue(amazonPollJob, {});
  await t.enqueue(shopifyPollJob, {});
  await t.runJobs();
  return { t, admin, amazon, shopify };
}

async function card(admin: ApiClient, kind: ChannelCard['kind']): Promise<ChannelCard> {
  const res = await admin.get('/api/channel/settings');
  expect(res.status).toBe(200);
  const found = channelSettingsSchema.parse(await res.json()).channels.find((c) => c.kind === kind);
  if (!found) throw new Error(`没有 ${kind} 卡`);
  return found;
}

/** 部署子命令 order-backfill 的同一个函数：开始回补（不给店铺为全部） */
function backfill(t: TestHarness, storeIds?: string[], again = false) {
  return startOrderBackfill(t.runtime, listOrderStores, { storeIds, again });
}

let serial = 2000000;
/** 一笔亚马逊历史订单：下单于 daysAgo 天前，下单 1 小时后最后一次更新 */
function amazonOrder(
  t: TestHarness,
  daysAgo: number,
  overrides: Partial<FakeAmazonOrderInput> = {},
): FakeAmazonOrderInput {
  serial += 1;
  const createdAt = new Date(t.clock.now().getTime() - daysAgo * DAY);
  return {
    orderId: `113-${serial}-${serial}`,
    createdAt,
    updatedAt: new Date(createdAt.getTime() + 60 * 60_000),
    ...overrides,
  };
}

let shopifySerial = 5000;
/** 一笔 Shopify 历史订单（订单名 #<序号>，客户邮箱按订单名，方便只查镜像） */
function shopifyOrder(
  t: TestHarness,
  daysAgo: number,
  overrides: Partial<FakeShopifyOrderInput> = {},
): FakeShopifyOrderInput {
  shopifySerial += 1;
  const createdAt = new Date(t.clock.now().getTime() - daysAgo * DAY);
  return {
    name: `#${shopifySerial}`,
    email: `buyer${shopifySerial}@example.com`,
    createdAt,
    updatedAt: new Date(createdAt.getTime() + 60 * 60_000),
    ...overrides,
  };
}

describe('回补中断后续跑不重复、不遗漏', () => {
  let t: TestHarness;
  let admin: ApiClient;
  let amazon: FakeAmazonOrders;

  beforeAll(async () => {
    ({ t, admin, amazon } = await start());
  });

  afterAll(async () => {
    await t.close();
  });

  const searches = () => amazon.faultsOf(DIRECT.id).calls.filter((c) => c === 'searchOrders');

  it('按下单时间取近 90 天（Fake 每页 50 笔，共 3 页）：第 2 页时 worker 停了、又失败一次，续跑从第 2 页接着取，每页只写一次', async () => {
    // 130 笔近 90 天里下的单（都早于增量的水位，增量拉不到），1 笔 100 天前的不在窗口里
    const recent = Array.from({ length: 130 }, (_, i) => amazonOrder(t, 1 + (i % 88)));
    for (const o of recent) amazon.put(DIRECT.id, o);
    amazon.put(DIRECT.id, amazonOrder(t, 100));
    const before = searches().length;

    // 两个亚马逊店铺一起回补（Forcome Auto 没有订单，一页就完）
    expect((await backfill(t, [DIRECT.id, AUTO.id])).map((r) => r.result)).toEqual([
      'started',
      'started',
    ]);
    // 第 1 页写完、排了第 2 页时 worker 停了（这一页的任务以失败结束，等重试）
    await expect(t.runJobs({ maxRounds: 1 })).rejects.toThrow(/仍未空闲/);
    expect(searches().length - before).toBe(1);
    expect((await card(admin, 'amazon')).backfill).toEqual({
      days: 90,
      state: 'running',
      orders: 50,
      historyLimited: false,
    });

    // 重试时平台出错一次：游标不动
    amazon
      .faultsOf(DIRECT.id)
      .failNext({ kind: 'error', status: 503 }, { operation: 'searchOrders' });
    const failed = await t.runJobs({ allowFailures: true });
    expect(failed.failed.map((f) => f.name)).toEqual(['order.sweep_page']);
    expect((await card(admin, 'amazon')).backfill?.orders).toBe(50);

    // 再续跑：从第 2 页接着取完
    await t.runJobs();
    // 第 1 页 1 次、第 2 页 2 次（失败一次）、第 3 页 1 次：第 1 页没有重取
    expect(searches().length - before).toBe(4);
    expect((await card(admin, 'amazon')).backfill).toEqual({
      days: 90,
      state: 'completed',
      orders: 130,
      historyLimited: false,
    });
    // 130 笔都在镜像里（直接从镜像查到，没有按订单号补拉）
    for (const o of recent) {
      expect(await t.findOrder(DIRECT.id, { platformOrderId: o.orderId })).toMatchObject({
        platformOrderId: o.orderId,
        placedAt: o.createdAt,
      });
    }
    expect(amazon.faultsOf(DIRECT.id).calls).not.toContain('getOrder');
    // 回补走的是低优先级
    expect(amazon.quota.priorities.filter((p) => p === 'low').length).toBe(5);

    // 再执行一次：已完成的跳过（要重来加 --again）
    expect((await backfill(t, [DIRECT.id, AUTO.id])).map((r) => r.result)).toEqual([
      'completed',
      'completed',
    ]);
    await t.runJobs();
    expect(searches().length - before).toBe(4);
  });

  it('分页令牌拿到超过 23 小时（亚马逊 24 小时过期）：从第一页重来，已回补笔数不重复计', async () => {
    const before = searches().length;
    expect((await backfill(t, [DIRECT.id], true)).map((r) => r.result)).toEqual(['started']);
    await expect(t.runJobs({ maxRounds: 1 })).rejects.toThrow(/仍未空闲/);
    expect((await card(admin, 'amazon')).backfill?.orders).toBe(50);
    t.clock.advance({ hours: 24 });
    await t.runJobs();
    // 第 1 页、（过期后）第 1 页、第 2 页、第 3 页
    expect(searches().length - before).toBe(4);
    expect((await card(admin, 'amazon')).backfill).toMatchObject({
      state: 'completed',
      orders: 130,
    });
  });

  it('续跑不靠原来的任务：重试用完后每 10 分钟的 sweep_resume 接着排', async () => {
    amazon.put(AUTO.id, amazonOrder(t, 3));
    amazon.put(AUTO.id, amazonOrder(t, 4));
    amazon
      .faultsOf(AUTO.id)
      .failNext({ kind: 'error', status: 500 }, { operation: 'searchOrders', times: 4 });
    await backfill(t, [AUTO.id], true);
    // 第一次与 3 次重试都失败（任务的重试用完）
    for (let i = 0; i < 4; i += 1) await t.runJobs({ allowFailures: true });
    expect((await orderBackfills(t.runtime.db)).get(AUTO.id)).toMatchObject({
      completed: false,
      orders: 0,
    });
    await t.enqueue(orderSweepResumeJob, {});
    await t.runJobs();
    expect((await orderBackfills(t.runtime.db)).get(AUTO.id)).toMatchObject({
      completed: true,
      orders: 2,
    });
  });
});

describe('Shopify 拒绝 60 天以前的查询时，回补窗口记为 60 天', () => {
  let t: TestHarness;
  let admin: ApiClient;
  let shopify: FakeShopify;

  beforeAll(async () => {
    ({ t, admin, shopify } = await start());
  });

  afterAll(async () => {
    await t.close();
  });

  /** 只查镜像（按客户邮箱，不补拉）里的订单名 */
  async function mirrored(storeId: string, o: FakeShopifyOrderInput): Promise<string[]> {
    return (await t.ordersByEmail(storeId, o.email!)).map((m) => m.name ?? '');
  }

  it('没开通 read_all_orders：窗口改为 60 天并记下，只回补近 60 天下的单；卡上写「60 天」与未开通', async () => {
    shopify.limitHistory();
    const d10 = shopifyOrder(t, 10);
    const d59 = shopifyOrder(t, 59);
    const d61 = shopifyOrder(t, 61);
    const d75 = shopifyOrder(t, 75);
    for (const o of [d10, d59, d61, d75]) shopify.put(SHOPIFY_COM.id, o);

    await backfill(t, [SHOPIFY_COM.id]);
    await t.runJobs();

    expect(await mirrored(SHOPIFY_COM.id, d10)).toEqual([d10.name]);
    expect(await mirrored(SHOPIFY_COM.id, d59)).toEqual([d59.name]);
    expect(await mirrored(SHOPIFY_COM.id, d61)).toEqual([]);
    expect(await mirrored(SHOPIFY_COM.id, d75)).toEqual([]);
    // 回补窗口（报表注明用，24）
    expect((await orderBackfills(t.runtime.db)).get(SHOPIFY_COM.id)).toEqual({
      storeId: SHOPIFY_COM.id,
      windowDays: 60,
      historyLimited: true,
      orders: 2,
      completed: true,
    });
    // forcome.mx 还没回补：卡上为未开始（天数取最短的 60）
    expect((await card(admin, 'shopify')).backfill).toEqual({
      days: 60,
      state: 'not_started',
      orders: 2,
      historyLimited: true,
    });
  });

  it('开通了 read_all_orders 的店铺回补 90 天；卡上天数仍取最短的 60，全部完成写已完成', async () => {
    shopify.allowAllOrders();
    const d75 = shopifyOrder(t, 75);
    const d95 = shopifyOrder(t, 95);
    for (const o of [d75, d95]) shopify.put(SHOPIFY_MX.id, o);
    await backfill(t, [SHOPIFY_MX.id]);
    await t.runJobs();
    expect(await mirrored(SHOPIFY_MX.id, d75)).toEqual([d75.name]);
    expect(await mirrored(SHOPIFY_MX.id, d95)).toEqual([]);
    expect((await orderBackfills(t.runtime.db)).get(SHOPIFY_MX.id)).toMatchObject({
      windowDays: 90,
      historyLimited: false,
    });
    expect((await card(admin, 'shopify')).backfill).toEqual({
      days: 60,
      state: 'completed',
      orders: 3,
      historyLimited: true,
    });
  });

  it('回补走低优先级，按下单时间分页（中途有订单更新也不漏）', async () => {
    shopify.quota.reset();
    const many = Array.from({ length: 70 }, (_, i) => shopifyOrder(t, 2 + (i % 50)));
    for (const o of many) shopify.put(SHOPIFY_MX.id, o);
    await backfill(t, [SHOPIFY_MX.id], true);
    // 第 1 页写完后，第 1 页里的一笔又更新了（按更新时间分页的话会挪到后面、把别的挤出这一页）
    await expect(t.runJobs({ maxRounds: 1 })).rejects.toThrow(/仍未空闲/);
    shopify.put(SHOPIFY_MX.id, { ...many[0]!, updatedAt: t.clock.now() });
    await t.runJobs();
    for (const o of many) expect(await mirrored(SHOPIFY_MX.id, o)).toEqual([o.name]);
    expect(new Set(shopify.quota.priorities)).toEqual(new Set(['low']));
  });
});

describe('夜间对账修正镜像中与平台不一致的订单', () => {
  let t: TestHarness;
  let amazon: FakeAmazonOrders;
  let shopify: FakeShopify;

  beforeAll(async () => {
    ({ t, amazon, shopify } = await start());
  });

  afterAll(async () => {
    await t.close();
  });

  const amazonCalls = () => amazon.faultsOf(DIRECT.id).calls;

  it('近 7 天里：镜像漏了的补上，同一版本内容不一致的以平台为准改正；7 天以前的不动', async () => {
    // 两笔此刻更新的订单，增量同步进镜像
    const stale = amazonOrder(t, 0, { updatedAt: t.clock.now() });
    const shopStale = shopifyOrder(t, 0, { updatedAt: t.clock.now() });
    amazon.put(DIRECT.id, stale);
    shopify.put(SHOPIFY_COM.id, shopStale);
    await t.enqueue(amazonSyncJob, { storeId: DIRECT.id });
    await t.enqueue(shopifySyncJob, { storeId: SHOPIFY_COM.id });
    await t.runJobs();
    // 1 小时后又有新订单，水位推到此刻
    t.clock.advance({ hours: 1 });
    amazon.put(DIRECT.id, amazonOrder(t, 0, { updatedAt: t.clock.now() }));
    shopify.put(SHOPIFY_COM.id, shopifyOrder(t, 0, { updatedAt: t.clock.now() }));
    await t.enqueue(amazonSyncJob, { storeId: DIRECT.id });
    await t.enqueue(shopifySyncJob, { storeId: SHOPIFY_COM.id });
    await t.runJobs();

    // 平台上变了而更新时间没变（镜像与平台不一致）；另有 3 天前更新、镜像里没有的两笔；10 天前更新的一笔
    amazon.put(DIRECT.id, { ...stale, status: 'SHIPPED' });
    shopify.put(SHOPIFY_COM.id, { ...shopStale, fulfillmentStatus: 'FULFILLED' });
    const missed = amazonOrder(t, 3);
    const shopMissed = shopifyOrder(t, 3);
    const old = amazonOrder(t, 10);
    amazon.put(DIRECT.id, missed);
    shopify.put(SHOPIFY_COM.id, shopMissed);
    amazon.put(DIRECT.id, old);

    // 增量照常（从水位往前几分钟起）：都拉不到
    t.clock.advance({ minutes: 4 });
    await t.enqueue(amazonPollJob, {});
    await t.enqueue(shopifyPollJob, {});
    await t.runJobs();
    expect(await t.findOrder(DIRECT.id, { platformOrderId: stale.orderId })).toMatchObject({
      status: 'UNSHIPPED',
    });
    expect((await t.ordersByEmail(SHOPIFY_COM.id, shopStale.email!))[0]?.status).toBe(
      'UNFULFILLED',
    );
    expect(await t.ordersByEmail(SHOPIFY_COM.id, shopMissed.email!)).toEqual([]);

    // 夜间对账（每天 03:30）：按平台更新时间取近 7 天，低优先级
    const before = amazonCalls().length;
    amazon.quota.reset();
    await t.enqueue(orderReconcileJob, {});
    await t.runJobs();
    expect(amazonCalls().slice(before)).toEqual(['searchOrders']);
    expect(amazon.quota.priorities).toEqual(['low', 'low']); // 两个亚马逊店铺各一页
    expect(await t.findOrder(DIRECT.id, { platformOrderId: stale.orderId })).toMatchObject({
      status: 'SHIPPED',
    });
    expect(await t.findOrder(DIRECT.id, { platformOrderId: missed.orderId })).toMatchObject({
      platformOrderId: missed.orderId,
    });
    expect((await t.ordersByEmail(SHOPIFY_COM.id, shopStale.email!))[0]).toMatchObject({
      status: 'FULFILLED',
    });
    expect(await t.ordersByEmail(SHOPIFY_COM.id, shopMissed.email!)).toHaveLength(1);
    // 上面两笔是对账写进镜像的，查的时候没有按订单号补拉；10 天前更新的不在对账窗口里，查的时候才补拉
    expect(amazonCalls().slice(before)).toEqual(['searchOrders']);
    await t.findOrder(DIRECT.id, { platformOrderId: old.orderId });
    expect(amazonCalls().slice(before)).toEqual(['searchOrders', 'getOrder']);
  });

  it('对账一致时镜像不改（同一版本内容一样不重写）', async () => {
    const before = await t.findOrder(DIRECT.id, { platformOrderId: lastAmazon().orderId });
    t.clock.advance({ days: 1 });
    await t.enqueue(orderReconcileJob, {});
    await t.runJobs();
    const after = await t.findOrder(DIRECT.id, { platformOrderId: lastAmazon().orderId });
    expect(after?.syncedAt).toEqual(before?.syncedAt);
  });

  /** Fake 上 Forcome Direct 最近更新的一笔 */
  function lastAmazon() {
    return amazon.orders(DIRECT.id).at(-1)!;
  }
});

describe('回补进行中增量同步不被饿死', () => {
  let t: TestHarness;
  let admin: ApiClient;
  let amazon: FakeAmazonOrders;
  let shopify: FakeShopify;

  beforeAll(async () => {
    ({ t, admin, amazon, shopify } = await start());
  });

  afterAll(async () => {
    await t.close();
  });

  for (const platform of ['amazon', 'shopify'] as const) {
    it(`${platform}：配额用完时回补的一页与增量同时排队，增量先拿到配额并写进镜像，回补稍后接着做完`, async () => {
      const storeId = platform === 'amazon' ? DIRECT.id : SHOPIFY_COM.id;
      const fake = platform === 'amazon' ? amazon : shopify;
      if (platform === 'amazon') {
        for (let i = 0; i < 60; i += 1) amazon.put(storeId, amazonOrder(t, 5 + (i % 80)));
      } else {
        for (let i = 0; i < 60; i += 1) shopify.put(storeId, shopifyOrder(t, 5 + (i % 50)));
      }
      await backfill(t, [storeId]);

      // 此刻来了一笔新订单，增量同步也排上了；平台配额已用完
      t.clock.advance({ minutes: 4 });
      let fresh: string;
      if (platform === 'amazon') {
        const o = amazonOrder(t, 0, { updatedAt: t.clock.now() });
        amazon.put(storeId, o);
        fresh = o.orderId;
        await t.enqueue(amazonSyncJob, { storeId });
      } else {
        const o = shopifyOrder(t, 0, { updatedAt: t.clock.now() });
        shopify.put(storeId, o);
        fresh = o.email!;
        await t.enqueue(shopifySyncJob, { storeId });
      }
      fake.quota.limit(0);
      const running = t.runJobs({ concurrently: true });
      await expect.poll(() => fake.quota.waiting()).toBe(2);
      expect(fake.quota.waiting('low')).toBe(1);

      // 配额恢复了一次：给增量。增量写完镜像、记了同步成功（最近同步为此刻），回补那一页还在等
      fake.quota.grant(1);
      const source = platform === 'amazon' ? 'amazon_orders' : 'shopify_orders';
      await expect
        .poll(async () =>
          (await orderSyncHealths(t.runtime.db, source)).get(storeId)?.lastSuccessAt?.toISOString(),
        )
        .toBe(t.clock.now().toISOString());
      expect(fake.quota.waiting('low')).toBe(1);
      const during = await card(admin, platform);
      expect(during.status).toBe('connected');
      expect(during.backfill).toMatchObject({ state: 'running', orders: 0 });
      // 新订单已在镜像里（直接查到，没有按订单号补拉）
      if (platform === 'amazon') {
        expect(await t.findOrder(storeId, { platformOrderId: fresh })).toMatchObject({
          platformOrderId: fresh,
        });
        expect(amazon.faultsOf(storeId).calls).not.toContain('getOrder');
      } else {
        expect((await t.ordersByEmail(storeId, fresh))[0]?.customerEmail).toBe(fresh);
      }

      fake.quota.unlimit();
      await running;
      await t.runJobs();
      // 这个店铺的回补做完了（另一个同平台店铺没回补，卡上仍为未开始）
      expect((await orderBackfills(t.runtime.db)).get(storeId)).toMatchObject({
        completed: true,
        orders: 61,
      });
    });
  }
});

describe('P18 回补行跟着进度变（汇总连接上的店铺）', () => {
  let t: TestHarness;
  let admin: ApiClient;
  let amazon: FakeAmazonOrders;

  beforeAll(async () => {
    ({ t, admin, amazon } = await start());
  });

  afterAll(async () => {
    await t.close();
  });

  it('未开始 → 进行中（已回补 N 笔）→ 已完成；上线后新加的店铺让它回到未开始，再执行一次只补新店', async () => {
    expect((await card(admin, 'amazon')).backfill).toEqual({
      days: 90,
      state: 'not_started',
      orders: 0,
      historyLimited: false,
    });
    expect((await card(admin, 'shopify')).backfill?.state).toBe('not_started');
    expect((await card(admin, 'gmail')).backfill).toBeNull();
    expect((await card(admin, 'dingtalk')).backfill).toBeNull();

    for (let i = 0; i < 60; i += 1) amazon.put(DIRECT.id, amazonOrder(t, 1 + i));
    amazon.put(AUTO.id, amazonOrder(t, 2));
    const started = await backfill(t);
    expect(started.map((r) => [r.store.name, r.result])).toEqual(
      stores.map((s) => [s.name, 'started']),
    );
    await expect(t.runJobs({ maxRounds: 1 })).rejects.toThrow(/仍未空闲/);
    expect((await card(admin, 'amazon')).backfill).toEqual({
      days: 90,
      state: 'running',
      orders: 51,
      historyLimited: false,
    });
    await t.runJobs();
    expect((await card(admin, 'amazon')).backfill).toEqual({
      days: 90,
      state: 'completed',
      orders: 61,
      historyLimited: false,
    });

    // 上线后新加一个亚马逊店铺：先同步一次（连接上），回补行回到未开始
    const res = await admin.post('/api/channel/stores', {
      name: 'Forcome Outdoor',
      platform: 'amazon',
      sites: ['US'],
      defaultSite: 'US',
      mailboxes: ['amz-outdoor@forcome.com'],
      platformId: 'A2OUTDOOR7Q2M9',
    });
    expect(res.status).toBe(201);
    const outdoor = ((await res.json()) as { id: string }).id;
    await t.runJobs();
    expect((await card(admin, 'amazon')).backfill?.state).toBe('not_started');
    const again = await backfill(t);
    expect(again.filter((r) => r.result === 'started').map((r) => r.store.id)).toEqual([outdoor]);
    await t.runJobs();
    expect((await card(admin, 'amazon')).backfill?.state).toBe('completed');
  });

  it('店铺换了数据源：回补按新配置从头算（回到未开始）', async () => {
    const res = await admin.get('/api/channel/settings');
    const direct = channelSettingsSchema
      .parse(await res.json())
      .stores.find((s) => s.id === DIRECT.id)!;
    const saved = await admin.put(`/api/channel/stores/${DIRECT.id}`, {
      version: direct.version,
      name: direct.name,
      platform: direct.platform,
      sites: direct.sites,
      defaultSite: direct.defaultSite,
      mailboxes: direct.mailboxes,
      adapterMode: direct.adapterMode,
      platformId: 'A1NEWSELLER9XK3',
    });
    expect(saved.status).toBe(200);
    await t.runJobs();
    expect((await orderBackfills(t.runtime.db)).has(DIRECT.id)).toBe(false);
    expect((await card(admin, 'amazon')).backfill?.state).toBe('not_started');
  });

  it('部分店铺未连接（改成真实接口而没配置凭据）：卡片最差状态为未连接，回补行照常按连接上的店铺汇总（协调者 2026-10-06 决定）', async () => {
    await backfill(t);
    await t.runJobs();
    expect((await card(admin, 'amazon')).backfill?.state).toBe('completed');
    const res = await admin.get('/api/channel/settings');
    const auto = channelSettingsSchema
      .parse(await res.json())
      .stores.find((s) => s.id === AUTO.id)!;
    const saved = await admin.put(`/api/channel/stores/${AUTO.id}`, {
      version: auto.version,
      name: auto.name,
      platform: auto.platform,
      sites: auto.sites,
      defaultSite: auto.defaultSite,
      mailboxes: auto.mailboxes,
      platformId: auto.platformId,
      adapterMode: 'real',
    });
    expect(saved.status).toBe(200);
    await t.runJobs();
    const amazon = await card(admin, 'amazon');
    expect(amazon.status).toBe('not_connected');
    // Forcome Auto 未连接、它的回补按新配置清掉了，不计；其余连接上的店铺都回补完了
    expect(amazon.backfill).toMatchObject({ days: 90, state: 'completed' });
  });
});

describe('生产环境没有配置 SP-API 与 Shopify（用户 2026-10-04 口径）', () => {
  let p: TestHarness;
  let prodAdmin: ApiClient;

  beforeAll(async () => {
    p = await startTestHarness({ appEnv: 'production', feeds: () => [] });
    prodAdmin = await p.loginAs('管理员');
  });

  afterAll(async () => {
    await p.close();
  });

  it('开始回补与夜间对账都照常运行、不记失败；两张卡没有回补行（没有连接上的店铺）', async () => {
    for (const store of [
      {
        name: 'Forcome Direct',
        platform: 'amazon',
        sites: ['US'],
        defaultSite: 'US',
        mailboxes: ['amz-direct@forcome.com'],
        platformId: 'A1FD7Q2M9XK3LC',
      },
      {
        name: 'forcome.mx',
        platform: 'shopify',
        sites: ['MX'],
        defaultSite: 'MX',
        mailboxes: ['support@forcome.mx'],
        platformId: 'forcome-mx.myshopify.com',
      },
    ]) {
      expect((await prodAdmin.post('/api/channel/stores', store)).status).toBe(201);
    }
    await p.runJobs();
    expect((await startOrderBackfill(p.runtime, listOrderStores)).map((r) => r.result)).toEqual([
      'started',
      'started',
    ]);
    await p.enqueue(orderReconcileJob, {});
    await p.runJobs();
    await p.enqueue(orderSweepResumeJob, {});
    await p.runJobs();
    const backfills = [...(await orderBackfills(p.runtime.db)).values()];
    expect(backfills.map((b) => [b.completed, b.orders])).toEqual([
      [false, 0],
      [false, 0],
    ]);
    const data = channelSettingsSchema.parse(
      await (await prodAdmin.get('/api/channel/settings')).json(),
    );
    for (const kind of ['amazon', 'shopify'] as const) {
      expect(data.channels.find((c) => c.kind === kind)).toMatchObject({
        status: 'not_connected',
        issues: [],
        backfill: null,
      });
    }
  });
});

describe('一页取到一半时被从头重开（--again 或夜间对账重开）', () => {
  let t: TestHarness;
  let amazon: FakeAmazonOrders;

  beforeAll(async () => {
    ({ t, amazon } = await start());
  });

  afterAll(async () => {
    await t.close();
  });

  it('旧一轮在途的那一页不记进新的一轮：新一轮只算自己窗口里的订单', async () => {
    for (let i = 0; i < 60; i += 1) amazon.put(DIRECT.id, amazonOrder(t, 1 + i));
    // 只在旧窗口里（89.5 天前下的单）：2 天后重开的新窗口（往前 90 天）已不含它
    amazon.put(DIRECT.id, amazonOrder(t, 89.5));
    await backfill(t, [DIRECT.id]);
    const before = amazon.faultsOf(DIRECT.id).calls.length;
    amazon.quota.limit(0);
    const running = t.runJobs({ concurrently: true });
    await expect.poll(() => amazon.quota.waiting('low')).toBe(1);

    // 旧一轮的第 1 页还在等配额时，2 天后有人 --again 从头重开
    t.clock.advance({ days: 2 });
    await backfill(t, [DIRECT.id], true);
    amazon.quota.unlimit();
    await running;
    await t.runJobs();

    expect((await orderBackfills(t.runtime.db)).get(DIRECT.id)).toMatchObject({
      completed: true,
      orders: 60,
    });
    // 旧一轮的那一页取到了但没认领：新一轮自己从第 1 页取到第 2 页（共 3 次）；认领了的话新一轮会接着旧游标只取 1 页
    expect(amazon.faultsOf(DIRECT.id).calls.slice(before)).toEqual([
      'searchOrders',
      'searchOrders',
      'searchOrders',
    ]);
  });
});
