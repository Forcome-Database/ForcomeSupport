import {
  EXPORT_ROWS_HEADER,
  emptyRegistrationInput,
  ledgerItemSchema,
  ledgerOptionsSchema,
  ledgerSchema,
  type Ledger,
  type LedgerItem,
  type LedgerTotals,
  type RegistrationInput,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import Big from 'big.js';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 台账的合计行、筛选与导出（待办 22；PRD P13「第一阶段」、S13、S11、K5、R-AS-08、AC-RP-01）。
 * 示例数据（原型 p1_ledger_rows()：12 张单，丢弃待确认的 S-20260911-0022；比索按演示汇率 1 USD = 18.00 MXN 冻结）：
 * 合计行 产品成本 $55.30 · 运费 $72.10 · 额外赔偿 $61.39 · 其他 $0.00 · 费用合计 $188.79 · FSH $58.85 · 工厂 $129.94。
 * 合计来自售后成本视图（R-AS-08：非待确认单的已登记费用，已取消的单只计确认保留的部分，按费用发生日归期），
 * P17 的「售后成本按责任类型」共用它（待办 25，AC-RP-01）。
 */

const fixture = getDemoFixture();
const storeNamed = (name: string) => fixture.stores.find((s) => s.name === name)!;
const COM = storeNamed('forcome.com');
const AUTO = storeNamed('Forcome Auto');
const WANG = fixture.members.find((m) => m.key === 'wanglei')!;
const SEPTEMBER = '?from=2026-09-01&to=2026-09-30';

const FIXTURE_TOTALS: LedgerTotals = {
  count: 12,
  productCost: '55.30',
  freight: '72.10',
  compensation: '61.39',
  otherCost: '0.00',
  total: '188.79',
  fsh: '58.85',
  factory: '129.94',
};

async function ledger(client: ApiClient, query = ''): Promise<Ledger> {
  const res = await client.get(`/api/aftersales/ledger${query}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ledgerSchema.parse(await res.json());
}

const row = (data: Ledger, number: string) => data.items.find((item) => item.number === number);

/** 各行之和（合计行应当等于它，R-AS-08「合计行为各行之和」） */
function sumOf(
  items: readonly LedgerItem[],
  pick: (item: LedgerItem) => string | null | undefined,
) {
  return items.reduce((sum, item) => sum.plus(pick(item) ?? 0), new Big(0)).toFixed(2);
}

/** 一张美元费用的寄配件单（forcome.com · 产品质量问题 · FQD · 三组均工厂 100） */
function registration(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  return {
    ...emptyRegistrationInput(),
    method: 'send_parts',
    storeId: COM.id,
    site: 'US',
    orderNumber: '#1088',
    customerName: 'Cancel Case',
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
    fees: {
      productCost: { amount: '3.20', currency: 'USD' },
      freight: { amount: '6.80', currency: 'USD' },
      compensation: { amount: '1.50', currency: 'USD' },
      otherCost: { amount: null, currency: 'USD' },
    },
    ...overrides,
  };
}

/** 导出：状态 200，返回解析好的工作表、文件名与行数头 */
async function exportLedger(client: ApiClient, query = '') {
  const res = await client.get(`/api/aftersales/ledger/export${query}`);
  expect(res.status, res.status === 200 ? '' : await res.clone().text()).toBe(200);
  expect(res.headers.get('content-type')).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const disposition = res.headers.get('content-disposition') ?? '';
  const fileName = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? '');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await res.arrayBuffer());
  const sheet = workbook.worksheets[0]!;
  const rows: unknown[][] = [];
  sheet.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
  return {
    fileName,
    rows,
    header: rows[0] as string[],
    count: res.headers.get(EXPORT_ROWS_HEADER),
  };
}

describe('合计行（R-AS-08、AC-RP-01 的 P13 一侧）', () => {
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

  it('示例夹具：合计行费用合计 $188.79，FSH 承担 $58.85、工厂承担 $129.94（丢弃待确认单，固定演示汇率）', async () => {
    const data = await ledger(owner, SEPTEMBER);
    expect(data.totals).toEqual(FIXTURE_TOTALS);
    expect(data.items.map((item) => item.number)).not.toContain('S-20260911-0022');
  });

  it('每行：费用合计与两方承担按 R-AS-08 逐行计算，比索金额按冻结的美元值计入', async () => {
    const data = await ledger(owner, SEPTEMBER);
    // 三组均 FSH 50 / 工厂 50：$22.10 → $11.05 / $11.05
    expect(row(data, 'S-20260908-0015')?.cost).toEqual({
      productCost: '9.80',
      freight: '12.30',
      compensation: '0.00',
      otherCost: '0.00',
      total: '22.10',
      fsh: '11.05',
      factory: '11.05',
    });
    // 额外赔偿 MX$889.00 冻结为 $49.39，三组均工厂 100
    expect(row(data, 'S-20260911-0020')?.cost).toMatchObject({
      compensation: '49.39',
      total: '49.39',
      fsh: '0.00',
      factory: '49.39',
    });
    expect(row(data, 'S-20260911-0020')?.fees?.compensation).toMatchObject({
      amount: '889.00',
      currency: 'MXN',
    });
    // 进行中还没登记的费用（S-20260911-0019 的产品成本、运费）不计
    expect(row(data, 'S-20260911-0019')?.cost).toMatchObject({
      productCost: null,
      freight: null,
      total: '0.00',
    });
    // 每行 FSH + 工厂 = 费用合计；合计行为各行之和
    for (const item of data.items) {
      expect(new Big(item.cost!.fsh!).plus(item.cost!.factory!).toFixed(2)).toBe(item.cost!.total);
    }
    expect(data.totals?.fsh).toBe(sumOf(data.items, (item) => item.cost?.fsh));
    expect(data.totals?.factory).toBe(sumOf(data.items, (item) => item.cost?.factory));
  });

  it('隐藏列的内容：负责人、生产厂、配件 × 数量', async () => {
    const data = await ledger(owner, SEPTEMBER);
    expect(row(data, 'S-20260904-0013')).toMatchObject({
      ownerName: '王磊',
      factory: 'FQD',
      part: { sku: 'FC-V2-HF01', quantity: 2 },
    });
    expect(row(data, 'S-20260904-0013')?.part?.name).toBeTruthy();
    expect(row(data, 'S-20260901-0010')).toMatchObject({ factory: null, part: null });
  });

  it('坐席：没有合计行与金额（费用、比例、承担、保留项都去掉）', async () => {
    const agent = await t.loginAs('坐席');
    const data = await ledger(agent, SEPTEMBER);
    expect(data.totals).toBeUndefined();
    expect(data.items).toHaveLength(12);
    for (const item of data.items) {
      expect(item).not.toHaveProperty('cost');
      expect(item).not.toHaveProperty('fees');
      expect(item).not.toHaveProperty('ratios');
      expect(item).not.toHaveProperty('keptFees');
    }
  });

  it('筛选行：费用发生日、处理方式、责任、状态、负责人、店铺（合计随筛选变化）', async () => {
    const dated = await ledger(owner, '?from=2026-09-10&to=2026-09-11');
    expect(dated.items.every((item) => item.feeDate! >= '2026-09-10')).toBe(true);
    expect(dated.totals?.count).toBe(dated.items.length);
    expect(dated.totals?.total).toBe(sumOf(dated.items, (item) => item.cost?.total));

    const refunds = await ledger(owner, `${SEPTEMBER}&method=refund_or_compensation`);
    expect(refunds.items.map((item) => item.number)).toEqual([
      'S-20260902-0011',
      'S-20260911-0020',
    ]);
    expect(refunds.totals).toMatchObject({ count: 2, total: '61.39', compensation: '61.39' });

    const logistics = await ledger(owner, `${SEPTEMBER}&responsibility=logistics`);
    expect(logistics.items.map((item) => item.number)).toEqual([
      'S-20260902-0011',
      'S-20260911-0021',
    ]);

    const open = await ledger(owner, `${SEPTEMBER}&status=in_progress`);
    expect(open.items.map((item) => item.number)).toEqual([
      'S-20260911-0018',
      'S-20260911-0019',
      'S-20260911-0020',
      'S-20260911-0021',
    ]);

    const mine = await ledger(owner, `${SEPTEMBER}&owner=${WANG.id}`);
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((item) => item.ownerId === WANG.id)).toBe(true);

    const auto = await ledger(owner, `${SEPTEMBER}&store=${AUTO.id}`);
    expect(auto.items.map((item) => item.number)).toEqual(['S-20260911-0018', 'S-20260911-0021']);
    expect(auto.totals).toMatchObject({ count: 2, total: '41.10', fsh: '26.40', factory: '14.70' });

    const october = await ledger(owner, '?from=2026-10-01&to=2026-10-31');
    expect(october.range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(october.items).toEqual([]);
    expect(october.totals).toMatchObject({ count: 0, total: '0.00', fsh: '0.00', factory: '0.00' });
  });

  it('费用发生日默认本月（北京时间当月 1 日至今天，按服务端时钟）；只给一端时另一端取本月的；筛出缺字段时不按日期', async () => {
    const data = await ledger(owner);
    expect(data.range).toEqual({ from: '2026-09-01', to: '2026-09-11' });
    expect(data.totals).toEqual(FIXTURE_TOTALS);
    expect((await ledger(owner, '?from=2026-09-10')).range).toEqual({
      from: '2026-09-10',
      to: '2026-09-11',
    });
    expect((await ledger(owner, '?missing=1')).range).toBeNull();
    const file = await exportLedger(owner);
    expect(file.fileName).toBe('登记台账_20260901-20260911.xlsx');
  });

  it('筛选条件写错返回 400', async () => {
    expect((await owner.get('/api/aftersales/ledger?status=pending')).status).toBe(400);
    expect((await owner.get('/api/aftersales/ledger?method=refund')).status).toBe(400);
  });

  it('筛选行的负责人选项：查看者店铺范围内在职的售后负责人', async () => {
    const res = await owner.get('/api/aftersales/ledger/options');
    expect(res.status).toBe(200);
    const options = ledgerOptionsSchema.parse(await res.json());
    expect(options.owners).toContainEqual({ id: WANG.id, name: '王磊' });
    // 坐席也能用（筛选行人人都有）
    const agent = await t.loginAs('坐席');
    expect((await agent.get('/api/aftersales/ledger/options')).status).toBe(200);
  });
});

describe('已取消的单只计确认保留的费用（R-AS-08、D-27、AC-AS-16）', () => {
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

  it('行内按保留部分显示各费用项与承担额，原登记额仍在（悬停用），合计行等于各行之和', async () => {
    const created = await owner.post('/api/aftersales/registrations', registration());
    expect(created.status, await created.clone().text()).toBe(201);
    const item = ledgerItemSchema.parse(await created.json());
    const cancel = await owner.post(`/api/aftersales/${item.number}/cancel`, {
      version: item.version,
      reason: '客户撤回申请',
      keptFees: ['freight', 'compensation'],
    });
    expect(cancel.status, await cancel.clone().text()).toBe(200);
    // 取消接口返回的这一行也按保留部分
    expect(ledgerItemSchema.parse(await cancel.json()).cost?.total).toBe('8.30');

    const data = await ledger(owner, SEPTEMBER);
    const cancelled = row(data, item.number)!;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.keptFees).toEqual(['freight', 'compensation']);
    // 没保留的产品成本计 0，原登记额 $3.20 仍在 fees 里；其他没登记为 null
    expect(cancelled.cost).toEqual({
      productCost: '0.00',
      freight: '6.80',
      compensation: '1.50',
      otherCost: null,
      total: '8.30',
      fsh: '0.00',
      factory: '8.30',
    });
    expect(cancelled.fees?.productCost).toMatchObject({ amount: '3.20', usd: '3.20' });

    expect(data.totals).toEqual({
      ...FIXTURE_TOTALS,
      count: 13,
      freight: '78.90',
      compensation: '62.89',
      total: '197.09',
      factory: '138.24',
    });
    for (const key of ['productCost', 'freight', 'compensation', 'otherCost', 'total'] as const) {
      expect(data.totals?.[key]).toBe(sumOf(data.items, (i) => i.cost?.[key]));
    }
  });

  it('一项都没保留：费用合计与承担都为 $0.00', async () => {
    const created = await owner.post(
      '/api/aftersales/registrations',
      registration({ customerName: 'Nothing Kept' }),
    );
    const item = ledgerItemSchema.parse(await created.json());
    const cancel = await owner.post(`/api/aftersales/${item.number}/cancel`, {
      version: item.version,
      reason: '重复登记',
      keptFees: [],
    });
    expect(cancel.status, await cancel.clone().text()).toBe(200);
    const cancelled = row(await ledger(owner, SEPTEMBER), item.number)!;
    expect(cancelled.keptFees).toEqual([]);
    expect(cancelled.cost).toMatchObject({
      productCost: '0.00',
      freight: '0.00',
      compensation: '0.00',
      total: '0.00',
      fsh: '0.00',
      factory: '0.00',
    });
  });
});

describe('店铺范围施加在售后成本视图的查询上（ADR 0010、R-ST-06）', () => {
  let t: TestHarness;
  let limited: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    const id = await t.addMember({
      name: '孙杰',
      dept: 'FSH / 售后',
      roles: ['aftersales_owner'],
      allStores: false,
      storeIds: [COM.id],
    });
    limited = await t.loginAs({ memberId: id });
  });

  afterAll(async () => {
    await t.close();
  });

  it('只授权 forcome.com：列表、合计与导出都只含该店铺的单', async () => {
    const data = await ledger(limited, SEPTEMBER);
    // forcome.com：S-20260902-0011 $12.00（FSH）、S-20260904-0013 $13.20（工厂）、S-20260909-0016 $9.40（FSH）
    expect(data.items.map((item) => item.number)).toEqual([
      'S-20260902-0011',
      'S-20260904-0013',
      'S-20260909-0016',
    ]);
    expect(data.totals).toMatchObject({ count: 3, total: '34.60', fsh: '21.40', factory: '13.20' });

    const file = await exportLedger(limited, SEPTEMBER);
    expect(file.rows.slice(1, -1).map((r) => r[0])).toEqual([
      'S-20260902-0011',
      'S-20260904-0013',
      'S-20260909-0016',
    ]);
  });

  it('筛选范围外的店铺：403 并记越权审计（列表与导出都一样）', async () => {
    const denied = (await t.auditRecords({ action: 'access.denied' })).length;
    const exported = (await t.auditRecords({ action: 'export.excel' })).length;
    expect((await limited.get(`/api/aftersales/ledger?store=${AUTO.id}`)).status).toBe(403);
    expect((await limited.get(`/api/aftersales/ledger/export?store=${AUTO.id}`)).status).toBe(403);
    expect((await t.auditRecords({ action: 'access.denied' })).length).toBe(denied + 2);
    // 被拒的导出没有生成文件，不记导出
    expect((await t.auditRecords({ action: 'export.excel' })).length).toBe(exported);
  });
});

describe('导出 Excel（S11、K5）', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
  });

  afterAll(async () => {
    await t.close();
  });

  it('售后负责人：按当前筛选导出 17 列与悬停里的内容、末行合计；记审计', async () => {
    const owner = await t.loginAs('售后负责人');
    const file = await exportLedger(owner, '?from=2026-09-01&to=2026-09-11');
    expect(file.fileName).toBe('登记台账_20260901-20260911.xlsx');
    expect(file.count).toBe('12');
    expect(file.header).toEqual([
      '售后单号',
      '客户',
      '店铺与站点',
      '处理方式',
      '责任',
      '状态',
      '负责人',
      '生产厂',
      '配件 × 数量',
      '快递单号',
      '产品成本',
      '运费',
      '额外赔偿',
      '其他',
      '费用合计',
      'FSH 承担 $',
      '工厂承担 $',
      '缺失字段',
      '承担比例',
      '原币与汇率',
      '取消时未保留',
    ]);
    // 表头 + 12 行 + 合计
    expect(file.rows).toHaveLength(14);
    const at = (number: string) => file.rows.find((r) => r[0] === number)!;
    const col = (name: string) => file.header.indexOf(name);
    expect(at('S-20260911-0020')[col('额外赔偿')]).toBe(49.39);
    expect(at('S-20260911-0020')[col('原币与汇率')]).toBe(
      '额外赔偿 MX$889.00 · 汇率 2026-09-10（1 USD = 18.00 MXN）',
    );
    expect(at('S-20260908-0015')[col('承担比例')]).toBe('三组均 FSH 50 / 工厂 50');
    expect(at('S-20260909-0016')[col('快递单号')]).toBe('待回填');
    expect(at('S-20260909-0016')[col('缺失字段')]).toBe('快递单号');
    expect(at('S-20260901-0010')[col('店铺与站点')]).toBe('Forcome Direct · US');
    const total = file.rows.at(-1)!;
    expect(total[0]).toBe('合计 · 12 单');
    expect(total[col('费用合计')]).toBe(188.79);
    expect(total[col('FSH 承担 $')]).toBe(58.85);
    expect(total[col('工厂承担 $')]).toBe(129.94);

    const [audit] = await t.auditRecords({ action: 'export.excel' });
    expect(audit).toMatchObject({
      actorName: '王磊',
      objectType: 'export',
      objectLabel: '登记台账',
      storeId: null,
      after: {
        fileName: '登记台账_20260901-20260911.xlsx',
        filters: { from: '2026-09-01', to: '2026-09-11' },
        rows: 12,
        financeFields: true,
      },
    });
  });

  it('坐席导出的文件不含七个金额列（与承担比例、原币等财务说明），也没有合计行；导出照样写审计', async () => {
    const agent = await t.loginAs('坐席');
    const file = await exportLedger(agent, SEPTEMBER);
    expect(file.header).toEqual([
      '售后单号',
      '客户',
      '店铺与站点',
      '处理方式',
      '责任',
      '状态',
      '负责人',
      '生产厂',
      '配件 × 数量',
      '快递单号',
      '缺失字段',
    ]);
    // 表头 + 12 行，没有合计
    expect(file.rows).toHaveLength(13);
    expect(file.rows.flat().some((cell) => typeof cell === 'number')).toBe(false);
    const records = await t.auditRecords({ action: 'export.excel' });
    expect(records.at(-1)).toMatchObject({
      actorName: '李婷',
      objectType: 'export',
      after: { rows: 12, financeFields: false },
    });
  });

  it('筛出缺字段时：文件名带月份，只含当月缺字段的已完成单', async () => {
    const owner = await t.loginAs('售后负责人');
    const file = await exportLedger(owner, '?missing=1');
    expect(file.fileName).toBe('登记台账_缺字段的已完成单_2026-09.xlsx');
    expect(file.rows.slice(1, -1).map((r) => r[0])).toEqual(['S-20260909-0016']);
  });

  it('筛选条件写错返回 400，不写审计', async () => {
    const owner = await t.loginAs('售后负责人');
    const before = (await t.auditRecords({ action: 'export.excel' })).length;
    expect((await owner.get('/api/aftersales/ledger/export?from=09-01')).status).toBe(400);
    expect((await t.auditRecords({ action: 'export.excel' })).length).toBe(before);
  });
});
