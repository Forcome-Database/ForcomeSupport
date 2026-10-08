import { expect, test, type Page } from '@playwright/test';

/*
 * 来信到工单（待办 08）：worker 启动时 Fake Gmail 从示例数据夹具回放来信（邮箱开始监听后送达），
 * 经 Pub/Sub 拉取、同步入库、归并成「待回复」工单；坐席在 P04 看到它们（最简列表）。
 * 来源、渠道与站点按待办 10 识别：亚马逊按买家消息中转域定站点，Shopify 联系表单通知为 Shopify，生产厂来信标徽标。
 * 按订单归并（待办 14）：来信里的订单号在该店铺校验后关联，订单号列显示亚马逊订单号或 Shopify 订单名，没有关联订单写「—」；
 * 同一客户两笔订单的来信分成两张（Priya Raman 的 #1057、#1049）。
 * 08 还没有自动刷新（SSE 随 18），刚启动时 worker 可能还没归并完，所以重新加载直到看到工单。
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

/** 示例数据平移的天数：接口给出的 James Walker 最近来信与夹具之差 */
async function replayShiftDays(page: Page): Promise<number> {
  const res = await page.request.get('/api/tickets');
  expect(res.ok()).toBe(true);
  const { tickets } = (await res.json()) as {
    tickets: { customer: { name: string }; lastInboundAt: string }[];
  };
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
    '最近来信',
  ]);

  // 几个邮箱各自同步，要核对的几行都出现了才往下看
  const rowOf = (customer: string) => table.getByTestId('ticket-row').filter({ hasText: customer });
  await expect(async () => {
    await page.reload();
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
