import {
  defaultOwnerId,
  emptyRegistrationInput,
  ledgerItemSchema,
  ledgerSchema,
  ownersForStore,
  ratioPairsOf,
  registrationOptionsSchema,
  sourceTicketSchema,
  ticketListSchema,
  type LedgerItem,
  type RegistrationInput,
  type RegistrationOptions,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncExchangeRatesJob } from '../src/modules/core';
import { exchangeRateClient, gmailClient } from '../src/modules/integration';
import type { ApiClient } from './api-client';
import { startTestHarness, TEST_CLIENT_IP, type TestHarness } from './harness';

/*
 * 台账曳光弹：新建登记（待办 19；P13「第一阶段」、S14、R-AS-08、6.5「第一阶段台账状态」、PRD 10.1）。
 * 以角色身份调接口：客服主管、售后负责人新建一张登记，在 P13 列表里看到它；校验、负责人、来源工单、店铺范围、
 * 财务字段与审计。示例数据先灌入（含原型的 12 张台账单），演示时刻 2026-09-11 10:20。
 */

const fixture = getDemoFixture();
const storeNamed = (name: string) => fixture.stores.find((s) => s.name === name)!;
const DIRECT = storeNamed('Forcome Direct');
const COM = storeNamed('forcome.com');
const MX = storeNamed('forcome.mx');
const memberKeyed = (key: string) => fixture.members.find((m) => m.key === key)!;
const WANG = memberKeyed('wanglei');
const ZHOU = memberKeyed('zhoumin');

/** 一张填齐必填项的寄配件登记（S14 的示例：forcome.com · Olivia Turner · 产品质量问题，HEPA 滤芯组件 × 1） */
function registration(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
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
    fees: {
      ...empty.fees,
      productCost: { amount: '3.20', currency: 'USD' },
      freight: { amount: '6.80', currency: 'USD' },
      compensation: { amount: '0.00', currency: 'USD' },
      otherCost: { amount: '0.00', currency: 'USD' },
    },
    ...overrides,
  };
}

async function ledger(client: ApiClient): Promise<LedgerItem[]> {
  const res = await client.get('/api/aftersales/ledger');
  expect(res.status).toBe(200);
  return ledgerSchema.parse(await res.json()).items;
}

async function register(client: ApiClient, input: RegistrationInput): Promise<LedgerItem> {
  const res = await client.post('/api/aftersales/registrations', input);
  expect(res.status, await res.clone().text()).toBe(201);
  return ledgerItemSchema.parse(await res.json());
}

async function fieldErrors(client: ApiClient, input: RegistrationInput) {
  const res = await client.post('/api/aftersales/registrations', input);
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string; fields?: Record<string, string> };
  expect(body.error).toBe('invalid_request');
  return body.fields;
}

async function options(client: ApiClient): Promise<RegistrationOptions> {
  const res = await client.get('/api/aftersales/registration-options');
  expect(res.status).toBe(200);
  return registrationOptionsSchema.parse(await res.json());
}

