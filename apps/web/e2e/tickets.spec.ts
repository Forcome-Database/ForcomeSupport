import { ticketDetailSchema, ticketListSchema } from '@forcome/contracts';
import { expect, test, type Page } from '@playwright/test';

/*
 * 来信到工单（待办 08）：worker 启动时 Fake Gmail 从示例数据夹具回放来信（邮箱开始监听后送达），
 * 经 Pub/Sub 拉取、同步入库、归并成「待回复」工单；坐席在 P04 看到它们。
 * 来源、渠道与站点按待办 10 识别：亚马逊按买家消息中转域定站点，Shopify 联系表单通知为 Shopify，生产厂来信标徽标。
 * 按订单归并（待办 14）：来信里的订单号在该店铺校验后关联，订单号列显示亚马逊订单号或 Shopify 订单名，没有关联订单写「—」；
 * 同一客户两笔订单的来信分成两张（Priya Raman 的 #1057、#1049）。
 * 刚启动时 worker 可能还没归并完：P04 经实时推送自动刷新（待办 18），不用重新加载，等工单出现即可。
 * P04 完整版（待办 18）：九列（SLA 剩余、最近来信是排序表头）、筛选写进地址栏（筛选 → 无结果 I10 → 清除筛选）、
 * 从地址栏直接打开带筛选与报表下钻参数的 P04 还原芯片与计数行、点行进入 P05、数据变化时自动刷新。
 * 开发测试环境长期运行：回放的来信按 Gmail 消息 ID 去重，重复部署不会多出工单，用例可以重复执行。
 * 回复识别与按时关闭（待办 16）：示例邮件回放时按整天平移到当前日期（演示时刻落在回放之前不到一天，时分不变），平移的天数从接口读
 * （James Walker 的最近来信与夹具之差）；开发测试环境不重放来信时数据会一天天变旧，待回复的几张到了 14 天按规则关闭，
 * 状态按「演示时刻 + 已过去的时间」与关闭时限比出来。
 */

const DAY = 86_400_000;
/** 夹具里 James Walker 的最近来信（演示数据的 09-10 08:15） */
const JAMES_FIXTURE_LAST_IN = Date.parse('2026-09-10T08:15:00+08:00');

const shortTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const beijingDate = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(ms);

/** 接口里的工单（最近来信近 90 天，覆盖平移后的全部示例工单） */
async function apiTickets(page: Page, query = 'inbound=90d') {
  const res = await page.request.get(`/api/tickets?${query}`);
  expect(res.ok()).toBe(true);
  return ticketListSchema.parse(await res.json());
}

/** 示例数据平移的天数：接口给出的 James Walker 最近来信与夹具之差 */
async function replayShiftDays(page: Page): Promise<number> {
  const { tickets } = await apiTickets(page);
  const james = tickets.find((ticket) => ticket.customer.name === 'James Walker')!;
  return Math.round((Date.parse(james.lastInboundAt) - JAMES_FIXTURE_LAST_IN) / DAY);
}

/** 夹具里的一个时刻平移后的样子：编号里的日期（YYYYMMDD）与 P04「最近来信」的写法（当天只写时分） */
function shiftedTime(fixtureIso: string, days: number) {
  const at = Date.parse(fixtureIso) + days * DAY;
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    shortTime.formatToParts(at).find((p) => p.type === type)!.value;
  const clock = `${part('hour')}:${part('minute')}`;
  return {
    numberDate: beijingDate(at).replaceAll('-', ''),
    lastInbound:
      beijingDate(at) === beijingDate(Date.now())
        ? clock
        : `${part('month')}-${part('day')} ${clock}`,
  };
}

/**
 * 待回复的示例工单此刻的状态：最近来信（平移后）满 14 天按规则关闭（PRD 6.1）。时限扫描每分钟一次，
 * 刚到时限的两分钟内两种都可能
 */
function awaitingReplyStatus(lastInFixtureIso: string, days: number): string | RegExp {
  const deadline = Date.parse(lastInFixtureIso) + (days + 14) * DAY;
  if (Date.now() < deadline) return '待回复';
  return Date.now() < deadline + 2 * 60_000 ? /^(待回复|已关闭)$/ : '已关闭';
}

