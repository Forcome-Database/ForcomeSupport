import {
  aftersalesDetailSchema,
  auditLogSchema,
  emptyRegistrationInput,
  ledgerItemSchema,
  ledgerSchema,
  type AftersalesDetail,
  type AuditLog,
  type Ledger,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatHistoryImportReport,
  HistoryImportError,
  type HistoryImportReport,
} from '../src/modules/aftersales';
import { syncExchangeRatesJob } from '../src/modules/core';
import { exchangeRateClient } from '../src/modules/integration';
import type { ApiClient } from './api-client';
import { SAMPLE_FILE } from './fixtures/history-import/sample';
import { SAMPLE_HISTORY_MAPPING, startTestHarness, type TestHarness } from './harness';

/*
 * 售后登记表导入命令（待办 27；PRD 第 14 节、R-AS-08、AC-P1-07）。导入是运维命令：经测试工具 t.importAftersales 调用
 * 与命令行入口同一个函数，效果经主接缝核对——台账与详情接口、P27 审计接口，以及命令输出的导入报告。
 * 用合成样本 register-sample.xlsx（test/fixtures/history-import/sample.ts 逐行写明覆盖的情形）与它的映射表。
 * 示例数据先灌入（原型的 12 张台账单，单号用到 0022；9 月已完成 8 张、完整率 7 / 8），演示时刻 2026-09-11 10:20。
 */

const fixture = getDemoFixture();
const COM = fixture.stores.find((s) => s.name === 'forcome.com')!;
const WANG = fixture.members.find((m) => m.key === 'wanglei')!;

/** 样本涉及的日期各公布一天汇率（1 USD = x 原币）：相邻两天不同，才看得出取的是哪一天 */
const RATES: Record<string, { MXN: string; CAD: string }> = {
  '2026-03-03': { MXN: '17.00', CAD: '1.35' },
  '2026-03-04': { MXN: '17.50', CAD: '1.35' },
  '2026-03-09': { MXN: '17.50', CAD: '1.30' },
  '2026-03-10': { MXN: '17.50', CAD: '1.40' },
  '2026-04-02': { MXN: '17.80', CAD: '1.38' },
  '2026-05-08': { MXN: '18.00', CAD: '1.36' },
  '2026-05-11': { MXN: '19.00', CAD: '1.36' },
  '2026-09-08': { MXN: '18.00', CAD: '1.36' },
  '2026-09-10': { MXN: '18.00', CAD: '1.36' },
};

/** 样本各行导入后的单号：按原登记日期先后，序号接在示例台账用过的 0022 之后 */
const NUMBERS = {
  'H-001': 'S-20260302-0023',
  'H-002': 'S-20260304-0024',
  'H-003': 'S-20260310-0025',
  'H-004': 'S-20260316-0026',
  'H-005': 'S-20260401-0027',
  'H-006': 'S-20260408-0028',
  'H-007': 'S-20260512-0029',
  'H-008': 'S-20260620-0030',
  'H-009': 'S-20260701-0031',
  'H-010': 'S-20260905-0032',
  'H-011': 'S-20260908-0033',
} as const;

/** 合成样本试运行的完整报告（命令行输出） */
const DRY_RUN_REPORT = [
  '售后登记表导入（试运行，不写库）：register-sample.xlsx',
  '第 2 行（H-001）将导入 S-20260302-0023',
  '第 3 行（H-002）将导入 S-20260304-0024',
  '第 4 行（H-003）将导入 S-20260310-0025 · 原表没有费用发生日，取原登记日期',
  '第 5 行（H-004）将导入 S-20260316-0026 · 原表没有币种，按美元导入 · 缺：负责人、快递单号、其他',
  '第 6 行（H-005）将导入 S-20260401-0027',
  '第 8 行（H-006）将导入 S-20260408-0028 · 缺：负责人、责任理由、承担比例、额外赔偿 · 注意：负责人「张伟」不是该店铺的售后负责人，已留空（可补登）',
  '第 9 行（H-007）将导入 S-20260512-0029',
  '第 10 行（H-008）将导入 S-20260620-0030',
  '第 11 行（H-009）将导入 S-20260701-0031',
  '第 12 行（H-010）将导入 S-20260905-0032',
  '第 13 行（H-011）将导入 S-20260908-0033 · 缺：负责人',
  '第 14 行（H-012）未导入 · 店铺：「Forcome EU」认不出',
  '第 15 行（H-013）未导入 · 登记日期：没写',
  '第 16 行（H-014）未导入 · 币种：「欧元」认不出；运费：「约 12 元」不是金额',
  '第 17 行（H-005）未导入 · 行标识「H-005」与第 6 行重复',
  '第 18 行（H-015）未导入 · 处理方式：「换货」认不出',
  '合计 16 行：将导入 11 · 跳过 0 · 未导入 5',
  '未导入的行：认不出的取值在映射表 values 里加别名，或改正原表后重跑（已导入的行会跳过）。',
];

