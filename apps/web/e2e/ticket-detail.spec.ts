import {
  noReplyMessages,
  storeOptionsSchema,
  ticketDetailSchema,
  ticketListSchema,
  type TicketDetail,
  type TicketListItem,
} from '@forcome/contracts';
import { expect, test, type Page } from '@playwright/test';

/*
 * P05 工单详情与标记无需回复（待办 17；PRD P05「第一阶段」、I18 与补充小样③–⑧）：
 * worker 启动时 Fake Gmail 回放示例来信与我方回复，Oliver Grant 的致谢来信、Valeria Ríos 的来信归并后由李婷按示例时刻
 * 标记无需回复（示例回放，非生产环境）。P04 点击行进 P05 随待办 18，这里按工单号直接打开。
 * 开发测试环境长期运行，用例要能重复执行：真的「标记无需回复」只做在待回复的 James Walker 上，并在 5 秒内撤销，状态回到待回复
 * （事件行是历史，每跑一次多两行）；失败浮层、G2 用接口桩（按 contracts 的模式解析真实响应）。
 * 示例邮件按整天平移到回放当天（时分不变），平移天数从接口读；不重放来信时数据一天天变旧，状态按时限比出来。
 */

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const DAY = 86_400_000;
/** 夹具里 James Walker 的最近来信（演示数据的 09-10 08:15） */
const JAMES_FIXTURE_LAST_IN = Date.parse('2026-09-10T08:15:00+08:00');
/** Oliver Grant 的致谢来信（被标记无需回复、工单已解决，7 天无来信自动关闭） */
const OLIVER_FIXTURE_LAST_IN = Date.parse('2026-09-10T09:00:00+08:00');

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

/**
 * 某位客户的工单；worker 刚启动时可能还没回放、归并完（几天的邮件在几秒内处理，标记在第三封归并之后），
 * 等到它出现并满足 ready
 */
async function ticketOf(
  page: Page,
  customer: string,
  ready: (ticket: TicketListItem) => boolean = () => true,
): Promise<TicketListItem> {
  let found: TicketListItem | undefined;
  await expect(async () => {
    const res = await page.request.get('/api/tickets');
    expect(res.ok()).toBe(true);
    const { tickets } = ticketListSchema.parse(await res.json());
    found = tickets.find((ticket) => ticket.customer.name === customer);
    expect(found && ready(found)).toBe(true);
  }).toPass({ timeout: 60_000 });
  return found!;
}

/** 示例数据平移的天数：James Walker 的最近来信与夹具之差 */
async function replayShiftDays(page: Page): Promise<number> {
  const james = await ticketOf(page, 'James Walker');
  return Math.round((Date.parse(james.lastInboundAt) - JAMES_FIXTURE_LAST_IN) / DAY);
}

const timeline = (page: Page) => page.getByTestId('timeline');
const inboundCards = (page: Page) => timeline(page).getByTestId('timeline-inbound');
const eventRows = (page: Page) => timeline(page).getByTestId('timeline-event');
const head = (page: Page) => page.getByTestId('ticket-meta');
const markButton = (page: Page) => page.getByRole('button', { name: '标记无需回复' });