/** 已解决的示例工单此刻的状态：最近来信（平移后）满 7 天按规则关闭（已解决后无来信，PRD 6.1） */
function resolvedStatus(lastInFixtureIso: string, days: number): string | RegExp {
  const deadline = Date.parse(lastInFixtureIso) + (days + 7) * DAY;
  if (Date.now() < deadline) return '已解决';
  return Date.now() < deadline + 2 * 60_000 ? /^(已解决|已关闭)$/ : '已关闭';
}

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

test('坐席在 P04 看到示例来信归并成的工单（状态按回复识别与时限）', async ({ page }) => {
  await loginAs(page, '李婷');
  await expect(page).toHaveURL((url) => url.pathname === '/tickets');
  await expect(page.getByRole('heading', { name: '工单' })).toBeVisible();
  await expect(page.getByText('全部渠道 · 全部店铺')).toBeVisible();

  const table = page.getByRole('table', { name: '工单列表' });
  await expect(table.getByRole('columnheader')).toHaveText([
    '工单号',
    '主题',
    '来源',
    '渠道与店铺',
    '客户',
    '订单号',
    '状态',
    'SLA 剩余↑',
    '最近来信↕',
  ]);
  await expect(page.getByText('只读 · 数据变化时自动刷新')).toBeVisible();

  // 几个邮箱各自同步，要核对的几行都出现了才往下看（经实时推送自动刷新，不重新加载）
  const rowOf = (customer: string) => table.getByTestId('ticket-row').filter({ hasText: customer });
  await expect(async () => {
    for (const customer of ['James Walker', 'Oliver Grant', 'FQD 品质部', 'Emily Chen']) {
      await expect(rowOf(customer)).toHaveCount(1, { timeout: 2_000 });
    }
    await expect(rowOf('Priya Raman')).toHaveCount(2, { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  const james = rowOf('James Walker');
  const days = await replayShiftDays(page);
  const at = (fixtureIso: string) => shiftedTime(fixtureIso, days);

  await expect(james.getByRole('cell')).toHaveText([
    new RegExp(`^T-${at('2026-09-10T08:15:00+08:00').numberDate}-[0-9]{4}$`),
    'Box arrived crushed, the vacuum is cracked',
    '客户',
    '亚马逊 USForcome Auto',
    'James Walker',
    '113-5566112-7788990',
    awaitingReplyStatus('2026-09-10T08:15:00+08:00', days),
    // 待回复写最早一封未回复的应回复来信的剩余：平移后演示时刻落在现在之前，James 的来信早已过 24 小时；按时关闭后写「—」
    /^(已超时 .+|—)$/,
    at('2026-09-10T08:15:00+08:00').lastInbound,
  ]);
  // P05 时间线那张工单：三封来信与两封我方回复归到一张，编号日期取首封来信，最近来信是第三封（示例回放里李婷 09:05 标记无需回复，
  // 已解决，17）
  await expect(rowOf('Oliver Grant').getByRole('cell')).toHaveText([
    new RegExp(`^T-${at('2026-09-04T10:12:00+08:00').numberDate}-[0-9]{4}$`),
    'Charger cable not working',
    '客户',
    // 亚马逊按买家消息中转域识别站点（marketplace.amazon.ca → CA）
    '亚马逊 CAForcome Direct',
    'Oliver Grant',
    '204-5566778-9900112',
    resolvedStatus('2026-09-10T09:00:00+08:00', days),
    // 已解决、已关闭写「—」
    '—',
    at('2026-09-10T09:00:00+08:00').lastInbound,
  ]);
  // 已登记生产厂邮箱的来信：来源列是「生产厂」徽标；我方邮箱的自动回复不算回复，仍是待回复
  await expect(rowOf('FQD 品质部').getByRole('cell')).toHaveText([
    new RegExp(`^T-${at('2026-09-11T09:58:00+08:00').numberDate}-[0-9]{4}$`),
    '9 月电池批次抽检报告',
    '生产厂',
    '邮件 USforcome.com',
    'FQD 品质部',
    '—',
    awaitingReplyStatus('2026-09-11T09:58:00+08:00', days),
    // 生产厂来信不是应回复来信：待回复也写「—」
    '—',
    at('2026-09-11T09:58:00+08:00').lastInbound,
  ]);
  // Shopify 联系表单通知：渠道 Shopify，客户取表单里的姓名与回复邮箱；来信没有订单号，按邮箱反查零笔（她的 #0991
  // 是另一个邮箱下的单），订单号写「—」
  const emily = rowOf('Emily Chen').getByRole('cell');
  await expect(emily.nth(3)).toHaveText('Shopify USforcome.com');
  await expect(emily.nth(5)).toHaveText('—');
  // 同一客户两笔订单：两张工单，订单号列是 Shopify 订单名（#1057 等客户在前，#1049 客户未回复已关闭在后）
  await expect(rowOf('Priya Raman').getByTestId('ticket-order')).toHaveText(['#1057', '#1049']);
});

/** 等示例工单都归并出来（几个邮箱各自同步）：接口里能看到 James Walker 与 FQD 品质部 */
async function waitForSamples(page: Page): Promise<void> {
  await expect(async () => {
    const names = (await apiTickets(page)).tickets.map((ticket) => ticket.customer.name);
    expect(names).toEqual(expect.arrayContaining(['James Walker', 'FQD 品质部', 'Oliver Grant']));
  }).toPass({ timeout: 60_000 });
}

test('筛选写进地址栏 → 无结果时 I10 空状态（当前筛选 + 清除筛选）→ 清除筛选；浏览器后退还原上一步的筛选', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await waitForSamples(page);
  const table = page.getByRole('table', { name: '工单列表' });
  const rows = table.getByTestId('ticket-row');
  const filters = page.getByTestId('ticket-filters');
  await expect(rows.first()).toBeVisible();

  // 状态：已关闭（Priya Raman 的 #1049 一张）
  await filters.getByRole('button', { name: '状态' }).click();
  await page.getByRole('option', { name: '已关闭' }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('status') === 'closed');
  await expect(filters.getByRole('button', { name: /^状态：\s*已关闭$/ })).toBeVisible();
  await expect(rows.filter({ hasText: 'Priya Raman' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'James Walker' })).toHaveCount(0);

  // 再加来源：生产厂 → 没有已关闭的生产厂工单
  await filters.getByRole('button', { name: '来源' }).click();
  await page.getByRole('option', { name: '生产厂' }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('source') === 'producer');
  await expect(rows).toHaveCount(0);
  await expect(table.getByText('没有符合条件的工单')).toBeVisible();
  // 「查看全部 N 张」是清除后（默认的近 30 天、其余不选）的张数；示例来信可能还在归并，按接口此刻的条数核对
  await expect(async () => {
    const total = (await apiTickets(page, '')).total;
    await expect(table).toContainText(
      `当前筛选：状态 已关闭 · 来源 生产厂 · 最近来信 近 30 天。换个条件，或清除筛选后查看全部 ${total} 张。`,
      { timeout: 2_000 },
    );
  }).toPass({ timeout: 30_000 });

  // 浏览器后退：回到只筛状态的那一步
  await page.goBack();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('status') === 'closed' && !url.searchParams.has('source'),
  );
  await expect(rows.filter({ hasText: 'Priya Raman' })).toHaveCount(1);
  await page.goForward();
  await expect(table.getByText('没有符合条件的工单')).toBeVisible();

  // 空状态里的「清除筛选」：条件回到默认（地址栏不带筛选），列表回来
  await table.getByRole('button', { name: '清除筛选' }).click();
  await expect(page).toHaveURL(
    (url) => !url.searchParams.has('status') && !url.searchParams.has('source'),
  );
  await expect(rows.filter({ hasText: 'James Walker' })).toHaveCount(1);
  await expect(filters.getByRole('button', { name: '状态', exact: true })).toBeVisible();
});

test('从地址栏直接打开带筛选与报表下钻参数的 P04：还原筛选芯片、「来自报表」芯片与计数行；移除芯片只去掉下钻', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await waitForSamples(page);
  const days = await replayShiftDays(page);
  // 示例数据的 09-10（平移后）
  const day = beijingDate(Date.parse('2026-09-10T12:00:00+08:00') + days * DAY);
  const thisYear = beijingDate(Date.now()).slice(0, 4);
  const dayWords = day.startsWith(thisYear) ? day.slice(5) : day;
  const query = `drill=triggered&drillFrom=${day}&origin=daily-bar`;
  const expected = await apiTickets(page, query);
  expect(expected.total).toBeGreaterThan(0);

  await page.goto(`/tickets?${query}&channel=amazon`);
  const filters = page.getByTestId('ticket-filters');
  await expect(page.getByTestId('drill-chip')).toHaveText(
    `来自报表：${dayWords} 新建或重开 · 客户来信`,
  );
  await expect(filters.getByRole('button', { name: /^渠道：\s*亚马逊$/ })).toBeVisible();
  await expect(filters.getByRole('button', { name: /^最近来信：\s*近 30 天$/ })).toBeVisible();
  const amazon = await apiTickets(page, `${query}&channel=amazon`);
  const count = page.getByTestId('drill-count');
  await expect(count).toContainText(`共 ${amazon.total} 条`);
  await expect(count).toContainText(
    `条件与报表「每日工单量」${dayWords} 的柱同口径：客户来信触发的新建或重开 ${dayWords}`,
  );
  await expect(page.getByTestId('ticket-row')).toHaveCount(amazon.total);

  // 移除渠道：数量回到与报表同口径的条数
  await filters.getByRole('button', { name: /^渠道：\s*亚马逊$/ }).click();
  await page.getByRole('option', { name: '全部' }).click();
  await expect(count).toContainText(`共 ${expected.total} 条`);
  await expect(page.getByTestId('ticket-row')).toHaveCount(expected.total);

  // × 移除「来自报表」：只去掉下钻条件，计数行消失
  await page.getByRole('button', { name: '移除这条筛选' }).click();
  await expect(page).toHaveURL((url) => !url.searchParams.has('drill'));
  await expect(page.getByTestId('drill-chip')).toHaveCount(0);
  await expect(count).toHaveCount(0);
});

test('表头排序写进地址栏；点一行进入 P05', async ({ page }) => {
  await loginAs(page, '李婷');
  await waitForSamples(page);
  const table = page.getByRole('table', { name: '工单列表' });
  await table.getByRole('button', { name: /^最近来信\s*↕$/ }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('sort') === 'last_inbound' && url.searchParams.get('dir') === 'desc',
  );
  await expect(table.getByRole('columnheader', { name: /^最近来信/ })).toHaveText('最近来信↓');
  await expect(table.getByRole('columnheader', { name: /^SLA 剩余/ })).toHaveText('SLA 剩余↕');
  const latest = (await apiTickets(page, 'sort=last_inbound')).tickets;
  await expect(table.getByTestId('ticket-row').first()).toContainText(latest[0]!.number);

  // 点主题所在的格（不是工单号链接）也进入 P05
  const james = table.getByTestId('ticket-row').filter({ hasText: 'James Walker' });
  const number = (await james.getByRole('link').textContent())!;
  await james.getByText('Box arrived crushed, the vacuum is cracked').click();
  await expect(page).toHaveURL((url) => url.pathname === `/tickets/${number}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Box arrived crushed, the vacuum is cracked',
  );
});

test('数据变化时自动刷新：在 P04 开着时别处标记无需回复 → 这一行转「已解决」→ 撤销后回到「待回复」，都不用重新加载', async ({
  page,
}) => {
  await loginAs(page, '李婷');
  await waitForSamples(page);
  const james = (await apiTickets(page)).tickets.find((t) => t.customer.name === 'James Walker')!;
  test.skip(james.status !== 'awaiting_reply', '示例工单已按时关闭，先重放来信再跑');
  const detail = ticketDetailSchema.parse(
    await (await page.request.get(`/api/tickets/${james.number}`)).json(),
  );
  const letter = detail.messages.find((m) => m.direction === 'inbound' && m.noReply === null)!;
  const row = page.getByTestId('ticket-row').filter({ hasText: 'James Walker' });
  await expect(row).toContainText('待回复');
  const path = `/api/tickets/${james.number}/messages/${letter.id}`;
  let undone = false;
  try {
    expect((await page.request.post(`${path}/no-reply`, { data: {} })).ok()).toBe(true);
    await expect(row).toContainText('已解决', { timeout: 4_000 });
    await expect(row.getByTestId('ticket-sla')).toHaveText('—');
  } finally {
    // 5 秒内撤销，开发测试环境不留下被标记的来信
    undone = (await page.request.post(`${path}/undo-no-reply`, { data: {} })).ok();
  }
  expect(undone).toBe(true);
  await expect(row).toContainText('待回复');
  await expect(row.getByTestId('ticket-sla')).toHaveText(/^已超时 /);
});
