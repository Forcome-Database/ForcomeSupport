import { expect, test, type Page } from '@playwright/test';

/*
 * 汇率（待办 20；R-FL-06、E-20、AC-P1-08，S13、S14）：P13 金额写冻结的美元值，非美元另起一行写原币与汇率日期；
 * 新建登记抽屉里非美元金额框下即时显示折算，比例表与费用合计按折算后的美元算。
 * 汇率由 worker 的每日同步写入（启动时也同步一次）；开发测试环境与本机 e2e 的汇率来源是 Fake，从 2025-01-01 起
 * 每个工作日都是演示汇率 1 USD = 18.00 MXN、1.36 CAD。新建的那张单用带时间戳的客户名找回来（售后单不能删）。
 */

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

const drawer = (page: Page) => page.getByRole('dialog');
const textbox = (page: Page, name: string) =>
  drawer(page).getByRole('textbox', { name, exact: true });

async function choose(page: Page, label: string, option: string): Promise<void> {
  await drawer(page)
    .getByRole('combobox', { name: new RegExp(`^${label}`) })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** 北京时间的今天（抽屉里费用发生日的默认值） */
function beijingToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

/**
 * 等 worker 启动时的汇率同步写完（刚部署或刚起 e2e 服务时可能还在跑）。在页面里 fetch：与页面同一个会话、
 * 同一套证书校验（开发测试环境的根证书只装进了冒烟容器的 Chromium，Node 端的 page.request 不信任它）
 */
async function waitForRates(page: Page, date: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async (day) => {
          const res = await fetch(`/api/aftersales/exchange-rates?date=${day}`);
          const body = (await res.json()) as { rates?: { MXN: unknown } };
          return body.rates?.MXN ?? null;
        }, date),
      { timeout: 30_000 },
    )
    .not.toBeNull();
}

/** 填一张 Forcome Direct 的「退款或部分补偿」（客户使用问题：三组都是 FSH 100，没有生产厂） */
async function fillRefund(page: Page, customer: string): Promise<void> {
  await page.getByRole('button', { name: '新建登记' }).click();
  await drawer(page)
    .getByRole('radio', { name: /退款或部分补偿/ })
    .click();
  await choose(page, '店铺', 'Forcome Direct');
  await textbox(page, '订单号').fill('302-8811234-9901122');
  await textbox(page, '客户').fill(customer);
  await choose(page, '责任类型', '客户使用问题');
  await textbox(page, '运费').fill('0');
  await textbox(page, '其他').fill('0');
}

