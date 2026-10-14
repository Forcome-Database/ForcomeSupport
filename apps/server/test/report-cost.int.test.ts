import {
  amazonDomains,
  costReportSchema,
  emptyRegistrationInput,
  ledgerSchema,
  reportCostDrillQuery,
  ticketReportSchema,
  type CostReport,
  type ReportCost,
  type RegistrationInput,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gmailClient, type FakeMailInput } from '../src/modules/integration';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * P17「售后成本按责任类型」与报表导出（待办 25；PRD P17「第一阶段」v2.35、K5、K19 补充小样⑥–⑧，AC-RP-01、AC-P1-09）：
 * 卡头总额与 P13 合计行同一个视图（示例夹具 $188.79 · 12 单）；条与 P13 按同一条件下钻的合计一致；本月、随店铺不随时间与站点，
 * 店铺范围显式施加；责任类型为空的单列「未登记责任」、金额不丢；没有财务权限的角色（知识库负责人、管理员）接口不返回成本；
 * 导出按当前筛选与字段权限生成三张表（没有财务权限时没有任何成本字段）并写审计。示例数据的演示时刻 2026-09-11 10:20（北京时间）。
 */

const fixture = getDemoFixture();
const storeNamed = (name: string) => fixture.stores.find((s) => s.name === name)!;
const COM = storeNamed('forcome.com');
const AUTO = storeNamed('Forcome Auto');
const WANG = fixture.members.find((m) => m.key === 'wanglei')!;

/** 示例数据（原型 cost_by_resp()）：本月非待确认的 12 张单按责任类型 */
const FIXTURE_BARS = [
  { responsibility: 'product_quality', totalUsd: '118.89' },
  { responsibility: 'logistics', totalUsd: '38.40' },
  { responsibility: 'other', totalUsd: '22.10' },
  { responsibility: 'customer_use', totalUsd: '9.40' },
];

async function cost(client: ApiClient, query = ''): Promise<CostReport> {
  const res = await client.get(`/api/reports/cost${query}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return costReportSchema.parse(await res.json());
}

async function ledger(client: ApiClient, query: Record<string, string | undefined>) {
  const params = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ).toString();
  const res = await client.get(`/api/aftersales/ledger${params ? `?${params}` : ''}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ledgerSchema.parse(await res.json());
}

const RELAY_US = amazonDomains.US.relay;
const slug = (name: string) => name.toLowerCase().replace(/\W+/g, '.');

/** 亚马逊买家消息（经中转地址写到 Forcome Auto 的店铺邮箱） */
function amazonLetter(buyer: string, at: string): FakeMailInput {
  return {
    to: AUTO.mailbox,
    from: { name: buyer, address: `${slug(buyer)}@${RELAY_US}` },
    subject: `Question from ${buyer}`,
    text: 'Hello',
    at,
    messageId: `<${slug(buyer)}.${Date.parse(at)}@buyer.example>`,
  };
}

/** 一张美元费用的进行中登记（forcome.com · 寄配件），费用合计 $10.00 */
function registration(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  return {
    ...emptyRegistrationInput(),
    method: 'send_parts',
    storeId: COM.id,
    site: 'US',
    orderNumber: '#1099',
    customerName: 'Cost Case',
    feeDate: '2026-09-11',
    ownerId: WANG.id,
    responsibility: 'product_quality',
    factory: 'FQD',
    ratios: {
      product: { fsh: 0, factory: 100 },
      freight: { fsh: 0, factory: 100 },
      other: { fsh: 0, factory: 100 },
    },
    fees: {
      productCost: { amount: '3.20', currency: 'USD' },
      freight: { amount: '6.80', currency: 'USD' },
      compensation: { amount: null, currency: 'USD' },
      otherCost: { amount: null, currency: 'USD' },
    },
    ...overrides,
  };
}

/** 导出：状态 200，返回文件名、行数头与每张表的各行（单元格值） */
async function exportReport(client: ApiClient, query = '') {
  const res = await client.get(`/api/reports/export${query}`);
  expect(res.status, res.status === 200 ? '' : await res.clone().text()).toBe(200);
  expect(res.headers.get('content-type')).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const disposition = res.headers.get('content-disposition') ?? '';
  const fileName = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? '');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await res.arrayBuffer());
  const sheets = new Map<string, unknown[][]>();
  for (const sheet of workbook.worksheets) {
    const rows: unknown[][] = [];
    sheet.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
    sheets.set(sheet.name, rows);
  }
  return { fileName, sheets, rows: res.headers.get('x-export-rows') };
}

