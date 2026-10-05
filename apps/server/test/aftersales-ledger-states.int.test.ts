import {
  aftersalesDetailSchema,
  emptyRegistrationInput,
  ledgerItemSchema,
  ledgerSchema,
  type AftersalesDetail,
  type Ledger,
  type LedgerItem,
  type RegistrationInput,
  type RegistrationUpdate,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncExchangeRatesJob } from '../src/modules/core';
import { exchangeRateClient } from '../src/modules/integration';
import { aftersales } from '../src/modules/aftersales/schema';
import type { ApiClient } from './api-client';
import { startTestHarness, TEST_CLIENT_IP, type TestHarness } from './harness';

/*
 * 台账的状态与登记完整率（待办 21；6.5「第一阶段台账状态」、PRD 10.1、R-AS-08、P13「第一阶段」、S13–S15）。
 * 以角色身份调接口：编辑登记、设为已完成与撤销、取消、补登，当月登记完整率；权限、审计与并发（G7）。
 * 示例数据先灌入（含原型的 12 张台账单：9 月已完成 8 张，S-20260909-0016 缺快递单号），演示时刻 2026-09-11 10:20。
 */

const fixture = getDemoFixture();
const storeNamed = (name: string) => fixture.stores.find((s) => s.name === name)!;
const DIRECT = storeNamed('Forcome Direct');
const COM = storeNamed('forcome.com');
const memberKeyed = (key: string) => fixture.members.find((m) => m.key === key)!;
const WANG = memberKeyed('wanglei');

/** 一张登记齐全的寄配件单（寄件一节、四项费用都填了；forcome.com · 产品质量问题 · FQD） */
function shippedParts(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  const empty = emptyRegistrationInput();
  return {
    ...empty,
    method: 'send_parts',
    storeId: COM.id,
    site: 'US',
    orderNumber: '#1063',
    customerName: 'Olivia Turner',
    feeDate: '2026-09-11',
    ownerId: WANG.id,
    responsibility: 'product_quality',
    factory: 'FQD',
    ratios: {
      product: { fsh: 0, factory: 100 },
      freight: { fsh: 0, factory: 100 },
      other: { fsh: 0, factory: 100 },
    },
    partSku: 'FC-V2-HF01',
    partQuantity: 1,
    shipper: 'yicang',
    carrier: 'UPS Ground',
    shipDate: '2026-09-11',
    trackingNumber: '1Z4R28830358229999',
    fees: {
      productCost: { amount: '3.20', currency: 'USD' },
      freight: { amount: '6.80', currency: 'USD' },
      compensation: { amount: '0.00', currency: 'USD' },
      otherCost: { amount: '0.00', currency: 'USD' },
    },
    ...overrides,
  };
}

/** 一张登记齐全的调整安装方式（不寄东西，没有寄件一节） */
function adjusted(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  return shippedParts({
    method: 'adjust_installation',
    responsibility: 'customer_use',
    factory: null,
    ratios: {
      product: { fsh: 100, factory: 0 },
      freight: { fsh: 100, factory: 0 },
      other: { fsh: 100, factory: 0 },
    },
    partSku: null,
    partQuantity: null,
    shipper: null,
    carrier: '',
    shipDate: null,
    trackingNumber: '',
    ...overrides,
  });
}

