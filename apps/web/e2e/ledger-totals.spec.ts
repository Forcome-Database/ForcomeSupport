import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';

/*
 * 台账的筛选行、列设置、合计行与导出（待办 22；PRD P13「第一阶段」、S11、S13 与补充小样，K5）。
 * 示例台账（原型数据）在 2026 年 9 月；台账默认只列本月，看示例单时带上 9 月的费用发生日。
 * 开发测试环境长期运行、数据会累积：数字只核对列表与文件、合计行与各行之间的关系；要特定数据的用例先经接口登记自己的单
 * （费用发生日是今天，落在默认的本月里）。接口调用在页面里 fetch（与页面同一个会话、同一套证书校验）。
 */

const SEPTEMBER = '/aftersales/ledger?from=2026-09-01&to=2026-09-30';

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

const rows = (page: Page) => page.getByTestId('ledger-row');
const row = (page: Page, text: string) => rows(page).filter({ hasText: text });
const totalsRow = (page: Page) => page.getByTestId('ledger-totals');
const chip = (page: Page, label: string) =>
  page.getByTestId('ledger-filters').getByRole('button', { name: new RegExp(`^${label}`) });

/** 北京时间的今天 */
function beijingToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

async function open(page: Page, path = '/aftersales/ledger'): Promise<void> {
  await page.goto(path);
  await expect(rows(page).first()).toBeVisible();
}

/** 单选芯片：点开浮层选一项 */
async function pick(page: Page, label: string, option: string): Promise<void> {
  await chip(page, label).click();
  await page.getByRole('dialog', { name: label }).getByRole('option', { name: option }).click();
}

/** 点「导出 Excel」，等下载完成，读出工作表的各行（第一行是表头） */
async function exportRows(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const file = await download;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await file.path());
  const sheet = workbook.worksheets[0]!;
  const values: unknown[][] = [];
  sheet.eachRow((r) => values.push((r.values as unknown[]).slice(1)));
  return { fileName: file.suggestedFilename(), header: values[0] as string[], values };
}

/** 经接口登记一张 forcome.com 的寄配件单（费用发生日今天、负责人王磊），按需取消，返回售后单号 */
async function register(
  page: Page,
  input: {
    customer: string;
    ratios: { product: number; freight: number; other: number };
    fees: { productCost: string; freight: string; compensation: string | null };
    cancelKeeping?: readonly string[];
  },
): Promise<string> {
  return page.evaluate(
    async ({ input, today }) => {
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
      const side = (factory: number) => ({ fsh: 100 - factory, factory });
      const fee = (amount: string | null) => ({ amount, currency: 'USD' });
      const created = await json(
        await fetch('/api/aftersales/registrations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            method: 'send_parts',
            storeId: stores.stores.find((s) => s.name === 'forcome.com')?.id,
            site: 'US',
            orderNumber: '#1090',
            customerName: input.customer,
            sourceTicket: '',
            feeDate: today,
            ownerId: options.owners.find((o) => o.name === '王磊')?.id,
            responsibility: 'other',
            responsibilityReason: '双方分摊',
            factory: 'FQD',
            ratios: {
              product: side(input.ratios.product),
              freight: side(input.ratios.freight),
              other: side(input.ratios.other),
            },
            claimTarget: null,
            claimStatus: null,
            partSku: 'FC-V2-HF01',
            partQuantity: 1,
            shipper: null,
            carrier: '',
            shipDate: null,
            trackingNumber: '',
            fees: {
              productCost: fee(input.fees.productCost),
              freight: fee(input.fees.freight),
              compensation: fee(input.fees.compensation),
              otherCost: fee(null),
            },
          }),
        }),
      );
      if (input.cancelKeeping) {
        await json(
          await fetch(`/api/aftersales/${String(created.number)}/cancel`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              version: created.version,
              reason: 'E2E 取消',
              keptFees: input.cancelKeeping,
            }),
          }),
        );
      }
      return String(created.number);
    },
    { input, today: beijingToday() },
  );
}