/** 一张表里「名称 | 值」那几行 */
const conditionOf = (rows: readonly unknown[][], name: string) =>
  rows.find((r) => r[0] === name)?.[1];

describe('售后成本按责任类型（AC-RP-01、R-AS-08）', () => {
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

  it('AC-RP-01：示例夹具下 P17 卡头总额与 P13 合计行「费用合计」都为 $188.79（12 单，同一个视图）', async () => {
    const data = await cost(supervisor);
    expect(data.cost).toMatchObject({
      range: { from: '2026-09-01', to: '2026-09-11' },
      totalUsd: '188.79',
      count: 12,
    });
    // 条按金额从大到小（原型 cost_by_resp() 排序）
    expect(
      data.cost?.bars.map(({ responsibility, totalUsd }) => ({ responsibility, totalUsd })),
    ).toEqual(FIXTURE_BARS);
    expect(data.cost?.bars.reduce((n, bar) => n + bar.count, 0)).toBe(12);

    // P13 默认的费用发生日即本月：合计行与卡头同一个数
    const p13 = await ledger(supervisor, {});
    expect(p13.range).toEqual(data.cost?.range);
    expect(p13.totals).toMatchObject({ total: '188.79', count: 12 });
    // 售后负责人看到的同样
    expect((await cost(owner)).cost?.totalUsd).toBe('188.79');
  });

  it('点条下钻到 P13（本月 + 该责任）：P13 合计与条上的金额、单数一致；「查看明细」不带责任即卡头', async () => {
    const data = (await cost(supervisor)).cost!;
    for (const bar of data.bars) {
      const drilled = await ledger(
        supervisor,
        reportCostDrillQuery(data.range, { responsibility: bar.responsibility ?? undefined }),
      );
      expect(drilled.totals, bar.responsibility ?? '').toMatchObject({
        total: bar.totalUsd,
        count: bar.count,
      });
    }
    const detail = await ledger(supervisor, reportCostDrillQuery(data.range, {}));
    expect(detail.totals).toMatchObject({ total: data.totalUsd, count: data.count });
  });

  it('随店铺筛选（下钻带店铺），不随时间与站点', async () => {
    const com = (await cost(supervisor, `?store=${COM.id}`)).cost!;
    // forcome.com：S-20260902-0011 $12.00（客户使用问题以外）、S-20260904-0013 $13.20、S-20260909-0016 $9.40
    expect(com).toMatchObject({ totalUsd: '34.60', count: 3 });
    const drilled = await ledger(supervisor, reportCostDrillQuery(com.range, { store: COM.id }));
    expect(drilled.totals).toMatchObject({ total: '34.60', count: 3 });
    // 时间、站点筛选不影响（接口只认店铺）
    expect(
      (
        await cost(
          supervisor,
          `?store=${COM.id}&period=custom&from=2026-08-01&to=2026-08-03&site=MX`,
        )
      ).cost,
    ).toEqual(com);
  });

  it('只算本月（费用发生日本月 1 日至今天）：上月的单不计，P13 默认同样不列', async () => {
    const created = await owner.post(
      '/api/aftersales/registrations',
      registration({ feeDate: '2026-08-31', orderNumber: '#1100' }),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    expect((await cost(supervisor)).cost).toMatchObject({ totalUsd: '188.79', count: 12 });
  });

  it('责任类型为空的单（历史导入缺责任）列「未登记责任」排在最后，金额照常计入卡头，与 P13 合计一致', async () => {
    // 新建登记要选责任类型；责任为空的单来自历史导入（待办 27）
    const imported = await t.importAftersales({
      rows: [
        {
          登记编号: 'NO-RESP',
          登记日期: '2026-09-05',
          店铺: 'forcome.com',
          站点: 'US',
          订单号: '#0903',
          客户: 'No Responsibility',
          处理方式: '寄配件',
          费用发生日: '2026-09-06',
          状态: '已完成',
          完成日期: '2026-09-06 10:00',
          币种: 'USD',
          产品成本: 10,
        },
      ],
    });
    expect(imported.rows[0], JSON.stringify(imported.rows[0])).toMatchObject({
      outcome: 'imported',
    });
    const data = (await cost(supervisor)).cost!;
    expect(data).toMatchObject({ totalUsd: '198.79', count: 13 });
    expect(data.bars.at(-1)).toEqual({ responsibility: null, totalUsd: '10.00', count: 1 });
    expect((await ledger(supervisor, {})).totals).toMatchObject({ total: '198.79', count: 13 });
  });
});

describe('没有财务权限的角色看不到售后成本（AC-P1-09、ADR 0010）', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
  });

  afterAll(async () => {
    await t.close();
  });

  it('AC-P1-09：知识库负责人的成本接口不返回成本字段；工单部分也没有任何成本字段', async () => {
    const knowledge = await t.loginAs('知识库负责人');
    const res = await knowledge.get('/api/reports/cost');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['now']);
    const tickets = await knowledge.get('/api/reports/tickets');
    expect(tickets.status).toBe(200);
    const text = await tickets.text();
    ticketReportSchema.parse(JSON.parse(text));
    expect(text).not.toMatch(/cost|usd|188\.79/i);
  });

  it('管理员同样不返回；坐席没有「查看报表」，403', async () => {
    const admin = await t.loginAs('管理员');
    expect(Object.keys((await (await admin.get('/api/reports/cost')).json()) as object)).toEqual([
      'now',
    ]);
    const agent = await t.loginAs('坐席');
    expect((await agent.get('/api/reports/cost')).status).toBe(403);
  });
});