async function ledger(client: ApiClient, query = ''): Promise<Ledger> {
  const res = await client.get(`/api/aftersales/ledger${query}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ledgerSchema.parse(await res.json());
}

async function register(client: ApiClient, input: RegistrationInput): Promise<LedgerItem> {
  const res = await client.post('/api/aftersales/registrations', input);
  expect(res.status, await res.clone().text()).toBe(201);
  return ledgerItemSchema.parse(await res.json());
}

async function detail(client: ApiClient, number: string): Promise<AftersalesDetail> {
  const res = await client.get(`/api/aftersales/${number}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return aftersalesDetailSchema.parse(await res.json());
}

async function complete(client: ApiClient, item: { number: string; version: number }) {
  const res = await client.post(`/api/aftersales/${item.number}/complete`, {
    version: item.version,
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return ledgerItemSchema.parse(await res.json());
}

function update(client: ApiClient, number: string, body: RegistrationUpdate) {
  return client.patch(`/api/aftersales/${number}`, body);
}

async function fieldsOf(res: Response, status = 400) {
  expect(res.status, await res.clone().text()).toBe(status);
  const body = (await res.json()) as { error: string; fields?: Record<string, string> };
  return body.fields;
}

describe('当月登记完整率（R-AS-08、AC-P1-06、AC-P1-07）', () => {
  let t: TestHarness;
  let owner: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    owner = await t.loginAs('售后负责人');
  });

  afterAll(async () => {
    await t.close();
  });

  it('示例数据：9 月已完成 8 张，S-20260909-0016 缺快递单号 → 7 / 8（原型「9 月登记完整率 87.5% · 7 / 8」）', async () => {
    const { completion, items } = await ledger(owner);
    expect(completion).toEqual({ month: '2026-09', completed: 8, complete: 7 });
    expect(items.find((i) => i.number === 'S-20260909-0016')?.missing).toEqual(['trackingNumber']);
  });

  it('完整率随店铺筛选变化、不随日期筛选变化', async () => {
    // forcome.com 的已完成单：0011、0013、0016（缺快递单号）
    expect((await ledger(owner, `?store=${COM.id}`)).completion).toEqual({
      month: '2026-09',
      completed: 3,
      complete: 2,
    });
    expect((await ledger(owner, `?store=${DIRECT.id}`)).completion).toEqual({
      month: '2026-09',
      completed: 5,
      complete: 5,
    });
    // 日期筛选（费用发生日）只筛列表，完整率不变
    const dated = await ledger(owner, '?from=2026-09-10&to=2026-09-11');
    expect(dated.items.every((i) => i.number >= 'S-20260910')).toBe(true);
    expect(dated.items.length).toBeLessThan(12);
    expect(dated.completion).toEqual({ month: '2026-09', completed: 8, complete: 7 });
  });

  it('完整率随店铺数据范围变化：只授权 forcome.com 的售后负责人看到 2 / 3', async () => {
    const id = await t.addMember({
      name: '孙杰',
      dept: 'FSH / 售后',
      roles: ['aftersales_owner'],
      allStores: false,
      storeIds: [COM.id],
    });
    const limited = await t.loginAs({ memberId: id });
    expect((await ledger(limited)).completion).toEqual({
      month: '2026-09',
      completed: 3,
      complete: 2,
    });
  });

  it('点完整率筛出缺字段的已完成单：只列当月缺字段的已完成单，完整率不变', async () => {
    const filtered = await ledger(owner, '?missing=1');
    expect(filtered.items.map((i) => i.number)).toEqual(['S-20260909-0016']);
    expect(filtered.completion).toEqual({ month: '2026-09', completed: 8, complete: 7 });
  });

  it('AC-P1-07：历史导入的已完成单缺字段，不计入完整率的分子与分母，也不在「缺字段」筛选里', async () => {
    // 历史导入命令随待办 27；在那之前测试直接写一张历史导入的已完成单（缺快递单号与费用）
    await t.runtime.db.insert(aftersales).values({
      number: 'S-20260801-9001',
      status: 'completed',
      origin: 'history_import',
      storeId: COM.id,
      site: 'US',
      orderNumber: '#0901',
      customerName: 'History Row',
      method: 'send_parts',
      responsibility: 'customer_use',
      feeDate: '2026-09-05',
      completedAt: new Date('2026-09-06T02:00:00Z'),
      createdAt: new Date('2026-09-06T02:00:00Z'),
      updatedAt: new Date('2026-09-06T02:00:00Z'),
    });
    const { completion, items } = await ledger(owner);
    expect(completion).toEqual({ month: '2026-09', completed: 8, complete: 7 });
    expect(items.some((i) => i.number === 'S-20260801-9001')).toBe(true);
    expect((await ledger(owner, '?missing=1')).items.map((i) => i.number)).toEqual([
      'S-20260909-0016',
    ]);
  });

  it('当月没有已完成的单：完成数为 0（界面写「—」）', async () => {
    t.clock.set('2026-11-15T10:00:00+08:00');
    owner = await t.loginAs('售后负责人');
    expect((await ledger(owner)).completion).toEqual({
      month: '2026-11',
      completed: 0,
      complete: 0,
    });
  });
});

describe('AC-P1-06：当月 10 张已完成，1 张寄配件缺快递单号 → 90%；调整安装方式没有快递单号不算缺失', () => {
  let t: TestHarness;
  let owner: ApiClient;

  beforeAll(async () => {
    // 10 月：示例数据的已完成单都在 9 月，不计入
    t = await startTestHarness({ now: '2026-10-12T10:00:00+08:00' });
    await t.loadFixtures();
    owner = await t.loginAs('售后负责人');
  });

  afterAll(async () => {
    await t.close();
  });

  it('设为已完成后计入当月完整率，缺快递单号的那张标「缺 1 项」', async () => {
    const inputs = [
      ...Array.from({ length: 8 }, (_, i) =>
        shippedParts({ customerName: `Customer ${i + 1}`, feeDate: '2026-10-12' }),
      ),
      shippedParts({ customerName: 'No Tracking', feeDate: '2026-10-12', trackingNumber: '' }),
      adjusted({ customerName: 'Adjusted', feeDate: '2026-10-12' }),
    ];
    const done: LedgerItem[] = [];
    for (const input of inputs) done.push(await complete(owner, await register(owner, input)));
    expect(done.map((i) => i.status)).toEqual(Array(10).fill('completed'));

    const { completion, items } = await ledger(owner);
    expect(completion).toEqual({ month: '2026-10', completed: 10, complete: 9 });
    const created = items.filter((i) => done.some((d) => d.id === i.id));
    expect(created.filter((i) => i.missing.length > 0).map((i) => i.customerName)).toEqual([
      'No Tracking',
    ]);
    expect(items.find((i) => i.customerName === 'No Tracking')?.missing).toEqual([
      'trackingNumber',
    ]);
    expect(items.find((i) => i.customerName === 'Adjusted')?.missing).toEqual([]);
  });
});

describe('跨月边界按北京时间归月（R-AS-08：当月按完成时间，Asia/Shanghai）', () => {
  let t: TestHarness;
  let owner: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness({ now: '2026-09-30T23:58:00+08:00' });
    await t.loadFixtures();
    owner = await t.loginAs('售后负责人');
  });

  afterAll(async () => {
    await t.close();
  });

  it('北京时间 09-30 23:59 完成的算 9 月，10-01 00:30（UTC 还是 09-30）完成的算 10 月', async () => {
    const lastOfSeptember = await register(
      owner,
      shippedParts({ customerName: 'September 30', feeDate: '2026-09-30' }),
    );
    const firstOfOctober = await register(
      owner,
      shippedParts({ customerName: 'October 1', feeDate: '2026-09-30', trackingNumber: '' }),
    );
    t.clock.set('2026-09-30T23:59:00+08:00');
    await complete(owner, lastOfSeptember);
    t.clock.set('2026-10-01T00:30:00+08:00'); // UTC 2026-09-30 16:30
    await complete(owner, firstOfOctober);

    t.clock.set('2026-10-01T10:00:00+08:00');
    expect((await ledger(owner)).completion).toEqual({
      month: '2026-10',
      completed: 1,
      complete: 0,
    });
    t.clock.set('2026-09-30T23:59:30+08:00');
    expect((await ledger(owner)).completion).toEqual({
      month: '2026-09',
      completed: 9,
      complete: 8,
    });
  });
});

