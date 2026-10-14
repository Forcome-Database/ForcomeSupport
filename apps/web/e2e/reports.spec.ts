import { addDays, businessDate } from '@forcome/calendar';
import { ticketListSchema, ticketReportSchema, type TicketReport } from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { expect, test, type Page } from '@playwright/test';

/*
 * P17 报表的工单部分（待办 24；PRD P17「指标口径」「第一阶段」v2.34、K19、K3、K4，AC-P1-10、AC-P1-14、AC-RP-03）：
 * 客服主管看到三个指标与每日工单量（数与接口一致）、点柱下钻到 P04（条数与柱一致）；管理员不可下钻；无数据、加载与加载失败。
 * AC-P1-14 用专门的验收夹具：开发接口让 worker 在验收日（示例的 09-10）投 73 封客户来信（亚马逊 52、Shopify 与邮件 21），
 * 示例数据回放平移到了当下，验收日那天没有别的工单。开发测试环境长期运行：重复投递按 Gmail 消息 ID 去重，用例可以重复执行；
 * 验收日的来信早于 14 天，时限扫描（每分钟）会把这 73 张关闭——用例最后等它们关闭，免得排在 P04 默认排序的前面影响后面的用例。
 */

const ACCEPTANCE = getDemoFixture().reportAcceptance;

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

async function apiReport(page: Page, query = ''): Promise<TicketReport> {
  const res = await page.request.get(`/api/reports/tickets${query ? `?${query}` : ''}`);
  expect(res.ok()).toBe(true);
  return ticketReportSchema.parse(await res.json());
}

/** 一个日期在今年写「09-10」，不在今年写全年份（同 P04 下钻芯片） */
function dayWords(date: string): string {
  return date.startsWith(businessDate(new Date()).slice(0, 4)) ? date.slice(5) : date;
}

/** 悬停每日工单量的第 i 根柱（共 n 根，从 0 数）：按绘图区的宽算位置（纵轴宽 28、右边距 8） */
async function hoverBar(page: Page, i: number, n: number) {
  const box = (await page.getByTestId('daily-chart').locator('.recharts-surface').boundingBox())!;
  const x = box.x + 28 + (i + 0.5) * ((box.width - 36) / n);
  const y = box.y + box.height - 80;
  await page.mouse.move(0, 0);
  await page.mouse.move(x, y, { steps: 10 });
  return { x, y };
}

test('客服主管：标题下数据来源与「更新于」、两条注，三个指标与每日工单量与接口一致；店铺筛选写进地址栏', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  const data = await apiReport(page);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: '报表' })).toBeVisible();
  await expect(page.getByTestId('report-sources')).toHaveText(
    /^数据来源：工单（Gmail）、平台订单、登记台账 · 更新于 /,
  );
  await expect(page.getByText('只统计经店铺邮箱发出的回复')).toBeVisible();
  if (data.shopifyBackfillDays) {
    await expect(page.getByTestId('report-backfill-note')).toHaveText(
      `Shopify 订单只回补了 ${data.shopifyBackfillDays} 天，更早的 Shopify 来信可能关联不到订单`,
    );
  }
  await expect(page.getByRole('radio', { name: '近 7 天' })).toHaveAttribute('data-state', 'on');
  const kpis = page.getByTestId('report-kpi');
  await expect(kpis).toHaveCount(3);
  await expect(kpis.nth(0)).toContainText('工单量');
  await expect(kpis.nth(0)).toContainText('近 7 天 · 客户来信新建或重开');
  await expect(kpis.nth(1)).toContainText('首响中位数');
  await expect(kpis.nth(2)).toContainText('SLA 达标率（亚马逊）');
  const fresh = await apiReport(page);
  await expect(kpis.nth(0)).toContainText(String(fresh.current.volume));
  const chart = page.getByTestId('daily-chart');
  await expect(chart).toContainText('每日工单量');
  await expect(chart).toContainText('按渠道堆叠 · 近 7 天 · 点柱下钻');
  await expect(chart.getByRole('button', { name: '查看明细', exact: true })).toBeVisible();
  // 近 7 天每天一根柱，横轴写「月-日」
  expect(fresh.daily).toHaveLength(7);
  for (const day of fresh.daily) await expect(chart).toContainText(day.date.slice(5));

  // 店铺：选了写进地址栏，指标按该店铺
  const store = getDemoFixture().stores.find((s) => s.key === 'amz-direct')!;
  await page
    .getByTestId('report-filters')
    .getByRole('button', { name: /^店铺：/ })
    .click();
  await page.getByRole('option', { name: store.name }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('store') === store.id);
  const direct = await apiReport(page, `store=${store.id}`);
  await expect(kpis.nth(0)).toContainText(String(direct.current.volume));
  await expect(
    page.getByTestId('report-filters').getByRole('button', { name: '清除筛选' }),
  ).toBeVisible();
});