describe('售后成本的店铺范围（ADR 0010：视图查询显式施加）', () => {
  let t: TestHarness;
  let limited: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    const id = await t.addMember({
      name: '孙杰',
      dept: 'FSH / 客服',
      roles: ['supervisor'],
      allStores: false,
      storeIds: [COM.id],
    });
    limited = await t.loginAs({ memberId: id });
  });

  afterAll(async () => {
    await t.close();
  });

  it('只授权 forcome.com 的客服主管：店铺选「全部」时只含该店铺', async () => {
    expect((await cost(limited)).cost).toMatchObject({ totalUsd: '34.60', count: 3 });
  });

  it('选范围外的店铺：成本与导出都 403 并记越权审计，不记导出', async () => {
    const denied = (await t.auditRecords({ action: 'access.denied' })).length;
    expect((await limited.get(`/api/reports/cost?store=${AUTO.id}`)).status).toBe(403);
    expect((await limited.get(`/api/reports/export?store=${AUTO.id}`)).status).toBe(403);
    expect((await t.auditRecords({ action: 'access.denied' })).length).toBe(denied + 2);
    expect(await t.auditRecords({ action: 'report.export' })).toEqual([]);
  });
});

describe('报表导出（K5、PRD P17「第一阶段」v2.35）', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    const gmail = t.clients.fake(gmailClient);
    await t.runJobs();
    // 本期（09-05 至 09-11）：一封 2 小时后回复的亚马逊来信；上一周期（08-29 至 09-04）：一封没回复的
    const met = amazonLetter('Ann Met', '2026-09-10T08:00:00+08:00');
    gmail.deliver(met);
    gmail.send({
      from: AUTO.mailbox,
      to: met.from.address,
      subject: `Re: ${met.subject}`,
      text: 'Hi',
      at: '2026-09-10T10:00:00+08:00',
      headers: { 'In-Reply-To': met.messageId! },
    });
    gmail.deliver(amazonLetter('Prev Buyer', '2026-09-03T09:00:00+08:00'));
    await t.runJobs();
  });

  afterAll(async () => {
    await t.close();
  });

  it('客服主管：按当前筛选生成「指标」「每日工单量」「售后成本按责任类型」三张表，数与画面一致；记审计', async () => {
    const supervisor = await t.loginAs('客服主管');
    const report = ticketReportSchema.parse(
      await (await supervisor.get('/api/reports/tickets')).json(),
    );
    const card = (await cost(supervisor)).cost as ReportCost;
    const file = await exportReport(supervisor);
    expect(file.fileName).toBe('报表_近7天_0905-0911.xlsx');
    expect([...file.sheets.keys()]).toEqual(['指标', '每日工单量', '售后成本按责任类型']);

    const metrics = file.sheets.get('指标')!;
    expect(conditionOf(metrics, '期间')).toBe('2026-09-05 至 2026-09-11（近 7 天）');
    expect(conditionOf(metrics, '店铺')).toBe('全部');
    expect(conditionOf(metrics, '站点')).toBe('全部');
    expect(conditionOf(metrics, '导出时间')).toBe('2026-09-11 10:20:00');
    const header = metrics.findIndex((r) => r[0] === '指标');
    expect(metrics[header]).toEqual(['指标', '本期', '上一周期', '对比', '说明']);
    // 写法与画面一致（contracts 的 report-words.ts）；没有对比时留空
    expect(report.current.volume).toBe(1);
    expect(metrics.slice(header + 1)).toEqual([
      ['工单量', 1, 1, '较前 7 天 持平', '客户来信新建或重开'],
      ['首响中位数', '2h 00m', '—', undefined, '来信到首次回复 · 按来信到达归期'],
      ['SLA 达标率（亚马逊）', '100%', '0%', '较前 7 天 +100.0 个百分点', '未达标 0 封'],
    ]);

    const daily = file.sheets.get('每日工单量')!;
    expect(daily[0]).toEqual(['日期', '亚马逊', 'Shopify 与邮件', '合计']);
    expect(daily.slice(1, -1)).toEqual(
      report.daily.map((d) => [d.date, d.amazon, d.shopify_email, d.amazon + d.shopify_email]),
    );
    expect(daily.at(-1)).toEqual([
      '合计',
      report.daily.reduce((n, d) => n + d.amazon, 0),
      report.daily.reduce((n, d) => n + d.shopify_email, 0),
      report.daily.reduce((n, d) => n + d.amazon + d.shopify_email, 0),
    ]);

    const costSheet = file.sheets.get('售后成本按责任类型')!;
    expect(conditionOf(costSheet, '期间')).toBe(
      '本月 2026-09-01 至 2026-09-11 · 不随时间筛选 · 产品成本 + 运费 + 额外赔偿 + 其他',
    );
    const costHeader = costSheet.findIndex((r) => r[0] === '责任类型');
    expect(costSheet.slice(costHeader)).toEqual([
      ['责任类型', '售后成本（USD）', '单数'],
      ...card.bars.map((bar, i) => [
        ['产品质量问题', '物流问题', '其他', '客户使用问题'][i],
        Number(bar.totalUsd),
        bar.count,
      ]),
      // 末行合计 = 卡头 = P13 合计（AC-RP-01）
      ['合计', 188.79, 12],
    ]);
    expect(file.rows).toBe(String(3 + report.daily.length + card.bars.length));

    const [audit] = await t.auditRecords({ action: 'report.export' });
    expect(audit).toMatchObject({
      actorName: '周敏',
      objectType: 'export',
      objectLabel: '报表',
      storeId: null,
      after: {
        fileName: '报表_近7天_0905-0911.xlsx',
        filters: { period: '7d', from: '2026-09-05', to: '2026-09-11' },
        rows: 3 + report.daily.length + card.bars.length,
        financeFields: true,
      },
    });
  });

  it('知识库负责人：文件里没有售后成本表，也没有任何成本字段；照样记审计（不含财务字段）', async () => {
    const knowledge = await t.loginAs('知识库负责人');
    const file = await exportReport(knowledge);
    expect([...file.sheets.keys()]).toEqual(['指标', '每日工单量']);
    const cells = [...file.sheets.values()].flat(2).map(String);
    expect(cells.some((cell) => /成本|\$|188\.79|责任/.test(cell))).toBe(false);
    const audit = (await t.auditRecords({ action: 'report.export' })).at(-1);
    expect(audit).toMatchObject({ actorName: '赵倩', after: { financeFields: false } });
  });

  it('管理员可以导出（导出跟随查看权限），同样没有成本表', async () => {
    const admin = await t.loginAs('管理员');
    const file = await exportReport(admin);
    expect([...file.sheets.keys()]).toEqual(['指标', '每日工单量']);
  });

  it('文件名按期间：本月「报表_本月_0901-0911」、自定义「报表_0901-0903」、单天「报表_0910」；选店铺、站点写进条件，审计按选的店铺归属', async () => {
    const supervisor = await t.loginAs('客服主管');
    expect((await exportReport(supervisor, '?period=month')).fileName).toBe(
      '报表_本月_0901-0911.xlsx',
    );
    expect(
      (await exportReport(supervisor, '?period=custom&from=2026-09-01&to=2026-09-03')).fileName,
    ).toBe('报表_0901-0903.xlsx');
    const single = await exportReport(
      supervisor,
      `?period=custom&from=2026-09-10&to=2026-09-10&store=${COM.id}&site=US`,
    );
    expect(single.fileName).toBe('报表_0910.xlsx');
    const metrics = single.sheets.get('指标')!;
    expect(conditionOf(metrics, '期间')).toBe('2026-09-10（自定义）');
    expect(conditionOf(metrics, '店铺')).toBe('forcome.com');
    expect(conditionOf(metrics, '站点')).toBe('US');
    // 成本表随店铺、不随时间与站点
    const costSheet = single.sheets.get('售后成本按责任类型')!;
    expect(conditionOf(costSheet, '店铺')).toBe('forcome.com');
    expect(costSheet.at(-1)).toEqual(['合计', 34.6, 3]);

    const audit = (await t.auditRecords({ action: 'report.export' })).at(-1);
    expect(audit).toMatchObject({
      storeId: COM.id,
      after: {
        fileName: '报表_0910.xlsx',
        filters: {
          period: 'custom',
          from: '2026-09-10',
          to: '2026-09-10',
          store: COM.id,
          site: 'US',
        },
      },
    });
  });

  it('无数据（K4）：指标的本期写「—」、说明写「所选范围无数据」', async () => {
    const supervisor = await t.loginAs('客服主管');
    const file = await exportReport(supervisor, '?period=custom&from=2026-08-01&to=2026-08-03');
    const metrics = file.sheets.get('指标')!;
    const header = metrics.findIndex((r) => r[0] === '指标');
    for (const row of metrics.slice(header + 1)) {
      expect(row[1]).toBe('—');
      expect(row[4]).toBe('所选范围无数据');
    }
  });

  it('筛选条件写错返回 400，不写审计；坐席没有「查看报表」，403', async () => {
    const supervisor = await t.loginAs('客服主管');
    const before = (await t.auditRecords({ action: 'report.export' })).length;
    expect((await supervisor.get('/api/reports/export?period=year')).status).toBe(400);
    expect((await (await t.loginAs('坐席')).get('/api/reports/export')).status).toBe(403);
    expect((await t.auditRecords({ action: 'report.export' })).length).toBe(before);
  });
});