describe('编辑登记、设为已完成与撤销（6.5、10.1「○」）', () => {
  let t: TestHarness;
  let supervisor: ApiClient;
  let owner: ApiClient;
  let agent: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    t.clients.fake(exchangeRateClient).publish('2026-09-10', fixture.exchangeRates.quotes);
    await t.enqueue(syncExchangeRatesJob, {});
    await t.runJobs();
    supervisor = await t.loginAs('客服主管');
    owner = await t.loginAs('售后负责人');
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  it('登记人可编辑自己登记的进行中单（寄出后补承运方式、寄出日期、快递单号），修改记审计', async () => {
    const item = await register(
      supervisor,
      shippedParts({ customerName: 'Edit Me', carrier: '', shipDate: null, trackingNumber: '' }),
    );
    const res = await update(supervisor, item.number, {
      version: item.version,
      changes: { carrier: 'UPS Ground', shipDate: '2026-09-11', trackingNumber: '1Z-EDITED' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const saved = aftersalesDetailSchema.parse(await res.json());
    expect(saved).toMatchObject({
      status: 'in_progress',
      carrier: 'UPS Ground',
      shipDate: '2026-09-11',
      trackingNumber: '1Z-EDITED',
      customerName: 'Edit Me',
      version: item.version + 1,
      updatedBy: '周敏',
    });

    const [record] = await t.auditRecords({ action: 'aftersales.update', objectId: item.id });
    expect(record).toMatchObject({
      actorName: '周敏',
      objectType: 'aftersales',
      objectLabel: item.number,
      storeId: COM.id,
      ip: TEST_CLIENT_IP,
    });
    expect(record?.before).toMatchObject({ carrier: null, trackingNumber: null });
    expect(record?.after).toMatchObject({ carrier: 'UPS Ground', trackingNumber: '1Z-EDITED' });
  });

  it('编辑按新建登记的规则校验：必填项不能清空，字段错误一次列全，不保存', async () => {
    const item = await register(supervisor, shippedParts({ customerName: 'Validate Me' }));
    const fields = await fieldsOf(
      await update(supervisor, item.number, {
        version: item.version,
        changes: {
          customerName: '  ',
          ratios: { ...shippedParts().ratios, product: { fsh: null, factory: 130 } },
        },
      }),
    );
    expect(fields).toEqual({
      customerName: '请填写客户',
      'ratios.product.factory': '比例为 0–100 的整数',
    });
    expect((await detail(supervisor, item.number)).version).toBe(item.version);
  });

  it('改了金额的费用项按费用发生日重新取汇率；没改的保留原来冻结的值', async () => {
    const item = await register(
      owner,
      shippedParts({
        method: 'refund_or_compensation',
        partSku: null,
        partQuantity: null,
        shipper: null,
        carrier: '',
        shipDate: null,
        trackingNumber: '',
        fees: {
          productCost: { amount: '12.00', currency: 'CAD' },
          freight: { amount: '0.00', currency: 'USD' },
          compensation: { amount: '889.00', currency: 'MXN' },
          otherCost: { amount: '0.00', currency: 'USD' },
        },
      }),
    );
    const res = await update(owner, item.number, {
      version: item.version,
      changes: { fees: { compensation: { amount: '900.00', currency: 'MXN' } } },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const saved = aftersalesDetailSchema.parse(await res.json());
    expect(saved.fees?.compensation).toMatchObject({ amount: '900.00', usd: '50.00' });
    expect(saved.fees?.productCost).toMatchObject({ amount: '12.00', usd: '8.82' });
  });

  it('「修改汇率」随「保存修改」一起提交：售后负责人改汇率与改字段同一次保存，各记一条审计', async () => {
    const item = await register(
      owner,
      shippedParts({
        method: 'refund_or_compensation',
        partSku: null,
        partQuantity: null,
        shipper: null,
        carrier: '',
        shipDate: null,
        trackingNumber: '',
        fees: {
          productCost: { amount: '0.00', currency: 'USD' },
          freight: { amount: '0.00', currency: 'USD' },
          compensation: { amount: '889.00', currency: 'MXN' },
          otherCost: { amount: '0.00', currency: 'USD' },
        },
      }),
    );
    const res = await update(owner, item.number, {
      version: item.version,
      changes: { orderNumber: '302-8811234-9901122' },
      rates: { compensation: '17.50' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const saved = aftersalesDetailSchema.parse(await res.json());
    expect(saved).toMatchObject({ orderNumber: '302-8811234-9901122', version: item.version + 1 });
    expect(saved.fees?.compensation).toMatchObject({
      usd: '50.80',
      rate: { rate: '17.500000', date: '2026-09-11', source: 'manual' },
    });
    expect(await t.auditRecords({ action: 'aftersales.update', objectId: item.id })).toHaveLength(
      1,
    );
    expect(
      await t.auditRecords({ action: 'aftersales.change_rate', objectId: item.id }),
    ).toHaveLength(1);
    // 客服主管（登记人）只能改字段，改汇率被拒绝
    const mine = await register(supervisor, shippedParts({ customerName: 'Supervisor Rate' }));
    expect(
      (
        await update(supervisor, mine.number, {
          version: mine.version,
          rates: { productCost: '1.5' },
        })
      ).status,
    ).toBe(403);
  });

  it('客服主管不能编辑别人登记的进行中单；售后负责人可编辑自己负责的；坐席只读', async () => {
    const byOwner = await register(owner, shippedParts({ customerName: 'Owner Registered' }));
    const res = await update(supervisor, byOwner.number, {
      version: byOwner.version,
      changes: { trackingNumber: '1Z-NOPE' },
    });
    expect(res.status).toBe(403);
    expect(
      (await update(agent, byOwner.number, { version: byOwner.version, changes: {} })).status,
    ).toBe(403);
    // 客服主管登记、王磊负责：负责人可改
    const bySupervisor = await register(
      supervisor,
      shippedParts({ customerName: 'Owned By Wang' }),
    );
    const ok = await update(owner, bySupervisor.number, {
      version: bySupervisor.version,
      changes: { trackingNumber: '1Z-OWNER' },
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
  });

  it('坐席查看登记详情：只读，不含费用、比例与取消时保留的费用项', async () => {
    const view = await detail(agent, 'S-20260911-0020');
    expect(view.fees).toBeUndefined();
    expect(view.ratios).toBeUndefined();
    expect(view).toMatchObject({ number: 'S-20260911-0020', customerName: 'Mateo Rivas' });
    expect((await detail(owner, 'S-20260911-0020')).fees?.compensation?.usd).toBe('49.39');
  });

  it('登记人可设为已完成（不要求齐全，记完成时间），5 秒内撤销恢复为进行中；都记审计', async () => {
    const item = await register(
      supervisor,
      shippedParts({ customerName: 'Complete Me', shipDate: null, trackingNumber: '' }),
    );
    const done = await complete(supervisor, item);
    expect(done).toMatchObject({ status: 'completed', missing: ['shipDate', 'trackingNumber'] });
    expect((await detail(supervisor, item.number)).completedAt).toBe(t.clock.now().toISOString());

    t.clock.advance({ seconds: 4 });
    const res = await supervisor.post(`/api/aftersales/${item.number}/undo-complete`, {
      version: done.version,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(ledgerItemSchema.parse(await res.json())).toMatchObject({
      status: 'in_progress',
      missing: [],
    });
    expect((await detail(supervisor, item.number)).completedAt).toBeNull();
    expect(await t.auditRecords({ action: 'aftersales.complete', objectId: item.id })).toHaveLength(
      1,
    );
    expect(
      await t.auditRecords({ action: 'aftersales.undo_complete', objectId: item.id }),
    ).toHaveLength(1);
  });

  it('过了撤销时限不能撤销：保持已完成', async () => {
    const item = await register(supervisor, shippedParts({ customerName: 'Too Late' }));
    const done = await complete(supervisor, item);
    t.clock.advance({ seconds: 11 });
    const fields = await fieldsOf(
      await supervisor.post(`/api/aftersales/${item.number}/undo-complete`, {
        version: done.version,
      }),
    );
    expect(fields).toEqual({ status: '已超过撤销时限，这张单保持已完成' });
    expect((await detail(supervisor, item.number)).status).toBe('completed');
  });

  it('不是登记人也不是负责人：不能设为已完成；已完成的单不能再取消、不能再设为已完成', async () => {
    const byOwner = await register(owner, shippedParts({ customerName: 'Not Yours' }));
    expect(
      (
        await supervisor.post(`/api/aftersales/${byOwner.number}/complete`, {
          version: byOwner.version,
        })
      ).status,
    ).toBe(403);

    const done = await complete(owner, byOwner);
    const cancel = await owner.post(`/api/aftersales/${byOwner.number}/cancel`, {
      version: done.version,
      reason: '客户撤回',
      keptFees: [],
    });
    expect(await fieldsOf(cancel)).toEqual({ status: '只有进行中的单可以这样操作' });
    const again = await owner.post(`/api/aftersales/${byOwner.number}/complete`, {
      version: done.version,
    });
    expect(await fieldsOf(again)).toEqual({ status: '只有进行中的单可以这样操作' });
  });
});

describe('取消售后单（AC-AS-16）与补登已完成的单（AC-P1-19）', () => {
  let t: TestHarness;
  let supervisor: ApiClient;
  let owner: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    supervisor = await t.loginAs('客服主管');
    owner = await t.loginAs('售后负责人');
  });

  afterAll(async () => {
    await t.close();
  });

  it('AC-AS-16：不填原因报错、不取消；填写后已取消，勾选保留的已产生费用仍登记，记审计', async () => {
    const before = await detail(supervisor, 'S-20260911-0021');
    const empty = await supervisor.post('/api/aftersales/S-20260911-0021/cancel', {
      version: before.version,
      reason: '  ',
      keptFees: ['productCost', 'freight', 'compensation', 'otherCost'],
    });
    expect(await fieldsOf(empty)).toEqual({ reason: '请填写取消原因' });
    expect((await detail(supervisor, 'S-20260911-0021')).status).toBe('in_progress');

    const res = await supervisor.post('/api/aftersales/S-20260911-0021/cancel', {
      version: before.version,
      reason: '客户撤回售后申请',
      keptFees: ['productCost', 'compensation', 'otherCost'],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(ledgerItemSchema.parse(await res.json())).toMatchObject({ status: 'cancelled' });

    const cancelled = await detail(supervisor, 'S-20260911-0021');
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancellation: {
        reason: '客户撤回售后申请',
        keptFees: ['productCost', 'compensation', 'otherCost'],
      },
    });
    // 原登记的费用照样在（计入售后成本的口径随待办 22 的售后成本视图）
    expect(cancelled.fees?.productCost).toMatchObject({ amount: '18.00', usd: '18.00' });
    expect(cancelled.fees?.freight).toMatchObject({ amount: '8.40' });

    const [record] = await t.auditRecords({
      action: 'aftersales.cancel',
      objectId: cancelled.id,
    });
    expect(record).toMatchObject({ actorName: '周敏', objectLabel: 'S-20260911-0021' });
    expect(record?.before).toMatchObject({ status: 'in_progress', cancellation: null });
    expect(record?.after).toMatchObject({
      status: 'cancelled',
      cancellation: {
        reason: '客户撤回售后申请',
        keptFees: ['productCost', 'compensation', 'otherCost'],
      },
    });

    // 已取消为终态：只读
    expect(
      (
        await update(owner, 'S-20260911-0021', {
          version: cancelled.version,
          changes: { trackingNumber: '1Z-AFTER' },
        })
      ).status,
    ).toBe(403);
  });

  it('只能保留已登记的费用项', async () => {
    const before = await detail(owner, 'S-20260911-0019');
    // 0019 的产品成本、运费还没登记
    const res = await owner.post('/api/aftersales/S-20260911-0019/cancel', {
      version: before.version,
      reason: '改为退款处理',
      keptFees: ['productCost', 'compensation'],
    });
    expect(await fieldsOf(res)).toEqual({ keptFees: '只能保留已登记的费用' });
  });

  it('AC-P1-19：客服主管补登已完成单的快递单号被拒绝；售后负责人可以，「缺 N 项」随之减少，记审计', async () => {
    const before = await detail(owner, 'S-20260909-0016');
    expect(before.missing).toEqual(['trackingNumber']);

    const denied = await update(supervisor, 'S-20260909-0016', {
      version: before.version,
      changes: { trackingNumber: '1Z4R28830358229088' },
    });
    expect(denied.status).toBe(403);

    const res = await update(owner, 'S-20260909-0016', {
      version: before.version,
      changes: { trackingNumber: '1Z4R28830358229088' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(aftersalesDetailSchema.parse(await res.json())).toMatchObject({
      status: 'completed',
      trackingNumber: '1Z4R28830358229088',
      missing: [],
    });
    const [record] = await t.auditRecords({ action: 'aftersales.backfill', objectId: before.id });
    expect(record).toMatchObject({ actorName: '王磊', objectLabel: 'S-20260909-0016' });
    expect(record?.before).toMatchObject({ trackingNumber: null });
    expect(record?.after).toMatchObject({ trackingNumber: '1Z4R28830358229088' });
    expect((await ledger(owner)).completion).toEqual({
      month: '2026-09',
      completed: 8,
      complete: 8,
    });
  });

  it('补登只能填原来空着的字段，已填的不能改', async () => {
    const before = await detail(owner, 'S-20260910-0017');
    const res = await update(owner, 'S-20260910-0017', {
      version: before.version,
      changes: { trackingNumber: '1Z-CHANGED', carrier: 'UPS Ground' },
    });
    expect(await fieldsOf(res)).toEqual({ trackingNumber: '已完成的单只能补登缺失的字段' });
  });
});

describe('两人同时编辑同一张单（G7 乐观锁）', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
  });

  afterAll(async () => {
    await t.close();
  });

  it('后保存者收到 409，先保存的内容不被覆盖', async () => {
    const owner = await t.loginAs('售后负责人');
    const ownerAgain = await t.loginAs('售后负责人');
    const read = await detail(owner, 'S-20260911-0018');

    const first = await update(owner, 'S-20260911-0018', {
      version: read.version,
      changes: { shipDate: '2026-09-11' },
    });
    expect(first.status, await first.clone().text()).toBe(200);
    const second = await update(ownerAgain, 'S-20260911-0018', {
      version: read.version,
      changes: { trackingNumber: '1Z-LATE' },
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: 'optimistic_lock' });

    const latest = await detail(owner, 'S-20260911-0018');
    expect(latest).toMatchObject({ shipDate: '2026-09-11', trackingNumber: null });
    // 设为已完成、取消同样带版本：过期的版本被拒绝
    expect(
      (await owner.post('/api/aftersales/S-20260911-0018/complete', { version: read.version }))
        .status,
    ).toBe(409);
  });
});