test('AC-P1-14：验收日「每日工单量」的柱为 73，点柱进入 P04，「来自报表」芯片、计数行「共 73 条」，列表逐页合计 73 张', async ({
  page,
}) => {
  // 收信与归并逐封处理（每封之间等任务轮询的 2 秒），73 封第一次投要几分钟（本机约 3 分钟，开发测试环境的主机慢，约 10 分钟）；
  // 重复投递去重，之后立即返回
  test.setTimeout(1_080_000);
  await loginAs(page, '周敏');
  const delivered = await page.request.post('/api/dev/report-acceptance');
  expect(delivered.status()).toBe(202);
  const { date } = ACCEPTANCE;
  const from = addDays(date, -6);
  const query = `period=custom&from=${from}&to=${date}`;
  // worker 收信、归并成工单
  await expect
    .poll(async () => (await apiReport(page, query)).daily.at(-1), {
      timeout: 900_000,
      intervals: [10_000],
    })
    .toEqual({ date, amazon: ACCEPTANCE.amazon, shopify_email: ACCEPTANCE.shopifyEmail });

  await page.goto(`/reports?${query}`);
  const day = dayWords(date);
  await hoverBar(page, 6, 7);
  const tip = page.getByTestId('daily-tip');
  await expect(tip).toContainText(`${day} · 73 单`);
  await expect(tip).toContainText('亚马逊 52 · Shopify 与邮件 21');
  await expect(tip).toContainText(`点击查看明细 → P04 工单（${day} 新建或重开 · 客户来信）`);
  const { x, y } = await hoverBar(page, 6, 7);
  await page.mouse.click(x, y);

  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/tickets' &&
      url.searchParams.get('drill') === 'triggered' &&
      url.searchParams.get('drillFrom') === date &&
      url.searchParams.get('origin') === 'daily-bar',
  );
  await expect(page.getByTestId('drill-chip')).toHaveText(`来自报表：${day} 新建或重开 · 客户来信`);
  await expect(page.getByTestId('drill-count')).toContainText('共 73 条');
  await expect(page.getByTestId('drill-count')).toContainText(
    `条件与报表「每日工单量」${day} 的柱同口径：客户来信触发的新建或重开 ${day}`,
  );
  // 下钻结果多于一页照常分页（每页 20）：逐页数下来正好 73 张
  let rows = 0;
  const pager = page.getByTestId('ticket-pager');
  await expect(pager).toContainText('共 73 条 · 每页 20 条');
  for (let p = 1; p <= 4; p += 1) {
    await expect(pager).toContainText(`${p} / 4`);
    const onPage = page.getByTestId('ticket-row');
    await expect(onPage).toHaveCount(p < 4 ? 20 : 13);
    rows += await onPage.count();
    if (p < 4) await pager.getByRole('button', { name: '下一页' }).click();
  }
  expect(rows).toBe(73);

  // 验收日的工单早于 14 天，等时限扫描把它们关闭（P04 默认排序把已超时的待回复排在最前，影响后面的用例）
  const today = businessDate(new Date());
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `/api/tickets?drill=triggered&drillFrom=${date}&inbound=custom&from=${date}&to=${today}&status=closed`,
        );
        return ticketListSchema.parse(await res.json()).total;
      },
      { timeout: 120_000 },
    )
    .toBe(73);
});

test('AC-P1-10：管理员没有工单页权限——没有「查看明细」，卡头写不可下钻，柱与指标不可点', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await page.goto('/reports');
  const chart = page.getByTestId('daily-chart');
  await expect(chart.getByTestId('daily-no-drill')).toHaveText('没有工单页权限 · 不可下钻');
  await expect(chart).toContainText('按渠道堆叠 · 近 7 天');
  await expect(chart).not.toContainText('点柱下钻');
  await expect(page.getByRole('button', { name: '查看明细', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /：查看明细$/ })).toHaveCount(0);
  await expect(page.getByTestId('report-kpi')).toHaveCount(3);
  const { x, y } = await hoverBar(page, 6, 7);
  await expect(page.getByTestId('daily-tip')).not.toContainText('点击查看明细');
  await page.mouse.click(x, y);
  await page.waitForTimeout(500);
  await expect(page).toHaveURL((url) => url.pathname === '/reports');
});

test('AC-RP-03 与 K4：所选范围无数据时三张指标「—」，主区写明范围并给「调整筛选」（点开自定义日历）与「清除筛选」', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  const year = businessDate(new Date()).slice(0, 4);
  const from = `${Number(year) - 1}-01-01`;
  const to = `${Number(year) - 1}-01-07`;
  await page.goto(`/reports?period=custom&from=${from}&to=${to}`);
  const empty = page.getByTestId('report-empty');
  await expect(empty).toContainText('所选范围没有数据');
  await expect(empty).toContainText(
    `${from} 至 ${to} 全部店铺 没有工单。调整时间、店铺或站点后再看。`,
  );
  const kpis = page.getByTestId('report-kpi');
  for (let i = 0; i < 3; i += 1) {
    await expect(kpis.nth(i)).toContainText('—');
    await expect(kpis.nth(i)).toContainText('所选范围无数据');
  }
  await empty.getByRole('button', { name: '调整筛选' }).click();
  await expect(page.getByRole('dialog', { name: '自定义时间' })).toBeVisible();
  await page.keyboard.press('Escape');
  await empty.getByRole('button', { name: '清除筛选' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/reports' && url.search === '');
  await expect(page.getByTestId('daily-chart')).toBeVisible();
});

test('K3：超过 300ms 未返回显示骨架与「正在加载」，超过 10 秒转加载失败，重试后恢复', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await loginAs(page, '周敏');
  let hold = 1_500;
  await page.route('**/api/reports/tickets**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, hold));
    await route.continue().catch(() => undefined);
  });
  await page.goto('/reports');
  await expect(page.getByTestId('report-kpis-loading')).toBeVisible();
  await expect(page.getByTestId('report-loading')).toContainText('正在加载');
  await expect(page.getByTestId('report-kpi')).toHaveCount(3);

  // 换条件：一直不返回，10 秒后转加载失败
  hold = 30_000;
  await page.getByRole('radio', { name: '本月' }).click();
  await expect(page.getByTestId('report-loading')).toContainText('正在加载 · 更新于 ');
  await expect(page.getByText('加载失败')).toBeVisible({ timeout: 15_000 });
  hold = 0;
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByTestId('report-kpi').nth(0)).toContainText('本月 · 客户来信新建或重开');
});