test('非美元金额：抽屉里即时折算成美元，保存后台账写美元与「原币 · 汇率 日期」（S13、S14、R-FL-06）', async ({
  page,
}) => {
  const customer = `E2E 汇率 ${Date.now()}`;
  await loginAs(page, '王磊');
  await waitForRates(page, beijingToday());
  await page.goto('/aftersales/ledger');

  // 示例单 S-20260911-0020：额外赔偿冻结为 $49.39，下方写原币与汇率日期，悬停说明汇率的来源
  const sample = page.getByTestId('ledger-row').filter({ hasText: 'S-20260911-0020' });
  await expect(sample).toContainText('$49.39');
  await expect(sample).toContainText('MX$889.00 · 汇率 09-10');
  await expect(
    sample.getByTitle('汇率取费用发生日的欧洲央行日汇率；售后负责人可修改并记审计'),
  ).toBeVisible();

  await fillRefund(page, customer);
  await textbox(page, '额外赔偿').fill('889.00');
  await choose(page, '额外赔偿的币种', 'MXN');
  await textbox(page, '产品成本').fill('12');
  await choose(page, '产品成本的币种', 'CAD');

  // 金额框下：≈ 美元 · 汇率 月-日（1 USD = 汇率 币种）；美元金额下面没有折算
  const date = String.raw`汇率 \d{2}-\d{2}`;
  await expect(
    drawer(page).getByText(new RegExp(String.raw`^≈ \$49\.39 · ${date}（1 USD = 18\.00 MXN）$`)),
  ).toBeVisible();
  await expect(
    drawer(page).getByText(new RegExp(String.raw`^≈ \$8\.82 · ${date}（1 USD = 1\.36 CAD）$`)),
  ).toBeVisible();
  await expect(drawer(page).getByText(/^≈ /)).toHaveCount(2);
  // 比例表与合计按折算后的美元算：其他费用 $49.39、产品成本 $8.82，全部 FSH 承担
  await expect(drawer(page).getByText('费用合计 $58.21')).toBeVisible();
  await expect(drawer(page).getByText('FSH 合计 $58.21 · 工厂合计 $0.00')).toBeVisible();

  await drawer(page).getByRole('button', { name: '保存登记' }).click();
  await expect(page.getByText('登记已保存')).toBeVisible();
  await expect(drawer(page)).toBeHidden();

  const row = page.getByTestId('ledger-row').filter({ hasText: customer });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('$49.39');
  await expect(row).toContainText(new RegExp(`MX\\$889\\.00 · ${date}`));
  await expect(row).toContainText('$8.82');
  await expect(row).toContainText(new RegExp(`CA\\$12\\.00 · ${date}`));
  // 美元的运费只写美元，没有原币一行
  await expect(row.getByText(/^汇率 /)).toHaveCount(2);
  await expect(
    row.getByTitle('汇率取费用发生日的欧洲央行日汇率；售后负责人可修改并记审计'),
  ).toHaveCount(2);

  // 售后负责人改汇率（接口；界面入口随待办 21 的编辑登记）：美元值按新汇率重算，悬停说明写手工修改的汇率（S14 补充小样之二）
  const changed = await page.evaluate(async (name) => {
    const ledger = (await (await fetch('/api/aftersales/ledger')).json()) as {
      items: { number: string; version: number; customerName: string | null }[];
    };
    const item = ledger.items.find((i) => i.customerName === name);
    if (!item) return 0;
    const res = await fetch(`/api/aftersales/${item.number}/rates`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: item.version, rates: { compensation: '17.5' } }),
    });
    return res.status;
  }, customer);
  expect(changed).toBe(200);
  await page.reload();
  await expect(row).toContainText('$50.80');
  await expect(
    row.getByTitle('汇率为手工修改：1 USD = 17.50 MXN（售后负责人修改，已记入审计日志）'),
  ).toBeVisible();
  await expect(
    row.getByTitle('汇率取费用发生日的欧洲央行日汇率；售后负责人可修改并记审计'),
  ).toHaveCount(1);
});

test('费用发生日及之前没有汇率：金额框下说明，保存时报在该金额下方、不保存（E-20 的极端情形）', async ({
  page,
}) => {
  // 浏览器的今天固定在 1998 年：费用发生日默认这天，欧洲央行 1999 年才开始公布参考汇率
  await page.clock.setFixedTime(new Date('1998-12-10T10:00:00+08:00'));
  await loginAs(page, '周敏');
  await page.goto('/aftersales/ledger');
  await expect(page.getByTestId('ledger-row').first()).toBeVisible();
  const rowsBefore = await page.getByTestId('ledger-row').count();

  await fillRefund(page, 'E2E 没有汇率');
  await textbox(page, '产品成本').fill('0');
  await textbox(page, '额外赔偿').fill('889.00');
  await choose(page, '额外赔偿的币种', 'MXN');
  const noRate = '费用发生日及之前没有汇率，暂时不能折算美元';
  await expect(drawer(page).getByText(noRate)).toBeVisible();
  await expect(drawer(page).getByText('费用合计 —')).toBeVisible();

  await drawer(page).getByRole('button', { name: '保存登记' }).click();
  await expect(drawer(page).getByText('有 1 项需要修改')).toBeVisible();
  await expect(textbox(page, '额外赔偿')).toHaveAttribute('aria-invalid', 'true');
  // 定位到靠近底部的「额外赔偿」：输入框与下方的报错都完整落在可见区里（不被横幅压短的滚动区或底栏挡住）
  await expect(textbox(page, '额外赔偿')).toBeFocused();
  await expect(textbox(page, '额外赔偿')).toBeInViewport({ ratio: 1 });
  await expect(drawer(page).getByText(noRate)).toBeInViewport({ ratio: 1 });

  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click();
  await expect(drawer(page)).toBeHidden();
  await expect(page.getByTestId('ledger-row')).toHaveCount(rowsBefore);
});