/** 「$1,234.50」→ 1234.5 */
const amountOf = (text: string) => Number(text.replace(/[^\d.]/g, ''));

test('筛选 → 导出 → 下载文件的行数与列表一致；浮层写文件名与单数（S11、K5）', async ({ page }) => {
  await loginAs(page, '王磊');
  await open(page, SEPTEMBER);
  await pick(page, '状态', '已完成');
  await expect(page).toHaveURL(/status=completed/);
  await expect(chip(page, '状态')).toHaveText(/状态：已完成/);
  const numbers = await rows(page)
    .getByRole('button', { name: /^打开 S-/ })
    .allTextContents();
  expect(numbers.length).toBeGreaterThan(0);

  const file = await exportRows(page);
  expect(file.fileName).toBe('登记台账_20260901-20260930.xlsx');
  // 表头 + 各行 + 合计
  const data = file.values.slice(1, -1);
  expect(data.map((r) => r[0])).toEqual(numbers);
  expect(file.values.at(-1)?.[0]).toBe(`合计 · ${numbers.length} 单`);
  expect(file.header).toContain('FSH 承担 $');
  await expect(page.getByText('登记台账已导出')).toBeVisible();
  await expect(
    page.getByText(
      `登记台账_20260901-20260930.xlsx · ${numbers.length} 单，浏览器已开始下载 · 已记入审计日志。`,
    ),
  ).toBeVisible();
});

test('坐席导出的文件不含七个金额列，也没有合计行', async ({ page }) => {
  await loginAs(page, '李婷');
  await open(page, SEPTEMBER);
  const count = await rows(page).count();
  const file = await exportRows(page);
  for (const column of [
    '产品成本',
    '运费',
    '额外赔偿',
    '其他',
    '费用合计',
    'FSH 承担 $',
    '工厂承担 $',
  ]) {
    expect(file.header).not.toContain(column);
  }
  expect(file.header).toContain('售后单号');
  expect(file.values).toHaveLength(count + 1);
});

test('合计行：「合计 · N 单」与各金额列为各行之和；「其他」隐藏时另写它的合计；坐席没有合计行', async ({
  page,
}) => {
  await loginAs(page, '王磊');
  await open(page, SEPTEMBER);
  const count = await rows(page).count();
  const totals = totalsRow(page);
  await expect(totals).toContainText(`合计 · ${count} 单`);
  await expect(totals).toContainText('首列与合计行固定');
  await expect(totals).toContainText(/· 隐藏列「其他」\$\d/);
  // 费用合计这一列（表头的第 12 列）各行之和等于合计行
  const header = await page.getByRole('columnheader').allTextContents();
  const feeTotal = header.indexOf('费用合计');
  const cells = await rows(page)
    .locator(`td:nth-child(${feeTotal + 1})`)
    .allTextContents();
  const sum = cells.reduce((s, text) => s + Math.round(amountOf(text) * 100), 0);
  const footer = await totals.locator('td').allTextContents();
  // 合计行：首格（含说明）+ 跨列的空格 + 金额各列
  const footerFeeTotal = footer[2 + (feeTotal - header.indexOf('产品成本'))] ?? '';
  expect(Math.round(amountOf(footerFeeTotal) * 100)).toBe(sum);

  await loginAs(page, '李婷');
  await open(page, SEPTEMBER);
  await expect(totalsRow(page)).toHaveCount(0);
});