async function openDetail(page: Page, number: string): Promise<void> {
  await page.goto(`/tickets/${number}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test('坐席打开 Oliver Grant 的工单：全程记录、工单信息、订单、SLA 结果与状态流转（I18 ①）', async ({
  page,
}) => {
  await loginAs(page, '李婷');
  const days = await replayShiftDays(page);
  // 第三封（致谢）归并、标记之后：最近来信是它，状态已解决（数据变旧时已关闭）
  const oliver = await ticketOf(
    page,
    'Oliver Grant',
    (ticket) =>
      Date.parse(ticket.lastInboundAt) === OLIVER_FIXTURE_LAST_IN + days * DAY &&
      ticket.status !== 'awaiting_reply',
  );
  await openDetail(page, oliver.number);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Charger cable not working');
  // 已解决 7 天无来信自动关闭；数据变旧时已按时关闭
  const resolvedUntil = OLIVER_FIXTURE_LAST_IN + (days + 7) * DAY;
  const closed = Date.now() >= resolvedUntil;
  await expect(head(page)).toContainText(oliver.number);
  await expect(head(page)).toContainText('客户 Oliver Grant');
  await expect(head(page)).toContainText('订单 204-5566778-9900112');
  if (Date.now() < resolvedUntil - 2 * 60_000) {
    await expect(head(page)).toContainText(
      /已解决 · 7 天无来信将于 \d{2}-\d{2} 09:00 自动关闭（已解决后无来信）/,
    );
  }
  // 客户名不是链接，标题区没有第一期不存在的按钮
  await expect(page.getByRole('link', { name: 'Oliver Grant' })).toHaveCount(0);
  for (const name of ['重新打开', '合并', '内部备注', '导出记录']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }

  // 全程记录：三封来信（亚马逊买家消息）、两封我方回复（经亚马逊买家消息）；第三封被李婷标记
  await expect(inboundCards(page)).toHaveCount(3);
  await expect(inboundCards(page).first()).toContainText(/亚马逊买家消息 · 10:12/);
  await expect(inboundCards(page).first()).toContainText("Hi, the charger cable doesn't work.");
  await expect(inboundCards(page).first()).not.toContainText('Order');
  const outbound = timeline(page).getByTestId('timeline-outbound');
  await expect(outbound).toHaveCount(2);
  await expect(outbound.first()).toContainText(
    '我方amz-direct@forcome.com · 经亚马逊买家消息 · 10:40',
  );
  await expect(inboundCards(page).nth(2)).toContainText('Thanks, the new cable works!');
  await expect(inboundCards(page).nth(2).getByTestId('no-reply-mark')).toHaveText(
    '无需回复 · 李婷 · 09:05',
  );
  // 已解决的工单没有未回复来信，没有「标记无需回复」
  await expect(markButton(page)).toHaveCount(0);
  await expect(timeline(page).getByTestId('day-separator').first()).toHaveText(
    /^\d{2}-\d{2} 周[一二三四五六日]$/,
  );
  await expect(eventRows(page).first()).toContainText('系统新建工单，状态「待回复」');
  await expect(eventRows(page)).toContainText([
    '识别到我方回复，转「等客户」',
    '新来信，回到「待回复」',
    '李婷标记无需回复，转「已解决」',
  ]);

  // 分段筛选：仅消息没有事件行，仅事件没有消息卡
  await page.getByRole('radio', { name: '仅消息' }).click();
  await expect(eventRows(page)).toHaveCount(0);
  await expect(inboundCards(page)).toHaveCount(3);
  await page.getByRole('radio', { name: '仅事件' }).click();
  await expect(inboundCards(page)).toHaveCount(0);
  await expect(eventRows(page).first()).toBeVisible();
  await page.getByRole('radio', { name: '全部' }).click();
  await expect(inboundCards(page)).toHaveCount(3);

  const info = page.getByTestId('ticket-info');
  for (const text of [
    '店铺Forcome Direct',
    '站点CA',
    '渠道亚马逊',
    '来源客户',
    '进线邮箱amz-direct@forcome.com',
    '订单号204-5566778-9900112',
  ]) {
    await expect(info).toContainText(text);
  }

  const order = page.getByTestId('ticket-order-card');
  await expect(order).toContainText(/平台镜像 · 最近同步 /);
  for (const text of [
    '已发货',
    '更新于 08-26',
    '车载吸尘器 V2 黑色 ×1',
    'CA$67.99（≈ $49.99）',
    '履约方式MFN（自发货）',
    '承诺送达08-27',
    'Toronto, ON, CA',
    'Canada Post 7316204855219087',
  ]) {
    await expect(order).toContainText(text);
  }

  const sla = page.getByTestId('ticket-sla');
  await expect(sla).toContainText('亚马逊 24 小时');
  await expect(sla.getByTestId('sla-line')).toHaveText([
    /10:12 来信首次回复 28m达标$/,
    /08:58 来信首次回复 6h 32m达标$/,
    /09:00 来信无需回复 · 李婷不计$/,
  ]);

  const flow = page.getByTestId('ticket-flow').getByTestId('flow-step');
  // 六步迁移 + 预计关闭（数据变旧时为实际关闭）
  await expect(flow).toHaveCount(7);
  await expect(flow.first()).toContainText('待回复系统 · 新建');
  await expect(flow.nth(5)).toContainText('已解决李婷 · 标记无需回复');
  await expect(flow.last()).toContainText(
    closed ? '已关闭系统 · 7 天无来信（已解决后无来信）' : /已关闭已解决后无来信预计 /,
  );
});

test('坐席标记无需回复 → 工单转已解决 → 5 秒内撤销，回到待回复（AC-P1-01）', async ({ page }) => {
  await loginAs(page, '李婷');
  const james = await ticketOf(page, 'James Walker');
  test.skip(
    james.status !== 'awaiting_reply',
    '示例工单已按时关闭（14 天没有重放来信），先重放来信再跑',
  );
  await openDetail(page, james.number);
  const card = inboundCards(page).filter({ hasText: 'James Walker' }).last();
  await expect(head(page)).toContainText('14 天无新来信将于');
  await expect(page.getByRole('heading', { level: 1 }).locator('..')).toContainText('待回复');

  await card.getByRole('button', { name: '标记无需回复' }).click();
  await expect(page.getByText('已标记无需回复 · 工单转已解决')).toBeVisible();
  // 撤销窗口只有 5 秒：中间的核对用 soft，失败了也照样撤销（开发测试环境长期运行，不能留下被标记的 James）。
  // 标记与来信不在同一天时写日期（「无需回复 · 李婷 · 09-10 09:05」）
  const soft = { timeout: 1_500 };
  await expect
    .soft(card.getByTestId('no-reply-mark'), '卡上写标记人与时刻')
    .toHaveText(/^无需回复 · 李婷 · (\d{2}-\d{2} )?\d{2}:\d{2}$/, soft);
  await expect
    .soft(page.getByRole('heading', { level: 1 }).locator('..'), '工单转已解决')
    .toContainText('已解决', soft);
  await expect
    .soft(eventRows(page).last(), '事件行')
    .toContainText('李婷标记无需回复，转「已解决」', soft);
  await expect
    .soft(page.getByTestId('ticket-sla').getByTestId('sla-line').last(), 'SLA 不计')
    .toContainText('无需回复 · 李婷不计', soft);

  await page.getByRole('button', { name: '撤销' }).click();
  await expect(card.getByRole('button', { name: '标记无需回复' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).locator('..')).toContainText('待回复');
  // 撤销不删原来那行，再追加一行
  await expect(eventRows(page).last()).toContainText('李婷撤销标记无需回复，回到「待回复」');
  await expect(eventRows(page).nth(-2)).toContainText('李婷标记无需回复，转「已解决」');
  await expect(page.getByTestId('ticket-flow')).toContainText('李婷 · 撤销标记无需回复');
  // 真实接口：回到待回复
  const res = await page.request.get(`/api/tickets/${james.number}`);
  expect(ticketDetailSchema.parse(await res.json()).ticket.status).toBe('awaiting_reply');
});

test('标记失败：断网可立即重试（这封来信仍未标记）；已被别人标记（409）不重试、刷新为最新', async ({
  page,
}) => {
  await loginAs(page, '李婷');
  const james = await ticketOf(page, 'James Walker');
  test.skip(james.status !== 'awaiting_reply', '示例工单已按时关闭，先重放来信再跑');
  await openDetail(page, james.number);

  await page.route('**/api/tickets/*/messages/*/no-reply', (route) =>
    route.abort('internetdisconnected'),
  );
  await markButton(page).first().click();
  await expect(page.getByText('标记无需回复失败：网络不可用')).toBeVisible();
  await expect(page.getByText('这封来信仍未标记')).toBeVisible();
  await expect(page.getByRole('button', { name: '立即重试' })).toBeVisible();
  await expect(markButton(page).first()).toBeVisible();

  await page.unroute('**/api/tickets/*/messages/*/no-reply');
  await page.route('**/api/tickets/*/messages/*/no-reply', (route) =>
    route.fulfill({
      status: 409,
      json: { error: 'conflict', message: noReplyMessages.marked('陈晨') },
    }),
  );
  let refetched = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url().endsWith(`/api/tickets/${james.number}`)) {
      refetched += 1;
    }
  });
  await page.getByRole('button', { name: '立即重试' }).click();
  await expect(page.getByText('标记无需回复失败：这封来信已被陈晨标记无需回复')).toBeVisible();
  await expect(page.getByText('已刷新为最新内容。')).toBeVisible();
  await expect(page.getByRole('button', { name: '立即重试' })).toHaveCount(0);
  await expect.poll(() => refetched).toBeGreaterThan(0);
});

test('撤销超时被拒：不重试，保持无需回复并刷新为最新（I18 补充小样⑦）', async ({ page }) => {
  await loginAs(page, '李婷');
  const james = await ticketOf(page, 'James Walker');
  test.skip(james.status !== 'awaiting_reply', '示例工单已按时关闭，先重放来信再跑');
  // 都用接口桩，不改开发测试环境的数据：标记取真实详情改成「李婷刚标记、工单已解决」，撤销返回 400 已超过时限
  await page.route('**/api/tickets/*/messages/*/no-reply', async (route) => {
    const real = ticketDetailSchema.parse(
      await (await page.request.get(`/api/tickets/${james.number}`)).json(),
    );
    const messageId = /messages\/([^/]+)\/no-reply/.exec(route.request().url())![1]!;
    const at = new Date().toISOString();
    const marked: TicketDetail = {
      ...real,
      ticket: { ...real.ticket, status: 'resolved' },
      messages: real.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              noReply: { by: '李婷', at },
              sla: m.sla && { ...m.sla, result: 'not_required' },
            }
          : m,
      ),
      events: [
        ...real.events,
        { kind: 'no_reply', at, action: 'mark', actorName: '李婷', messageId, to: 'resolved' },
      ],
    };
    await route.fulfill({ json: ticketDetailSchema.parse(marked) });
  });
  await page.route('**/api/tickets/*/messages/*/undo-no-reply', (route) =>
    route.fulfill({
      status: 400,
      json: { error: 'invalid_request', message: noReplyMessages.undoExpired },
    }),
  );
  await openDetail(page, james.number);
  await markButton(page).first().click();
  await expect(page.getByText('已标记无需回复 · 工单转已解决')).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText('撤销失败：已超过撤销时限，这封来信保持无需回复')).toBeVisible();
  await expect(page.getByText('已刷新为最新内容。')).toBeVisible();
  await expect(page.getByRole('button', { name: '立即重试' })).toHaveCount(0);
});

test('知识库负责人看得到详情，没有「标记无需回复」', async ({ page }) => {
  await loginAs(page, '赵倩');
  const james = await ticketOf(page, 'James Walker');
  await openDetail(page, james.number);
  await expect(inboundCards(page).first()).toBeVisible();
  await expect(markButton(page)).toHaveCount(0);
});

test('其他店铺的工单显示 G2（按店铺范围写，只有「返回首页」）', async ({ page }) => {
  await loginAs(page, '李婷');
  const james = await ticketOf(page, 'James Walker');
  // 李婷是全部店铺：用接口桩把她的范围收窄为 Forcome Direct，详情返回 403（真实的越权由集成测试覆盖）
  await page.route('**/api/channel/store-options', async (route) => {
    const real = storeOptionsSchema.parse(await (await route.fetch()).json());
    await route.fulfill({
      json: { stores: real.stores.filter((store) => store.name === 'Forcome Direct') },
    });
  });
  await page.route(`**/api/tickets/${james.number}`, (route) =>
    route.fulfill({
      status: 403,
      json: { error: 'forbidden', message: '这条数据不在你的店铺范围内' },
    }),
  );
  await page.goto(`/tickets/${james.number}`);
  await expect(page.getByText('没有访问权限')).toBeVisible();
  await expect(
    page.getByText(
      `工单 ${james.number} 不在你的店铺范围内。你的店铺范围是 Forcome Direct，如需开通请联系管理员刘洋。`,
    ),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '返回首页' })).toBeVisible();
  await expect(page.getByRole('link', { name: '返回工单列表' })).toHaveCount(0);
});

test('不存在的工单显示 G3，只有「返回工单列表」', async ({ page }) => {
  await loginAs(page, '李婷');
  await page.goto('/tickets/T-20000101-0001');
  await expect(page.getByText('找不到这张工单')).toBeVisible();
  await expect(
    page.getByText('工单 T-20000101-0001 不存在，请检查编号或链接是否完整。'),
  ).toBeVisible();
  await page.getByRole('link', { name: '返回工单列表' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/tickets');
});
