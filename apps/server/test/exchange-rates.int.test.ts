import {
  emptyRegistrationInput,
  exchangeRatesOnSchema,
  ledgerItemSchema,
  ledgerSchema,
  type ExchangeRatesOn,
  type LedgerItem,
  type RegistrationInput,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncExchangeRatesJob } from '../src/modules/core';
import { exchangeRateClient, type FakeExchangeRates } from '../src/modules/integration';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';
import type { JobRunReport } from './run-jobs';

/*
 * 汇率（待办 20；R-FL-06、E-20、AC-P1-08，规格 core「汇率」与 aftersales「汇率」）：
 * 每日任务从欧洲央行取参考汇率、失败改 Frankfurter，按 EUR 交叉计算入库；台账保存时按费用发生日取汇率（当天没有取此前
 * 最近一个有汇率的日期），每个金额保存原币、汇率、汇率日期与来源、冻结美元值；售后负责人可改汇率并记审计。
 * 外部来源一律是 Fake（t.clients.fake(exchangeRateClient)）：publish 公布某天的汇率（以「1 USD = x 原币」写），
 * faults 让欧洲央行（操作 ecb）或 Frankfurter（frankfurter）失败。定时任务在测试里用 t.enqueue 显式排。
 */

const fixture = getDemoFixture();
const DIRECT = fixture.stores.find((s) => s.name === 'Forcome Direct')!;
const WANG = fixture.members.find((m) => m.key === 'wanglei')!;
/** 原型的演示汇率 */
const DEMO = { MXN: '18.00', CAD: '1.36' };

/** Forcome Direct 的一张「退款或部分补偿」登记：额外赔偿 MX$889.00（原型 S-20260911-0020 的金额） */
function refund(
  feeDate: string,
  overrides: Partial<RegistrationInput['fees']> = {},
): RegistrationInput {
  const empty = emptyRegistrationInput();
  return {
    ...empty,
    method: 'refund_or_compensation',
    storeId: DIRECT.id,
    site: 'MX',
    orderNumber: '302-8811234-9901122',
    customerName: 'Mateo Rivas',
    feeDate,
    ownerId: WANG.id,
    responsibility: 'customer_use',
    ratios: {
      product: { fsh: 100, factory: 0 },
      freight: { fsh: 100, factory: 0 },
      other: { fsh: 100, factory: 0 },
    },
    fees: {
      productCost: { amount: '0', currency: 'USD' },
      freight: { amount: '0', currency: 'USD' },
      compensation: { amount: '889.00', currency: 'MXN' },
      otherCost: { amount: '0', currency: 'USD' },
      ...overrides,
    },
  };
}

interface Context {
  t: TestHarness;
  rates: FakeExchangeRates;
  supervisor: ApiClient;
  owner: ApiClient;
  agent: ApiClient;
}

async function setUp(now: string): Promise<Context> {
  const t = await startTestHarness({ now });
  await t.loadFixtures();
  return {
    t,
    rates: t.clients.fake(exchangeRateClient),
    supervisor: await t.loginAs('客服主管'),
    owner: await t.loginAs('售后负责人'),
    agent: await t.loginAs('坐席'),
  };
}

/** 排一次每日同步（定时在测试里不跑）并跑完 */
async function sync(
  t: TestHarness,
  options: { allowFailures?: boolean } = {},
): Promise<JobRunReport> {
  await t.enqueue(syncExchangeRatesJob, {});
  return t.runJobs(options);
}