test('列设置：默认隐藏四列；勾选显示「其他」等列，「已隐藏 N 列」与合计行随之变化，刷新后保留，「恢复默认」', async ({
  page,
}) => {
  await loginAs(page, '王磊');
  await open(page, SEPTEMBER);
  const hiddenLine = page.getByText(/^已隐藏 \d 列：/);
  await expect(hiddenLine).toHaveText(
    '已隐藏 4 列：配件 × 数量、负责人、其他、生产厂 · 表格可横向滚动',
  );
  await expect(page.getByRole('columnheader', { name: '负责人' })).toHaveCount(0);

  // 「在「列设置」中显示」打开同一个菜单
  await page.getByRole('button', { name: '在「列设置」中显示' }).click();
  const menu = page.getByRole('menu');
  for (const label of [
    '客户',
    '店铺与站点',
    '负责人',
    '生产厂',
    '配件 × 数量',
    '其他',
    '工厂承担 $',
  ]) {
    await expect(menu.getByRole('menuitemcheckbox', { name: label, exact: true })).toBeVisible();
  }
  await expect(menu.getByRole('menuitemcheckbox', { name: '售后单号' })).toHaveCount(0);
  await menu.getByRole('menuitemcheckbox', { name: '其他', exact: true }).click();
  await menu.getByRole('menuitemcheckbox', { name: '负责人', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(hiddenLine).toHaveText('已隐藏 2 列：配件 × 数量、生产厂 · 表格可横向滚动');
  await expect(page.getByRole('columnheader', { name: '其他', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '负责人' })).toBeVisible();
  await expect(totalsRow(page)).not.toContainText('隐藏列「其他」');
  await expect(row(page, 'S-20260904-0013')).toContainText('王磊');

  // 按人存在本机：刷新后保留
  await page.reload();
  await expect(page.getByRole('columnheader', { name: '负责人' })).toBeVisible();
  await expect(hiddenLine).toHaveText('已隐藏 2 列：配件 × 数量、生产厂 · 表格可横向滚动');

  // 再显示另外两列：没有隐藏列时这一行不显示
  await page.getByRole('button', { name: '列设置', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: '生产厂', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: '配件 × 数量', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/^已隐藏 \d 列：/)).toHaveCount(0);
  await expect(row(page, 'S-20260904-0013')).toContainText('HEPA 滤芯组件 FC-V2-HF01 × 2');
  await expect(row(page, 'S-20260904-0013')).toContainText('FQD');

  await page.getByRole('button', { name: '列设置', exact: true }).click();
  await page.getByRole('menuitem', { name: '恢复默认' }).click();
  await expect(hiddenLine).toHaveText(
    '已隐藏 4 列：配件 × 数量、负责人、其他、生产厂 · 表格可横向滚动',
  );

  // 坐席：列设置里没有金额列，「已隐藏 3 列」不写「表格可横向滚动」
  await loginAs(page, '李婷');
  await open(page, SEPTEMBER);
  await expect(page.getByText(/^已隐藏 \d 列：/)).toHaveText(
    '已隐藏 3 列：配件 × 数量、负责人、生产厂',
  );
  await page.getByRole('button', { name: '列设置', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: '产品成本' })).toHaveCount(0);
  await expect(page.getByRole('menuitemcheckbox', { name: '负责人' })).toBeVisible();
});

test('首列与合计行固定：列多时整表横向滚动，售后单号这一列与合计行不动', async ({ page }) => {
  await loginAs(page, '王磊');
  await open(page, SEPTEMBER);
  await page.getByRole('button', { name: '列设置', exact: true }).click();
  for (const label of ['负责人', '生产厂', '配件 × 数量', '其他']) {
    await page.getByRole('menuitemcheckbox', { name: label, exact: true }).click();
  }
  await page.keyboard.press('Escape');
  const container = page.locator('[data-slot=table-container]');
  const scrollable = await container.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(scrollable).toBeGreaterThan(0);
  const number = rows(page).first().locator('td').first();
  const customerHeader = page.getByRole('columnheader', { name: '客户' });
  const before = await number.boundingBox();
  const customerBefore = await customerHeader.boundingBox();
  await container.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect
    .poll(async () => (await customerHeader.boundingBox())?.x)
    .toBeLessThan(customerBefore!.x - 50);
  expect((await number.boundingBox())?.x).toBe(before!.x);
  await expect(totalsRow(page).locator('td').first()).toBeInViewport();
  await expect(totalsRow(page).getByText(/^\$/).last()).toBeInViewport();
});

test('筛选行：费用发生日默认本月，区间日历选好起止即生效；单选芯片；偏离默认时「清除筛选」', async ({
  page,
}) => {
  const today = beijingToday();
  const month = today.slice(0, 7);
  await loginAs(page, '王磊');
  await page.goto('/aftersales/ledger');
  await expect(chip(page, '费用发生日')).toHaveText(`费用发生日：${month}-01 至 ${today.slice(5)}`);
  await expect(chip(page, '店铺')).toHaveText('店铺：全部');
  for (const label of ['处理方式', '责任', '状态', '负责人']) {
    await expect(chip(page, label)).toHaveText(label);
  }
  await expect(
    page.getByTestId('ledger-filters').getByRole('button', { name: '清除筛选' }),
  ).toHaveCount(0);

  // 区间日历：点第一天开始，点第二天即生效并关闭
  await chip(page, '费用发生日').click();
  const calendar = page.getByRole('dialog', { name: '费用发生日' });
  await calendar.locator('td button').filter({ hasText: /^2$/ }).click();
  await expect(calendar).toBeVisible();
  await calendar.locator('td button').filter({ hasText: /^1$/ }).click();
  await expect(calendar).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`from=${month}-01&to=${month}-02`));
  await expect(chip(page, '费用发生日')).toHaveText(
    `费用发生日：${month}-01 至 ${month.slice(5)}-02`,
  );

  // 单选芯片：选中后写「名称：值」；下拉第一项「全部」清除该条件
  await pick(page, '店铺', 'forcome.com');
  await expect(chip(page, '店铺')).toHaveText('店铺：forcome.com');
  await expect(page).toHaveURL(/store=/);
  await pick(page, '处理方式', '寄配件');
  await expect(chip(page, '处理方式')).toHaveText('处理方式：寄配件');
  await pick(page, '处理方式', '全部');
  await expect(chip(page, '处理方式')).toHaveText('处理方式');
  await pick(page, '负责人', '王磊');
  await expect(chip(page, '负责人')).toHaveText('负责人：王磊');

  await page.getByTestId('ledger-filters').getByRole('button', { name: '清除筛选' }).click();
  await expect(page).toHaveURL(/\/aftersales\/ledger$/);
  await expect(chip(page, '店铺')).toHaveText('店铺：全部');
  await expect(chip(page, '费用发生日')).toHaveText(`费用发生日：${month}-01 至 ${today.slice(5)}`);
});

