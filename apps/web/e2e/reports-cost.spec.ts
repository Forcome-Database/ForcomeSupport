import { costReportSchema, formatMoney, type ReportCost } from '@forcome/contracts';
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';

/*
 * P17「售后成本按责任类型」与报表导出（待办 25；PRD P17「第一阶段」v2.35、K19 补充小样⑥–⑧、K5，AC-RP-01、AC-P1-09）：
 * 客服主管的成本卡与接口、P13 合计一致，点「产品质量问题」的条下钻到 P13（本月 + 该责任）；知识库负责人看不到成本卡、不取成本，
 * 导出的文件里也没有成本；导出生成中与完成浮层。开发测试环境长期运行、本月的登记会累积：数字只核对卡与接口、P13 之间的关系，
 * 用例先经接口登记一张自己的产品质量问题单（费用发生日今天，落在本月里）。
 */

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

/** 北京时间的今天 */
function beijingToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

async function apiCost(page: Page): Promise<ReportCost> {
  const res = await page.request.get('/api/reports/cost');
  expect(res.ok()).toBe(true);
  const { cost } = costReportSchema.parse(await res.json());
  expect(cost).toBeDefined();
  return cost!;
}

/** 经接口登记一张 forcome.com 的产品质量问题单（调整安装方式、费用发生日今天、FSH 全担），返回售后单号 */
async function registerQualityCase(page: Page, customer: string, amount: string): Promise<string> {
  return page.evaluate(
    async ({ customer, amount, today }) => {
      const json = async (res: Response) => {
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        return res.json() as Promise<Record<string, unknown>>;
      };
      const stores = (await json(await fetch('/api/channel/store-options'))) as unknown as {
        stores: { id: string; name: string }[];
      };
      const options = (await json(
        await fetch('/api/aftersales/registration-options'),
      )) as unknown as { owners: { id: string; name: string }[] };
      const fee = (value: string | null) => ({ amount: value, currency: 'USD' });
      const fsh = { fsh: 100, factory: 0 };
      const created = await json(
        await fetch('/api/aftersales/registrations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            method: 'adjust_installation',
            storeId: stores.stores.find((s) => s.name === 'forcome.com')?.id,
            site: 'US',
            orderNumber: '#1091',
            customerName: customer,
            sourceTicket: '',
            feeDate: today,
            ownerId: options.owners.find((o) => o.name === '王磊')?.id,
            responsibility: 'product_quality',
            responsibilityReason: '',
            factory: null,
            ratios: { product: fsh, freight: fsh, other: fsh },
            claimTarget: null,
            claimStatus: null,
            partSku: null,
            partQuantity: null,
            shipper: null,
            carrier: '',
            shipDate: null,
            trackingNumber: '',
            fees: {
              productCost: fee(amount),
              freight: fee(null),
              compensation: fee(null),
              otherCost: fee(null),
            },
          }),
        }),
      );
      return String(created.number);
    },
    { customer, amount, today: beijingToday() },
  );
}

test('AC-RP-01（界面）：客服主管的成本卡卡头与接口、P13 合计一致；点「产品质量问题」的条下钻到 P13，筛选为本月 + 产品质量问题', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await registerQualityCase(page, 'Cost Drill', '12.34');
  const cost = await apiCost(page);
  const today = beijingToday();
  expect(cost.range).toEqual({ from: `${today.slice(0, 8)}01`, to: today });
  const quality = cost.bars.find((bar) => bar.responsibility === 'product_quality')!;

  await page.goto('/reports');
  const card = page.getByTestId('cost-chart');
  await expect(card).toContainText('售后成本按责任类型');
  await expect(card).toContainText('本月 · 不随时间筛选');
  await expect(card).toContainText('产品成本 + 运费 + 额外赔偿 + 其他');
  await expect(page.getByTestId('cost-total')).toHaveText(formatMoney(cost.totalUsd, 'USD'));
  await expect(card).toContainText(`售后成本 · ${cost.count} 单 · 来自登记台账，不含待确认`);

  // 悬停：浮层写名称与金额、来源与下钻
  const bar = card.getByRole('button', { name: '产品质量问题：查看明细' });
  await bar.hover();
  const tip = page.getByTestId('cost-tip');
  await expect(tip).toContainText(`产品质量问题 · ${formatMoney(quality.totalUsd, 'USD')}`);
  await expect(tip).toContainText('本月登记台账，不含待确认');
  await expect(tip).toContainText('点击查看明细 → P13 登记台账（已按责任筛选）');

  // 点条：进入 P13，费用发生日本月、责任产品质量问题；合计行与条一致
  await bar.click();
  await expect(page).toHaveURL(/\/aftersales\/ledger\?/);
  const url = new URL(page.url());
  expect(Object.fromEntries(url.searchParams)).toEqual({
    from: cost.range.from,
    to: cost.range.to,
    responsibility: 'product_quality',
  });
  await expect(
    page.getByTestId('ledger-filters').getByRole('button', { name: /^责任/ }),
  ).toHaveText(/责任：产品质量问题/);
  const totals = page.getByTestId('ledger-totals');
  await expect(totals).toContainText(`合计 · ${quality.count} 单`);
  await expect(totals).toContainText(formatMoney(quality.totalUsd, 'USD'));
  await expect(page.getByTestId('ledger-row').filter({ hasText: 'Cost Drill' })).toHaveCount(1);
});