async function ratesOn(client: ApiClient, date: string): Promise<ExchangeRatesOn> {
  const res = await client.get(`/api/aftersales/exchange-rates?date=${date}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return exchangeRatesOnSchema.parse(await res.json());
}

async function register(client: ApiClient, input: RegistrationInput): Promise<LedgerItem> {
  const res = await client.post('/api/aftersales/registrations', input);
  expect(res.status, await res.clone().text()).toBe(201);
  return ledgerItemSchema.parse(await res.json());
}

async function ledgerRow(client: ApiClient, number: string): Promise<LedgerItem> {
  const res = await client.get('/api/aftersales/ledger');
  expect(res.status).toBe(200);
  const found = ledgerSchema.parse(await res.json()).items.find((i) => i.number === number);
  expect(found, number).toBeDefined();
  return found!;
}

describe('同步：主源失败走备用源（R-FL-06）', () => {
  let c: Context;

  beforeAll(async () => {
    // 演示时刻 2026-09-11 10:20（北京时间）：欧洲央行已公布 09-10，09-11 的要到北京时间晚上才公布
    c = await setUp('2026-09-11T10:20:00+08:00');
  });

  afterAll(async () => {
    await c.t.close();
  });

  it('欧洲央行取不到时改用 Frankfurter，按 EUR 交叉计算出 USD/MXN、USD/CAD，来源记备用源', async () => {
    c.rates.publish('2026-09-10', DEMO);
    c.rates.faults.failNext({ kind: 'error', status: 503 }, { operation: 'ecb' });
    await sync(c.t);
    expect(c.rates.faults.calls).toEqual(['ecb', 'frankfurter']);
    expect(await ratesOn(c.owner, '2026-09-10')).toEqual({
      date: '2026-09-10',
      rates: {
        MXN: { rate: '18.000000', date: '2026-09-10', source: 'frankfurter' },
        CAD: { rate: '1.360000', date: '2026-09-10', source: 'frankfurter' },
      },
    });
  });

  it('主源正常时用欧洲央行；已入库的日期不重复取、不覆盖', async () => {
    c.t.clock.set('2026-09-12T06:00:00+08:00');
    c.rates.publish('2026-09-11', { MXN: '18.50', CAD: '1.37' });
    c.rates.faults.reset();
    await sync(c.t);
    expect(c.rates.faults.calls).toEqual(['ecb']);
    const on11 = await ratesOn(c.owner, '2026-09-11');
    expect(on11.rates.MXN).toEqual({ rate: '18.500000', date: '2026-09-11', source: 'ecb' });
    // 09-10 仍是第一次从备用源取到的那条
    expect((await ratesOn(c.owner, '2026-09-10')).rates.MXN?.source).toBe('frankfurter');
  });

  it('查询汇率只给能新建登记的角色（坐席 403）', async () => {
    expect((await c.agent.get('/api/aftersales/exchange-rates?date=2026-09-11')).status).toBe(403);
    expect((await c.supervisor.get('/api/aftersales/exchange-rates?date=2026-09-11')).status).toBe(
      200,
    );
    expect((await c.owner.get('/api/aftersales/exchange-rates?date=2026-9-11')).status).toBe(400);
  });
});

describe('两个来源都取不到：取此前最近一个有汇率的日期（E-20）', () => {
  let c: Context;

  beforeAll(async () => {
    c = await setUp('2026-09-08T06:00:00+08:00');
  });

  afterAll(async () => {
    await c.t.close();
  });

  it('还没有任何汇率时，非美元金额不能保存：该金额下方报错，不写数据；美元金额照常保存', async () => {
    const res = await c.supervisor.post(
      '/api/aftersales/registrations',
      refund('2026-09-07', { productCost: { amount: '12.00', currency: 'CAD' } }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields?: unknown }).fields).toEqual({
      'fees.productCost': '费用发生日及之前没有汇率，暂时不能折算美元',
      'fees.compensation': '费用发生日及之前没有汇率，暂时不能折算美元',
    });
    const usdOnly = await register(
      c.supervisor,
      refund('2026-09-07', { compensation: { amount: '49.39', currency: 'USD' } }),
    );
    expect(usdOnly.fees?.compensation).toEqual({
      amount: '49.39',
      currency: 'USD',
      usd: '49.39',
      rate: null,
    });
  });

  it('两者都失败时任务失败、不写数据；当天的登记按此前最近一个有汇率的日期折算，不取之后的日期', async () => {
    c.rates.publish('2026-09-07', DEMO);
    await sync(c.t);

    // 09-08 至 09-10 两个来源都取不到（任务按队列设置稍后重试）
    c.t.clock.set('2026-09-11T06:00:00+08:00');
    c.rates.publish('2026-09-08', { MXN: '19.00', CAD: '1.40' });
    c.rates.faults.failNext({ kind: 'timeout' }, { operation: 'ecb' });
    c.rates.faults.failNext({ kind: 'error', status: 502 }, { operation: 'frankfurter' });
    const report = await sync(c.t, { allowFailures: true });
    expect(report.failed.map((f) => f.name)).toEqual(['core.sync_exchange_rates']);
    expect((await ratesOn(c.owner, '2026-09-10')).rates.MXN).toEqual({
      rate: '18.000000',
      date: '2026-09-07',
      source: 'ecb',
    });

    const saved = await register(c.supervisor, refund('2026-09-10'));
    expect(saved.fees?.compensation).toEqual({
      amount: '889.00',
      currency: 'MXN',
      usd: '49.39',
      rate: { rate: '18.000000', date: '2026-09-07', source: 'ecb' },
    });

    // 来源恢复：09-08、09-11 有汇率（09-09、09-10 没有）。费用发生日 09-10 取此前的 09-08，不取之后的 09-11
    c.rates.publish('2026-09-11', { MXN: '20.00', CAD: '1.50' });
    c.rates.faults.reset();
    await sync(c.t);
    expect((await ratesOn(c.owner, '2026-09-11')).rates.MXN?.date).toBe('2026-09-11');
    const later = await register(c.supervisor, refund('2026-09-10'));
    expect(later.fees?.compensation?.rate?.date).toBe('2026-09-08');
    expect((await ratesOn(c.owner, '2026-09-09')).rates.MXN?.date).toBe('2026-09-08');
    expect((await ratesOn(c.owner, '2026-09-06')).rates.MXN).toBeNull();
  });
});

describe('台账按费用发生日取汇率并冻结美元值（AC-P1-08、R-FL-06）', () => {
  let c: Context;
  let saved: LedgerItem;

  beforeAll(async () => {
    c = await setUp('2026-09-11T10:20:00+08:00');
    c.rates.publish('2026-09-10', DEMO);
    await sync(c.t);
  });

  afterAll(async () => {
    await c.t.close();
  });

  it('示例数据：S-20260911-0020 的额外赔偿 MX$889.00 冻结为 $49.39，汇率 09-10', async () => {
    expect((await ledgerRow(c.owner, 'S-20260911-0020')).fees?.compensation).toEqual({
      amount: '889.00',
      currency: 'MXN',
      usd: '49.39',
      rate: { rate: '18.000000', date: '2026-09-10', source: 'ecb' },
    });
    // 美元金额不折算：美元值就是原值，没有汇率
    expect((await ledgerRow(c.owner, 'S-20260904-0013')).fees?.productCost).toMatchObject({
      currency: 'USD',
      rate: null,
    });
  });

  it('AC-P1-08：额外赔偿 MX$889.00，费用发生日当天欧洲央行没有汇率 → 取此前最近一个有汇率的日期并标注，冻结美元值四舍五入到分', async () => {
    saved = await register(
      c.supervisor,
      refund('2026-09-11', { productCost: { amount: '12.00', currency: 'CAD' } }),
    );
    expect(saved.fees).toEqual({
      productCost: {
        amount: '12.00',
        currency: 'CAD',
        // 12 ÷ 1.36 = 8.8235…
        usd: '8.82',
        rate: { rate: '1.360000', date: '2026-09-10', source: 'ecb' },
      },
      freight: { amount: '0.00', currency: 'USD', usd: '0.00', rate: null },
      // 889 ÷ 18 = 49.3888…
      compensation: {
        amount: '889.00',
        currency: 'MXN',
        usd: '49.39',
        rate: { rate: '18.000000', date: '2026-09-10', source: 'ecb' },
      },
      otherCost: { amount: '0.00', currency: 'USD', usd: '0.00', rate: null },
    });
    expect((await ledgerRow(c.owner, saved.number)).fees).toEqual(saved.fees);
    const [audit] = await c.t.auditRecords({ action: 'aftersales.create', objectId: saved.id });
    expect(audit?.after).toMatchObject({ fees: saved.fees });
  });

  it('汇率每日更新不改变已保存记录的冻结美元值；之后新登记的才用新汇率', async () => {
    c.t.clock.set('2026-09-12T06:00:00+08:00');
    c.rates.publish('2026-09-11', { MXN: '20.00', CAD: '1.50' });
    await sync(c.t);
    expect((await ledgerRow(c.owner, saved.number)).fees).toEqual(saved.fees);
    expect((await ledgerRow(c.owner, 'S-20260911-0020')).fees?.compensation?.usd).toBe('49.39');

    const next = await register(c.supervisor, refund('2026-09-11'));
    expect(next.fees?.compensation).toEqual({
      amount: '889.00',
      currency: 'MXN',
      usd: '44.45',
      rate: { rate: '20.000000', date: '2026-09-11', source: 'ecb' },
    });
  });
});

describe('修改汇率：只有售后负责人，记审计（PRD 10.1「补登与修改汇率」）', () => {
  let c: Context;
  let saved: LedgerItem;

  beforeAll(async () => {
    c = await setUp('2026-09-11T10:20:00+08:00');
    c.rates.publish('2026-09-10', DEMO);
    await sync(c.t);
    saved = await register(c.supervisor, refund('2026-09-11'));
  });

  afterAll(async () => {
    await c.t.close();
  });

  const change = (client: ApiClient, body: unknown) =>
    client.put(`/api/aftersales/${saved.number}/rates`, body);

  it('客服主管、坐席改汇率被拒绝（403），数据不变、不记修改', async () => {
    for (const client of [c.supervisor, c.agent]) {
      const res = await change(client, {
        version: saved.version,
        rates: { compensation: '17.50' },
      });
      expect(res.status).toBe(403);
    }
    expect((await ledgerRow(c.owner, saved.number)).fees).toEqual(saved.fees);
    expect(await c.t.auditRecords({ action: 'aftersales.change_rate' })).toEqual([]);
  });

  it('售后负责人改汇率：冻结美元值按新汇率重算，汇率日期为费用发生日、来源「手工修改」，记审计（前后值）', async () => {
    const res = await change(c.owner, { version: saved.version, rates: { compensation: '17.5' } });
    expect(res.status, await res.clone().text()).toBe(200);
    const changed = ledgerItemSchema.parse(await res.json());
    // 889 ÷ 17.5 = 50.8
    expect(changed.fees?.compensation).toEqual({
      amount: '889.00',
      currency: 'MXN',
      usd: '50.80',
      rate: { rate: '17.500000', date: '2026-09-11', source: 'manual' },
    });
    expect(changed.version).toBe(saved.version + 1);
    expect((await ledgerRow(c.owner, saved.number)).fees).toEqual(changed.fees);

    const audits = await c.t.auditRecords({ action: 'aftersales.change_rate' });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorName: WANG.name,
      actorRoles: ['aftersales_owner'],
      objectType: 'aftersales',
      objectId: saved.id,
      objectLabel: saved.number,
      storeId: DIRECT.id,
      before: { fees: { compensation: saved.fees?.compensation } },
      after: { fees: { compensation: changed.fees?.compensation } },
    });
    saved = changed;
  });

  it('汇率填错、美元金额、版本过期：报错，不修改', async () => {
    const fields = async (body: unknown) => {
      const res = await change(c.owner, body);
      expect(res.status).toBe(400);
      return ((await res.json()) as { fields?: unknown }).fields;
    };
    expect(await fields({ version: saved.version, rates: { compensation: '0' } })).toEqual({
      'rates.compensation': '汇率须大于 0，最多 6 位整数与 6 位小数',
    });
    expect(await fields({ version: saved.version, rates: { productCost: '1.2' } })).toEqual({
      'rates.productCost': '美元金额不用汇率',
    });
    const stale = await change(c.owner, {
      version: saved.version - 1,
      rates: { compensation: '19' },
    });
    expect(stale.status).toBe(409);
    expect((await ledgerRow(c.owner, saved.number)).fees).toEqual(saved.fees);
    expect(await c.t.auditRecords({ action: 'aftersales.change_rate' })).toHaveLength(1);
  });

  it('不在店铺范围内的单：越权（403）并记 access.denied', async () => {
    const outsider = await c.t.addMember({
      name: '赵敏',
      dept: 'FSH / 售后',
      roles: ['aftersales_owner'],
      allStores: false,
      storeIds: [fixture.stores.find((s) => s.name === 'forcome.com')!.id],
    });
    const client = await c.t.loginAs({ memberId: outsider });
    const res = await client.put(`/api/aftersales/${saved.number}/rates`, {
      version: saved.version,
      rates: { compensation: '19' },
    });
    expect(res.status).toBe(403);
    expect(await c.t.auditRecords({ action: 'access.denied', objectId: saved.id })).toHaveLength(1);
  });
});

describe('示例数据的加载步骤补齐加列之前的非美元金额', () => {
  it('S-20260911-0020 的美元值与汇率被清空后，重新灌示例数据按夹具补齐', async () => {
    const c = await setUp('2026-09-11T10:20:00+08:00');
    try {
      const before = (await ledgerRow(c.owner, 'S-20260911-0020')).fees;
      // 迁移 0013 加列时，库里已有的这张单只有原币（迁移 0014 只补得了美元金额）
      await c.t.runtime.db.execute(sql`
        UPDATE aftersales.aftersales
        SET compensation_usd = NULL, compensation_rate = NULL, compensation_rate_date = NULL,
            compensation_rate_source = NULL
        WHERE number = 'S-20260911-0020'`);
      expect((await c.owner.get('/api/aftersales/ledger')).status).toBe(500);
      await c.t.loadFixtures();
      expect((await ledgerRow(c.owner, 'S-20260911-0020')).fees).toEqual(before);
    } finally {
      await c.t.close();
    }
  });
});