test('列表为空：说明写当前筛选与「清除筛选查看全部 N 张」，按钮「清除筛选」；条件就是默认时没有按钮', async ({
  page,
}) => {
  await loginAs(page, '王磊');
  await open(page, SEPTEMBER);
  await pick(page, '店铺', 'forcome.mx');
  await pick(page, '责任', '其他');
  await expect(page.getByText('没有符合条件的售后单')).toBeVisible();
  await expect(
    page.getByText(
      /^当前筛选：费用发生日 2026-09-01 至 09-30 · 店铺 forcome\.mx · 责任 其他。换个条件试试(，或清除筛选查看全部 \d+ 张)?。$/,
    ),
  ).toBeVisible();
  await page.getByRole('table').getByRole('button', { name: '清除筛选' }).click();
  await expect(page).toHaveURL(/\/aftersales\/ledger$/);

  // 默认条件下为空（接口返回空列表）：只写当前筛选，没有按钮
  await page.route('**/api/aftersales/ledger', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, items: [], totals: undefined } });
  });
  await page.reload();
  await expect(page.getByText('没有符合条件的售后单')).toBeVisible();
  await expect(
    page.getByText(/^当前筛选：费用发生日 \d{4}-\d{2}-01 至 \d{2}-\d{2}。$/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '清除筛选' })).toHaveCount(0);
});