test('「查看明细」进入 P13 本月、不带责任：合计与卡头一致', async ({ page }) => {
  await loginAs(page, '周敏');
  const cost = await apiCost(page);
  await page.goto('/reports');
  await page
    .getByTestId('cost-chart')
    .getByRole('button', { name: '查看明细', exact: true })
    .click();
  await expect(page).toHaveURL(/\/aftersales\/ledger\?/);
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(cost.range);
  await expect(page.getByTestId('ledger-totals')).toContainText(`合计 · ${cost.count} 单`);
  await expect(page.getByTestId('ledger-totals')).toContainText(formatMoney(cost.totalUsd, 'USD'));
});

/** 点「导出」，等下载完成，读出各张表 */
async function exportSheets(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const file = await download;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await file.path());
  const sheets = new Map<string, unknown[][]>();
  for (const sheet of workbook.worksheets) {
    const rows: unknown[][] = [];
    sheet.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
    sheets.set(sheet.name, rows);
  }
  return { fileName: file.suggestedFilename(), sheets };
}

test('导出（K5）：生成中按钮转圈（aria-busy）写「正在生成，约 3 秒」；完成后直接下载，浮层写文件名与「已记入审计日志」；文件含售后成本', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  const cost = await apiCost(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/reports/export**', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/reports');
  await expect(page.getByTestId('cost-chart')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const busy = page.getByRole('button', { name: '正在生成，约 3 秒' });
  await expect(busy).toBeVisible();
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  release();
  const file = await download;
  const fileName = file.suggestedFilename();
  expect(fileName).toMatch(/^报表_近7天_\d{4}-\d{4}\.xlsx$/);
  await expect(page.getByText(`已导出 ${fileName}`)).toBeVisible();
  await expect(page.getByText('已记入审计日志')).toBeVisible();
  await expect(page.getByRole('button', { name: '导出', exact: true })).toBeEnabled();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await file.path());
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    '指标',
    '每日工单量',
    '售后成本按责任类型',
  ]);
  const last = workbook.getWorksheet('售后成本按责任类型')!.lastRow!.values as unknown[];
  expect(last.slice(1)).toEqual(['合计', Number(cost.totalUsd), cost.count]);
});

test('AC-P1-09（界面）：知识库负责人看不到售后成本卡、不取成本，每日工单量占满整行；导出的文件里没有售后成本', async ({
  page,
}) => {
  const costRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/reports/cost')) costRequests.push(request.url());
  });
  await loginAs(page, '赵倩');
  await page.goto('/reports');
  await expect(page.getByTestId('daily-chart')).toBeVisible();
  await expect(page.getByTestId('cost-chart')).toHaveCount(0);
  await expect(page.getByText('售后成本按责任类型')).toHaveCount(0);
  expect(costRequests).toEqual([]);
  // 每日工单量占满整行（与筛选行同宽）
  const chart = (await page.getByTestId('daily-chart').boundingBox())!;
  const filters = (await page.getByTestId('report-kpis').boundingBox())!;
  expect(Math.abs(chart.width - filters.width)).toBeLessThan(2);

  const file = await exportSheets(page);
  expect([...file.sheets.keys()]).toEqual(['指标', '每日工单量']);
  const cells = [...file.sheets.values()].flat(2).map(String);
  expect(cells.some((cell) => /成本|\$/.test(cell))).toBe(false);
});