/** 包含样本全部日期的台账（费用发生日 3 月至 9 月） */
const SAMPLE_RANGE = '?from=2026-03-01&to=2026-09-30';

async function ledger(client: ApiClient, query = ''): Promise<Ledger> {
  const res = await client.get(`/api/aftersales/ledger${query}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ledgerSchema.parse(await res.json());
}

async function detail(client: ApiClient, number: string): Promise<AftersalesDetail> {
  const res = await client.get(`/api/aftersales/${number}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return aftersalesDetailSchema.parse(await res.json());
}

async function auditLog(client: ApiClient, query: string): Promise<AuditLog> {
  const res = await client.get(`/api/audit${query}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return auditLogSchema.parse(await res.json());
}

const importedNumbers = (report: HistoryImportReport) =>
  report.rows.flatMap((row) => (row.outcome === 'imported' ? [row.number] : []));

describe('售后登记表导入（合成样本，PRD 第 14 节）', () => {
  let t: TestHarness;
  let owner: ApiClient;
  let dryRun: HistoryImportReport;
  let imported: HistoryImportReport;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    for (const [date, quotes] of Object.entries(RATES)) {
      t.clients.fake(exchangeRateClient).publish(date, quotes);
    }
    await t.enqueue(syncExchangeRatesJob, {});
    await t.runJobs();
    owner = await t.loginAs('售后负责人');
  });

  afterAll(async () => {
    await t.close();
  });

  it('映射表里的列在表头里找不到：整体报错，不导入任何一行', async () => {
    const mapping = {
      ...SAMPLE_HISTORY_MAPPING,
      columns: { ...SAMPLE_HISTORY_MAPPING.columns, feeDate: '费用日期' },
    };
    await expect(t.importAftersales({ file: SAMPLE_FILE }, { mapping })).rejects.toThrow(
      new HistoryImportError('映射表里的列在表头里找不到：费用日期'),
    );
    expect((await ledger(owner, SAMPLE_RANGE)).items).toHaveLength(12);
  });

  it('试运行：只报告将导入的行（单号、标注、缺的字段、警告）与错误，不写库——台账、审计、单号都不变', async () => {
    dryRun = await t.importAftersales({ file: SAMPLE_FILE }, { dryRun: true });
    expect(formatHistoryImportReport(dryRun).split('\n')).toEqual(DRY_RUN_REPORT);
    expect((await ledger(owner, SAMPLE_RANGE)).items).toHaveLength(12);
    expect(await t.auditRecords({ action: 'aftersales.import' })).toEqual([]);
    // 再试一次，报告一样（单号没有被占用）
    expect(await t.importAftersales({ file: SAMPLE_FILE }, { dryRun: true })).toEqual(dryRun);
  });

  it('正式导入：单号与试运行一致（编号日期取原登记日期、序号全局递增），台账列表可见，创建路径标「历史导入」', async () => {
    imported = await t.importAftersales({ file: SAMPLE_FILE });
    expect(imported.dryRun).toBe(false);
    expect(importedNumbers(imported)).toEqual(importedNumbers(dryRun));
    expect(importedNumbers(imported)).toEqual(Object.values(NUMBERS));
    expect(imported.rows.filter((row) => row.outcome === 'failed')).toHaveLength(5);

    const { items } = await ledger(owner, SAMPLE_RANGE);
    expect(items).toHaveLength(12 + 11);
    const history = items.filter((item) => item.origin === 'history_import');
    expect(history.map((item) => item.number)).toEqual(Object.values(NUMBERS));
    expect(items.find((item) => item.number === NUMBERS['H-001'])).toMatchObject({
      status: 'completed',
      customerName: 'James Miller',
      store: { name: 'Forcome Direct' },
      site: 'US',
      method: 'send_parts',
      responsibility: 'product_quality',
      factory: 'FQD',
      part: { sku: 'FC-V2-HF01', name: 'HEPA 滤芯组件', quantity: 1 },
      trackingNumber: '1Z4R28830358220001',
      ownerName: '王磊',
      missing: [],
      cost: { productCost: '3.20', freight: '6.80', total: '10.00', factory: '10.00', fsh: '0.00' },
    });
  });

  it('原表没有原币的行按美元导入并标注；有原币的按原表的费用发生日取汇率，没有费用发生日时取原登记日期', async () => {
    // H-004：原表没有币种 → 美元，美元值就是原值、没有汇率；报告标注「原表没有币种，按美元导入」
    const usd = await detail(owner, NUMBERS['H-004']);
    expect(usd.fees?.productCost).toEqual({
      amount: '15.00',
      currency: 'USD',
      usd: '15.00',
      rate: null,
    });
    expect(usd.fees?.freight).toEqual({ amount: '9.50', currency: 'USD', usd: '9.50', rate: null });
    expect(imported.rows.find((row) => row.key === 'H-004')).toMatchObject({
      notes: ['usd_assumed'],
    });

    // H-002：比索按原表的费用发生日 03-03（不是登记日 03-04）的汇率 17.00 冻结美元值；退款金额记在额外赔偿
    const mxn = await detail(owner, NUMBERS['H-002']);
    expect(mxn.feeDate).toBe('2026-03-03');
    expect(mxn.method).toBe('refund_or_compensation');
    expect(mxn.fees?.compensation).toEqual({
      amount: '889.00',
      currency: 'MXN',
      usd: '52.29',
      rate: { rate: '17.000000', date: '2026-03-03', source: 'ecb' },
    });

    // H-003：原表没有费用发生日 → 取原登记日期 03-10 作费用发生日，按它的汇率 1.40（不是前一天的 1.30）
    const cad = await detail(owner, NUMBERS['H-003']);
    expect(cad.feeDate).toBe('2026-03-10');
    expect(cad.fees?.freight).toEqual({
      amount: '12.00',
      currency: 'CAD',
      usd: '8.57',
      rate: { rate: '1.400000', date: '2026-03-10', source: 'ecb' },
    });
    expect(cad.fees?.compensation?.usd).toBe('3.57');
    expect(imported.rows.find((row) => row.key === 'H-003')).toMatchObject({
      notes: ['fee_date_from_registered'],
    });

    // H-005：退款金额 10 与补偿金额 5 两列相加记在额外赔偿（R-AS-08）
    const both = await detail(owner, NUMBERS['H-005']);
    expect(both.fees?.compensation).toEqual({
      amount: '15.00',
      currency: 'CAD',
      usd: '10.87',
      rate: { rate: '1.380000', date: '2026-04-02', source: 'ecb' },
    });
    expect(both).toMatchObject({ claimTarget: 'carrier', claimStatus: 'in_progress', missing: [] });

    // H-007：费用发生日 05-09 是周六，取此前最近一个有汇率的 05-08（同新建登记）
    const weekend = await detail(owner, NUMBERS['H-007']);
    expect(weekend.fees?.productCost).toMatchObject({
      usd: '6.67',
      rate: { rate: '18.000000', date: '2026-05-08', source: 'ecb' },
    });
  });

  it('导入的已完成单不影响当月登记完整率；缺字段的历史单在台账照常标缺（可补登），但不在「筛出缺字段」里（AC-P1-07）', async () => {
    const { completion, items } = await ledger(owner);
    // 9 月完成的历史单：H-010（齐全）与 H-011（缺负责人）都不计入，仍是示例数据的 7 / 8
    expect(completion).toEqual({ month: '2026-09', completed: 8, complete: 7 });
    expect(items.find((item) => item.number === NUMBERS['H-011'])).toMatchObject({
      origin: 'history_import',
      status: 'completed',
      missing: ['ownerId'],
    });
    expect((await ledger(owner, '?missing=1')).items.map((item) => item.number)).toEqual([
      'S-20260909-0016',
    ]);
    expect((await detail(owner, NUMBERS['H-006'])).missing).toEqual([
      'ownerId',
      'responsibilityReason',
      'ratios',
      'fees.compensation',
    ]);
  });

  it('状态按原表：已取消（只计保留的运费）、进行中、没写状态按映射表的默认状态（已完成，没有完成时间）', async () => {
    const { items } = await ledger(owner, SAMPLE_RANGE);
    expect(items.find((item) => item.number === NUMBERS['H-007'])).toMatchObject({
      status: 'cancelled',
      keptFees: ['freight'],
      cost: {
        productCost: '0.00',
        freight: '14.44',
        total: '14.44',
        factory: '14.44',
        fsh: '0.00',
      },
    });
    expect((await detail(owner, NUMBERS['H-007'])).cancellation).toEqual({
      reason: '客户撤回，配件已寄出',
      at: '2026-05-13T16:00:00.000Z',
      keptFees: ['freight'],
    });
    expect(items.find((item) => item.number === NUMBERS['H-008'])?.status).toBe('in_progress');
    const defaulted = await detail(owner, NUMBERS['H-009']);
    expect(defaulted).toMatchObject({
      status: 'completed',
      completedAt: null,
      feeDate: '2026-07-01',
    });
    expect((await detail(owner, NUMBERS['H-006'])).completedAt).toBe('2026-04-09T08:20:00.000Z');
  });

  it('审计：每张导入的单一条「历史导入」，操作人「系统」；没有财务权限的管理员看到费用与比例「已隐藏」', async () => {
    const records = await t.auditRecords({ action: 'aftersales.import' });
    expect(records).toHaveLength(11);
    expect(records.every((record) => record.actorName === '系统')).toBe(true);

    const supervisor = await t.loginAs('客服主管');
    const query = '?type=aftersales&action=aftersales.import';
    expect((await auditLog(supervisor, query)).total).toBe(11);
    const [first] = (await auditLog(supervisor, `${query}&q=${NUMBERS['H-001']}`)).entries;
    expect(first).toMatchObject({ actor: { system: true, name: '系统' }, actionLabel: '历史导入' });
    expect(first?.fields.find((field) => field.label === '创建路径')?.after).toBe('历史导入');

    const admin = await t.loginAs('管理员');
    const [entry] = (await auditLog(admin, `${query}&q=${NUMBERS['H-002']}`)).entries;
    expect(entry?.fields.find((field) => field.label === '额外赔偿')).toMatchObject({
      hidden: true,
      after: null,
    });
  });

  it('重跑不产生重复售后单：已导入的行跳过（报告带当时的单号与标注），台账与审计都不变', async () => {
    const rerun = await t.importAftersales({ file: SAMPLE_FILE });
    expect(importedNumbers(rerun)).toEqual([]);
    expect(rerun.rows.find((row) => row.key === 'H-004')).toEqual({
      row: 5,
      key: 'H-004',
      outcome: 'skipped',
      number: NUMBERS['H-004'],
      notes: ['usd_assumed'],
    });
    expect(rerun.rows.filter((row) => row.outcome === 'skipped')).toHaveLength(11);
    expect(rerun.rows.filter((row) => row.outcome === 'failed')).toHaveLength(5);
    expect((await ledger(owner, SAMPLE_RANGE)).items).toHaveLength(23);
    expect(await t.auditRecords({ action: 'aftersales.import' })).toHaveLength(11);
  });

  it('补映射表的别名后重跑：原来认不出的行导入、其余跳过；单号接着发，之后新建登记的单号接在后面', async () => {
    const mapping = {
      ...SAMPLE_HISTORY_MAPPING,
      values: {
        ...SAMPLE_HISTORY_MAPPING.values,
        method: { ...SAMPLE_HISTORY_MAPPING.values.method, 换货: '寄配件' },
      },
    };
    const fixed = await t.importAftersales({ file: SAMPLE_FILE }, { mapping });
    expect(fixed.rows.find((row) => row.key === 'H-015')).toMatchObject({
      outcome: 'imported',
      number: 'S-20260422-0034',
    });
    expect(importedNumbers(fixed)).toEqual(['S-20260422-0034']);

    const res = await owner.post('/api/aftersales/registrations', {
      ...emptyRegistrationInput(),
      method: 'adjust_installation',
      storeId: COM.id,
      site: 'US',
      orderNumber: '#1300',
      customerName: 'After Import',
      feeDate: '2026-09-11',
      ownerId: WANG.id,
      responsibility: 'customer_use',
      ratios: {
        product: { fsh: 100, factory: 0 },
        freight: { fsh: 100, factory: 0 },
        other: { fsh: 100, factory: 0 },
      },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(ledgerItemSchema.parse(await res.json()).number).toBe('S-20260911-0035');
  });
});