test('筛出缺字段后：筛选行只有「缺字段的已完成单」芯片与店铺芯片；× 移除这条筛选、保留店铺', async ({
  page,
}) => {
  await loginAs(page, '王磊');
  const store = await page.evaluate(async () => {
    const stores = (await (await fetch('/api/channel/store-options')).json()) as {
      stores: { id: string; name: string }[];
    };
    return stores.stores.find((s) => s.name === 'forcome.com')?.id;
  });
  await page.goto(`/aftersales/ledger?missing=1&store=${store}`);
  const filters = page.getByTestId('ledger-filters');
  await expect(filters.getByText('缺字段的已完成单：')).toBeVisible();
  await expect(chip(page, '店铺')).toHaveText('店铺：forcome.com');
  for (const label of ['费用发生日', '处理方式', '责任', '状态', '负责人']) {
    await expect(chip(page, label)).toHaveCount(0);
  }
  await expect(filters.getByRole('button', { name: '清除筛选' })).toBeVisible();
  await filters.getByRole('button', { name: '移除这条筛选' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?store=${store}$`));
  await expect(chip(page, '费用发生日')).toBeVisible();
});

test('已取消的单只计保留的部分（没保留的写 $0.00，悬停原登记额）；三组比例不同时承担的悬停写「按费用项」', async ({
  page,
}) => {
  const stamp = Date.now();
  await loginAs(page, '王磊');
  const cancelled = await register(page, {
    customer: `E2E 取消 ${stamp}`,
    ratios: { product: 100, freight: 100, other: 100 },
    fees: { productCost: '3.20', freight: '8.40', compensation: null },
    cancelKeeping: ['freight'],
  });
  const mixed = await register(page, {
    customer: `E2E 分摊 ${stamp}`,
    ratios: { product: 100, freight: 0, other: 50 },
    fees: { productCost: '9.80', freight: '6.80', compensation: '4.00' },
  });
  await open(page);

  const gone = row(page, cancelled);
  await expect(gone).toContainText('已取消');
  await expect(gone.getByTitle('原登记 $3.20，取消时没有保留，不计入售后成本')).toHaveText('$0.00');
  // 运费保留 $8.40；额外赔偿没登记写「—」；费用合计与工厂承担按保留部分
  await expect(gone).toContainText('$8.40');
  await expect(gone.getByTitle('三组均 FSH 0 / 工厂 100')).toHaveText(['$0.00', '$8.40']);

  const shared = row(page, mixed);
  const title =
    '按费用项\n产品成本 FSH 0 / 工厂 100\n快递物流 FSH 100 / 工厂 0\n其他费用 FSH 50 / 工厂 50';
  // 工厂 = 9.80 + 0 + 4.00 × 50% = 11.80；FSH = 20.60 − 11.80 = 8.80
  await expect(shared.getByTitle(title)).toHaveText(['$8.80', '$11.80']);
  await expect(shared).toContainText('$20.60');
});

test('导出中：按钮写「导出中」并转圈；导出失败按 G5「导出失败：原因」+「立即重试」', async ({
  page,
}) => {
  await loginAs(page, '王磊');
  await open(page, SEPTEMBER);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/aftersales/ledger/export**', async (route) => {
    await held;
    await route.continue();
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  // 处理中：按钮写「导出中」并转圈，点击无效（防重复提交）
  await expect(page.getByRole('button', { name: '导出中' })).toHaveAttribute('aria-busy', 'true');
  release();
  await download;
  await expect(page.getByRole('button', { name: '导出 Excel' })).not.toHaveAttribute('aria-busy');

  await page.unroute('**/api/aftersales/ledger/export**');
  let fail = true;
  await page.route('**/api/aftersales/ledger/export**', async (route) => {
    if (!fail) return route.continue();
    await route.fulfill({
      status: 503,
      json: { error: 'http_error', message: '服务暂时不可用' },
    });
  });
  await page.getByRole('button', { name: '导出 Excel' }).click();
  await expect(page.getByText('导出失败：服务暂时不可用')).toBeVisible();
  fail = false;
  const retried = page.waitForEvent('download');
  await page.getByRole('button', { name: '立即重试' }).click();
  await retried;
  await expect(page.getByText('登记台账已导出').last()).toBeVisible();
  await expect(page.getByText('导出失败：服务暂时不可用')).toHaveCount(0);
});