describe('新建登记（待办 19）', () => {
  let t: TestHarness;
  let supervisor: ApiClient;
  let owner: ApiClient;
  let agent: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    // 欧洲央行公布了 09-10 的汇率（演示汇率，待办 20），比索、加元金额按它折算
    t.clients.fake(exchangeRateClient).publish('2026-09-10', fixture.exchangeRates.quotes);
    await t.enqueue(syncExchangeRatesJob, {});
    // 系统开始监听店铺邮箱（来源工单的用例要先收一封来信建工单）
    await t.runJobs();
    supervisor = await t.loginAs('客服主管');
    owner = await t.loginAs('售后负责人');
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  it('示例数据：P13 列出原型的 12 张台账单（不含待确认的单），金额带原币与冻结美元值', async () => {
    const items = await ledger(owner);
    const samples = items.filter((item) => item.number <= 'S-20260911-0021');
    expect(samples.map((item) => item.number)).toEqual(fixture.ledger.map((r) => r.no));
    expect(samples.find((item) => item.number === 'S-20260911-0020')).toMatchObject({
      status: 'in_progress',
      customerName: 'Mateo Rivas',
      store: { id: DIRECT.id, name: 'Forcome Direct' },
      site: 'MX',
      method: 'refund_or_compensation',
      responsibility: 'product_quality',
      fees: { compensation: { amount: '889.00', currency: 'MXN', usd: '49.39' } },
    });
  });

  it('客服主管与售后负责人可新建：状态「进行中」，单号 S-创建日期-全局序号（接在原型用过的最大序号之后，含第一期丢弃的待确认单 0022）', async () => {
    const bySupervisor = await register(supervisor, registration());
    expect(bySupervisor).toMatchObject({
      number: 'S-20260911-0023',
      status: 'in_progress',
      origin: 'manual_registration',
      customerName: 'Olivia Turner',
      store: { id: COM.id, name: 'forcome.com' },
      site: 'US',
      method: 'send_parts',
      responsibility: 'product_quality',
      trackingNumber: null,
      fees: {
        productCost: { amount: '3.20', currency: 'USD', usd: '3.20', rate: null },
        freight: { amount: '6.80', currency: 'USD', usd: '6.80', rate: null },
        compensation: { amount: '0.00', currency: 'USD', usd: '0.00', rate: null },
        otherCost: { amount: '0.00', currency: 'USD', usd: '0.00', rate: null },
      },
      ratios: ratioPairsOf({ product: 100, freight: 100, other: 100 }),
    });
    const byOwner = await register(owner, registration({ customerName: 'Noah Kim' }));
    expect(byOwner.number).toBe('S-20260911-0024');

    // 新登记的单出现在台账里
    expect((await ledger(owner)).map((item) => item.number)).toEqual(
      expect.arrayContaining(['S-20260911-0023', 'S-20260911-0024']),
    );
  });

  it('坐席新建被拒绝（403），知识库负责人与管理员连台账也进不去；被拒时不写任何数据', async () => {
    const before = (await ledger(owner)).length;
    for (const role of ['坐席', '知识库负责人', '管理员']) {
      const client = role === '坐席' ? agent : await t.loginAs(role);
      const res = await client.post('/api/aftersales/registrations', registration());
      expect(res.status, role).toBe(403);
      expect((await client.get('/api/aftersales/registration-options')).status, role).toBe(403);
    }
    for (const role of ['知识库负责人', '管理员']) {
      expect((await (await t.loginAs(role)).get('/api/aftersales/ledger')).status, role).toBe(403);
    }
    expect(await ledger(owner)).toHaveLength(before);
    expect((await t.api.get('/api/aftersales/ledger')).status).toBe(401);
  });

  it('坐席只读查看台账：列表不含成本、承担比例与承担金额字段；客服主管、售后负责人都有', async () => {
    const forAgent = await ledger(agent);
    expect(forAgent.length).toBeGreaterThanOrEqual(12);
    for (const item of forAgent) {
      expect(Object.keys(item).sort()).toEqual(
        [
          'customerName',
          'id',
          'method',
          'number',
          'origin',
          'responsibility',
          'site',
          'status',
          'store',
          'trackingNumber',
          'version',
        ].sort(),
      );
    }
    for (const client of [supervisor, owner]) {
      for (const item of await ledger(client)) {
        expect(item).toHaveProperty('fees');
        expect(item).toHaveProperty('ratios');
      }
    }
  });

  it('比例填 130 报错「比例为 0–100 的整数」（S14），不保存；填 50 时另一侧为 50', async () => {
    const before = (await ledger(owner)).length;
    const wrong = registration({
      ratios: {
        product: { fsh: null, factory: 130 },
        freight: { fsh: 0, factory: 100 },
        other: { fsh: 0, factory: 100 },
      },
    });
    expect(await fieldErrors(owner, wrong)).toEqual({
      'ratios.product.factory': '比例为 0–100 的整数',
    });
    expect(await ledger(owner)).toHaveLength(before);

    const half = await register(
      owner,
      registration({
        ratios: {
          product: { fsh: null, factory: 50 },
          freight: { fsh: 0, factory: 100 },
          other: { fsh: 0, factory: 100 },
        },
      }),
    );
    expect(half.ratios?.product).toEqual({ fsh: 50, factory: 50 });
  });

  it('选择「产品质量问题」按种子数据预填三组均 FSH 0 / 工厂 100；生产厂按配件 SKU 预填（HEPA 滤芯组件 → FQD）', async () => {
    const { defaultRatios, factories, parts } = await options(owner);
    const quality = defaultRatios.find((d) => d.responsibility === 'product_quality');
    expect(quality && ratioPairsOf(quality.ratios)).toEqual({
      product: { fsh: 0, factory: 100 },
      freight: { fsh: 0, factory: 100 },
      other: { fsh: 0, factory: 100 },
    });
    // R-AS-02 的四类默认比例
    expect(defaultRatios).toEqual([
      { responsibility: 'customer_use', ratios: { product: 0, freight: 0, other: 0 } },
      { responsibility: 'product_quality', ratios: { product: 100, freight: 100, other: 100 } },
      { responsibility: 'logistics', ratios: { product: 0, freight: 0, other: 0 } },
      { responsibility: 'other', ratios: { product: 50, freight: 50, other: 50 } },
    ]);
    expect(factories).toEqual([{ code: 'FQD' }, { code: 'FZJ' }]);
    expect(parts.find((p) => p.sku === 'FC-V2-HF01')).toEqual({
      sku: 'FC-V2-HF01',
      name: 'HEPA 滤芯组件',
      factory: 'FQD',
    });
    expect(parts.find((p) => p.sku === 'FC-V2-CB01')?.factory).toBe('FZJ');
  });

  it('AC-P1-17：退款或部分补偿的额外赔偿为 0 → 字段下方报错，不保存、不记审计', async () => {
    const before = (await ledger(owner)).length;
    const audits = (await t.auditRecords({ action: 'aftersales.create' })).length;
    const refund = registration({
      method: 'refund_or_compensation',
      fees: {
        ...registration().fees,
        compensation: { amount: '0', currency: 'MXN' },
      },
    });
    expect(await fieldErrors(supervisor, refund)).toEqual({
      'fees.compensation': '部分补偿、免退货退款的款项记在额外赔偿，须大于 0',
    });
    expect(await ledger(owner)).toHaveLength(before);
    expect(await t.auditRecords({ action: 'aftersales.create' })).toHaveLength(audits);

    // 填了大于 0 的额外赔偿就能保存；寄件字段不适用，不保存
    const saved = await register(supervisor, {
      ...refund,
      fees: { ...refund.fees, compensation: { amount: '889', currency: 'MXN' } },
    });
    expect(saved.fees?.compensation).toEqual({
      amount: '889.00',
      currency: 'MXN',
      usd: '49.39',
      rate: { rate: '18.000000', date: '2026-09-10', source: 'ecb' },
    });
    const [audit] = await t.auditRecords({ action: 'aftersales.create', objectId: saved.id });
    expect(audit?.after).toMatchObject({ part: null, shipper: null, carrier: null });
  });

  it('必填项没填：一次列全，不保存', async () => {
    expect(await fieldErrors(owner, emptyRegistrationInput())).toEqual({
      method: '请选择处理方式',
      storeId: '请选择店铺',
      site: '请选择站点',
      orderNumber: '请填写订单号',
      customerName: '请填写客户',
      feeDate: '请选择费用发生日',
      ownerId: '请选择负责人',
      responsibility: '请选择责任类型',
    });
    expect(
      await fieldErrors(
        owner,
        registration({
          responsibility: 'other',
          factory: null,
          ratios: {
            product: { fsh: 50, factory: 50 },
            freight: { fsh: 50, factory: 50 },
            other: { fsh: 50, factory: 50 },
          },
          partSku: 'FC-NOT-EXIST',
        }),
      ),
    ).toEqual({
      factory: '请选择生产厂',
      responsibilityReason: '责任为「其他」时须填写理由',
      partSku: '没有这个配件',
    });
  });

  it('AC-P1-18：forcome.mx 只有王磊有数据范围时，客服主管新建登记默认王磊、下拉只列有该店铺范围的售后负责人；选别人被拒绝', async () => {
    const zhaoId = await t.addMember({
      name: '赵敏',
      dept: 'FSH / 售后',
      roles: ['aftersales_owner'],
      allStores: false,
      storeIds: [DIRECT.id],
    });
    const { owners } = await options(supervisor);
    expect(owners.map((o) => o.name).sort()).toEqual(['王磊', '赵敏'].sort());
    expect(ownersForStore(owners, MX.id).map((o) => o.name)).toEqual(['王磊']);
    expect(defaultOwnerId(owners, MX.id, ZHOU.id)).toBe(WANG.id);
    expect(
      ownersForStore(owners, DIRECT.id)
        .map((o) => o.name)
        .sort(),
    ).toEqual(['王磊', '赵敏'].sort());
    // 登记人是售后负责人时默认本人
    expect(defaultOwnerId(owners, DIRECT.id, zhaoId)).toBe(zhaoId);

    // 只授权 forcome.mx 的客服主管：候选人的范围只露出 forcome.mx，与之没有交集的赵敏不列出
    const mxOnly = await t.loginAs({
      memberId: await t.addMember({
        name: '吴越',
        dept: 'FSH / 客服部',
        roles: ['supervisor'],
        allStores: false,
        storeIds: [MX.id],
      }),
    });
    expect((await options(mxOnly)).owners).toEqual([
      { id: WANG.id, name: '王磊', stores: { all: false, storeIds: [MX.id] } },
    ]);

    const forMx = registration({ storeId: MX.id, site: 'MX', orderNumber: '#2001' });
    expect(await fieldErrors(supervisor, { ...forMx, ownerId: zhaoId })).toEqual({
      ownerId: '只能选有该店铺数据范围的售后负责人',
    });
    // 负责人必须是售后负责人：客服主管自己不行
    expect(await fieldErrors(supervisor, { ...forMx, ownerId: ZHOU.id })).toEqual({
      ownerId: '只能选有该店铺数据范围的售后负责人',
    });
    const saved = await register(supervisor, { ...forMx, ownerId: WANG.id });
    expect(saved.store).toEqual({ id: MX.id, name: 'forcome.mx' });
    const [audit] = await t.auditRecords({ action: 'aftersales.create', objectId: saved.id });
    expect(audit?.after).toMatchObject({ ownerId: WANG.id, ownerName: '王磊' });
  });

  it('新建记审计：操作人、角色、来源 IP、对象（售后单号）、店铺与完整后值', async () => {
    const saved = await register(
      supervisor,
      registration({ customerName: 'Liam Baker', orderNumber: '#1070' }),
    );
    const records = await t.auditRecords({ action: 'aftersales.create', objectId: saved.id });
    expect(records).toEqual([
      expect.objectContaining({
        actorType: 'member',
        actorId: ZHOU.id,
        actorName: '周敏',
        actorRoles: ['supervisor'],
        ip: TEST_CLIENT_IP,
        objectType: 'aftersales',
        objectLabel: saved.number,
        storeId: COM.id,
        before: null,
        occurredAt: new Date('2026-09-11T02:20:00.000Z'),
      }),
    ]);
    expect(records[0]?.after).toEqual({
      number: saved.number,
      status: 'in_progress',
      origin: 'manual_registration',
      storeId: COM.id,
      site: 'US',
      sourceTicket: null,
      orderNumber: '#1070',
      customerName: 'Liam Baker',
      registeredBy: '周敏',
      ownerId: WANG.id,
      ownerName: '王磊',
      feeDate: '2026-09-11',
      method: 'send_parts',
      responsibility: 'product_quality',
      responsibilityReason: null,
      factory: 'FQD',
      part: { sku: 'FC-V2-HF01', quantity: 1 },
      shipper: 'yicang',
      carrier: 'UPS Ground',
      shipDate: null,
      trackingNumber: null,
      claimTarget: null,
      claimStatus: null,
      fees: {
        productCost: { amount: '3.20', currency: 'USD', usd: '3.20', rate: null },
        freight: { amount: '6.80', currency: 'USD', usd: '6.80', rate: null },
        compensation: { amount: '0.00', currency: 'USD', usd: '0.00', rate: null },
        otherCost: { amount: '0.00', currency: 'USD', usd: '0.00', rate: null },
      },
      ratios: ratioPairsOf({ product: 100, freight: 100, other: 100 }),
    });
  });

  describe('来源工单：可不填，填了带入店铺、站点、订单号、客户', () => {
    let ticketNumber: string;

    beforeAll(async () => {
      t.clients.fake(gmailClient).deliver({
        to: COM.mailbox,
        from: { name: 'Olivia Turner', address: 'olivia.turner@example.com' },
        subject: 'HEPA filter cracked',
        text: 'The HEPA filter arrived cracked.',
        at: '2026-09-11T09:40:00+08:00',
      });
      await t.runJobs();
      const res = await supervisor.get('/api/tickets');
      const tickets = ticketListSchema.parse(await res.json()).tickets;
      ticketNumber = tickets.find((ticket) => ticket.customer.name === 'Olivia Turner')!.number;
    });

    it('按工单号查到店铺、站点、订单号、客户（工单号不分大小写）', async () => {
      const res = await supervisor.get(
        `/api/aftersales/source-tickets/${ticketNumber.toLowerCase()}`,
      );
      expect(res.status).toBe(200);
      expect(sourceTicketSchema.parse(await res.json())).toEqual({
        number: ticketNumber,
        store: { id: COM.id, name: 'forcome.com' },
        site: 'US',
        orderNumber: null,
        customerName: 'Olivia Turner',
      });
      const missing = await supervisor.get('/api/aftersales/source-tickets/T-20990101-0001');
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({
        message: '没有这张工单，或不在你的店铺范围内',
      });
    });

    it('带来源工单登记：记下工单号；店铺与工单不一致、或没有这张工单时报错', async () => {
      const saved = await register(owner, registration({ sourceTicket: ticketNumber }));
      const [audit] = await t.auditRecords({ action: 'aftersales.create', objectId: saved.id });
      expect(audit?.after).toMatchObject({ sourceTicket: ticketNumber });

      expect(
        await fieldErrors(owner, registration({ sourceTicket: ticketNumber, storeId: DIRECT.id })),
      ).toEqual({ sourceTicket: '来源工单属于 forcome.com，与所选店铺不一致' });
      expect(await fieldErrors(owner, registration({ sourceTicket: 'T-20990101-0001' }))).toEqual({
        sourceTicket: '没有这张工单，或不在你的店铺范围内',
      });
    });

    it('范围外店铺的工单：查询与登记都被拒绝（403）并记越权审计（E-24）', async () => {
      const limitedId = await t.addMember({
        name: '钱多',
        dept: 'FSH / 客服部',
        roles: ['supervisor'],
        allStores: false,
        storeIds: [DIRECT.id],
      });
      const limited = await t.loginAs({ memberId: limitedId });
      const res = await limited.get(`/api/aftersales/source-tickets/${ticketNumber}`);
      expect(res.status).toBe(403);
      const denied = await t.auditRecords({ action: 'access.denied', objectId: undefined });
      expect(denied.filter((r) => r.actorId === limitedId)).toEqual([
        expect.objectContaining({
          objectType: 'ticket',
          objectLabel: ticketNumber,
          storeId: COM.id,
        }),
      ]);
      const post = await limited.post(
        '/api/aftersales/registrations',
        registration({ storeId: DIRECT.id, sourceTicket: ticketNumber }),
      );
      expect(post.status).toBe(403);
    });
  });

  describe('店铺数据范围（R-ST-06）', () => {
    it('只授权 Forcome Direct 的客服主管：台账只列该店铺的单；选范围外的店铺登记被拒绝并记审计', async () => {
      const limitedId = await t.addMember({
        name: '孙丽',
        dept: 'FSH / 客服部',
        roles: ['supervisor'],
        allStores: false,
        storeIds: [DIRECT.id],
      });
      const limited = await t.loginAs({ memberId: limitedId });
      const items = await ledger(limited);
      expect(items.length).toBeGreaterThan(0);
      expect(new Set(items.map((item) => item.store.name))).toEqual(new Set(['Forcome Direct']));

      const before = (await ledger(owner)).length;
      const res = await limited.post(
        '/api/aftersales/registrations',
        registration({ storeId: MX.id, site: 'MX' }),
      );
      expect(res.status).toBe(403);
      expect(await ledger(owner)).toHaveLength(before);
      const denied = (await t.auditRecords({ action: 'access.denied' })).filter(
        (r) => r.actorId === limitedId,
      );
      expect(denied).toEqual([
        expect.objectContaining({ objectType: 'store', objectId: MX.id, storeId: MX.id }),
      ]);
    });
  });
});
