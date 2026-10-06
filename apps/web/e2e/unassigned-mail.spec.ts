import {
  unassignedMailListSchema,
  type StoreOption,
  type UnassignedMailList,
} from '@forcome/contracts';
import { expect, test, type Page, type Route } from '@playwright/test';

/*
 * 未归属店铺来信队列与指定店铺（待办 15；PRD P04「第一阶段」、I17 与补充小样③–⑥，协调者 2026-10-07 决定）：
 * worker 启动时 Fake Gmail 回放示例数据里的两封未归属来信（Tom Harris 寄到 amz-ca2@forcome.com、Lucía Herrera 寄到
 * info@forcome.mx，都没登记在店铺），周敏（客服主管）在 P04 打开「未归属店铺 N」看到它们。
 * 开发测试环境长期运行，用例要能重复执行：真的指定会让这封信离开队列，所以「撤销」走真实接口（撤销窗口内什么都不提交），
 * 窗口结束后的提交与两种失败用接口桩（按 contracts 的模式解析真实响应，只拿掉被指定的那封），不去改长期运行的数据。
 */

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

const entry = (page: Page) => page.getByRole('button', { name: /^未归属店铺/ });
const queue = (page: Page) => page.getByRole('region', { name: '未归属店铺' });
const row = (page: Page, customer: string) =>
  page.getByTestId('unassigned-row').filter({ hasText: customer });

/** 打开 P04 的队列；worker 刚启动时可能还没把回放的来信同步进来，重新加载直到看到 */
async function openQueue(page: Page): Promise<void> {
  await page.goto('/tickets');
  await expect(async () => {
    await page.reload();
    await expect(entry(page)).toBeVisible();
    await entry(page).click();
    await expect(row(page, 'Lucía Herrera')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

async function pick(page: Page, customer: string, store: string): Promise<void> {
  await row(page, customer).getByRole('combobox').click();
  await page.getByRole('option', { name: store, exact: true }).click();
}

/** 队列的接口桩：取真实响应，拿掉 without 里的来信（「指定」提交成功后真实的样子） */
async function stubQueue(page: Page, without: () => readonly string[]): Promise<void> {
  await page.route('**/api/channel/unassigned-mail', async (route) => {
    const real = unassignedMailListSchema.parse(await (await route.fetch()).json());
    const gone = new Set(without());
    const body: UnassignedMailList = {
      ...real,
      mails: real.mails.filter((m) => !gone.has(m.customer.name)),
    };
    await route.fulfill({ json: body });
  });
}

async function storeOptions(page: Page): Promise<StoreOption[]> {
  const res = await page.request.get('/api/channel/store-options');
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { stores: StoreOption[] }).stores;
}

test('客服主管打开「未归属店铺 N」：入口为选中态、地址栏带 view，列为来信 · 识别依据 · 到达 · SLA · 指定店铺（I17 ①③）', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await openQueue(page);

  await expect(page).toHaveURL((url) => url.searchParams.get('view') === 'unassigned');
  await expect(entry(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('仅客服主管可见', { exact: true })).toBeVisible();
  await expect(queue(page).getByRole('heading', { name: '未归属店铺' })).toBeVisible();
  await expect(queue(page)).toContainText('仅客服主管可见 · 不受店铺数据范围限制');
  await expect(queue(page).getByRole('alert')).toContainText(/\d+ 封来信识别不出店铺/);
  await expect(queue(page).getByRole('alert')).toContainText(
    'SLA 按原到达时间照常计时 · 管理员登记新店铺后，收件地址匹配的来信会自动归位',
  );
  await expect(queue(page).getByRole('columnheader')).toHaveText([
    '来信',
    '识别依据',
    '到达',
    'SLA',
    '指定店铺（只列你的授权店铺）',
  ]);

  const tom = row(page, 'Tom Harris');
  await expect(tom).toContainText('Where is my order? Tracking says delivered.');
  await expect(tom).toContainText('Delivered-To');
  await expect(tom).toContainText('amz-ca2@forcome.com');
  await expect(tom).toContainText('未登记');
  await expect(tom).toContainText('发件域 marketplace.amazon.ca');
  await expect(tom).toContainText('10:02');
  await expect(tom).toContainText('亚马逊 24 小时');
  const lucia = row(page, 'Lucía Herrera');
  await expect(lucia).toContainText('To');
  await expect(lucia).toContainText('info@forcome.mx');
  await expect(lucia).toContainText('发件域 gmail.com');
  await expect(lucia).toContainText('09:47');
  await expect(lucia).toContainText('内部目标 24 小时');
  await expect(lucia.getByTestId('sla-badge')).toContainText('· 内部');

  // 下拉未预选，只列周敏的授权店铺；没选店铺时「指定」置灰，悬停写原因
  await expect(lucia.getByRole('combobox')).toHaveText('选择店铺');
  await expect(lucia.getByRole('button', { name: '指定' })).toBeDisabled();
  await lucia.getByRole('button', { name: '指定' }).hover({ force: true });
  await expect(page.getByRole('tooltip', { name: '先选择店铺' })).toBeVisible();
  await lucia.getByRole('combobox').click();
  const names = (await storeOptions(page)).map((s) => s.name);
  await expect(page.getByRole('option')).toHaveText(names);
  await page.keyboard.press('Escape');

  // 再点入口回到工单列表
  await entry(page).click();
  await expect(page).toHaveURL((url) => !url.searchParams.has('view'));
  await expect(entry(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('table', { name: '工单列表' })).toBeVisible();
});

test('坐席看不到入口，地址栏带 view 也照常是工单列表', async ({ page }) => {
  await loginAs(page, '李婷');
  await page.goto('/tickets?view=unassigned');
  await expect(page.getByRole('table', { name: '工单列表' })).toBeVisible();
  await expect(entry(page)).toHaveCount(0);
  await expect(page.getByText('仅客服主管可见')).toHaveCount(0);
});

test('指定后 5 秒内撤销：行移出、撤销浮层倒计时；撤销后回到队列，什么都不提交（AC-P1-15、I17 ②）', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await openQueue(page);
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/channel/unassigned-mail/')) {
      posts.push(request.url());
    }
  });
  await page.clock.install();
  const before = await row(page, '').count();

  await pick(page, 'Lucía Herrera', 'forcome.mx');
  await row(page, 'Lucía Herrera').getByRole('button', { name: '指定' }).click();
  await expect(row(page, 'Lucía Herrera')).toHaveCount(0);
  await expect(entry(page).getByTestId('unassigned-count')).toHaveText(String(before - 1));
  const toast = page.getByText('已归入 forcome.mx').locator('..').locator('..');
  await expect(page.getByText('已归入 forcome.mx')).toBeVisible();
  await expect(page.getByText('5 秒后归并成工单')).toBeVisible();
  await expect(toast).toContainText('5s');
  await page.clock.runFor(2_000);
  await expect(toast).toContainText('3s');

  await page.getByRole('button', { name: '撤销' }).click();
  await expect(row(page, 'Lucía Herrera')).toBeVisible();
  await expect(page.getByText('已归入 forcome.mx')).toBeHidden();
  await page.clock.runFor(10_000);
  expect(posts).toEqual([]);
  await expect(row(page, 'Lucía Herrera')).toBeVisible();
});

test('不撤销：窗口结束才提交（带所选店铺），行随刷新移出，入口计数减一（AC-P1-15、AC-TK-11）', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await openQueue(page);
  const mx = (await storeOptions(page)).find((s) => s.name === 'forcome.mx')!;
  const assigned: string[] = [];
  const bodies: unknown[] = [];
  await stubQueue(page, () => assigned);
  await page.route('**/api/channel/unassigned-mail/*/store', async (route: Route) => {
    bodies.push(route.request().postDataJSON());
    assigned.push('Lucía Herrera');
    const id = /unassigned-mail\/([^/]+)\/store/.exec(route.request().url())![1]!;
    await route.fulfill({ json: { id, store: { id: mx.id, name: mx.name } } });
  });
  await page.clock.install();
  const before = await row(page, '').count();

  await pick(page, 'Lucía Herrera', 'forcome.mx');
  await row(page, 'Lucía Herrera').getByRole('button', { name: '指定' }).click();
  await page.clock.runFor(4_500);
  expect(bodies).toEqual([]);
  await page.clock.runFor(1_000);
  await expect.poll(() => bodies).toEqual([{ storeId: mx.id }]);
  await expect(page.getByText('已归入 forcome.mx')).toBeHidden();
  await expect(entry(page).getByTestId('unassigned-count')).toHaveText(String(before - 1));
  await expect(row(page, 'Lucía Herrera')).toHaveCount(0);
  await expect(row(page, 'Tom Harris')).toBeVisible();
});

test('窗口结束提交时断网：行回到队列，失败浮层「来信仍在未归属店铺队列里」可重试（I17 ⑤）', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await openQueue(page);
  let online = false;
  const assigned: string[] = [];
  await stubQueue(page, () => assigned);
  await page.route('**/api/channel/unassigned-mail/*/store', async (route) => {
    if (!online) return route.abort('internetdisconnected');
    assigned.push('Tom Harris');
    const id = /unassigned-mail\/([^/]+)\/store/.exec(route.request().url())![1]!;
    const direct = (await storeOptions(page)).find((s) => s.name === 'Forcome Direct')!;
    return route.fulfill({ json: { id, store: { id: direct.id, name: direct.name } } });
  });
  await page.clock.install();

  await pick(page, 'Tom Harris', 'Forcome Direct');
  await row(page, 'Tom Harris').getByRole('button', { name: '指定' }).click();
  await expect(row(page, 'Tom Harris')).toHaveCount(0);
  await page.clock.runFor(5_500);
  await expect(page.getByText('指定店铺失败：网络不可用')).toBeVisible();
  await expect(page.getByText('来信仍在未归属店铺队列里')).toBeVisible();
  // 开始提交时撤销浮层已撤掉：不留一个撤销不了的「撤销」
  await expect(page.getByRole('button', { name: '撤销' })).toHaveCount(0);
  await expect(row(page, 'Tom Harris')).toBeVisible();

  online = true;
  await page.getByRole('button', { name: '立即重试' }).click();
  await expect(page.getByText('指定店铺失败：网络不可用')).toBeHidden();
  await expect(row(page, 'Tom Harris')).toHaveCount(0);
});

test('店铺范围外（403）：浮层写仍在队列里、不带重试（重试也不会成功），行回到队列', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await openQueue(page);
  await page.route('**/api/channel/unassigned-mail/*/store', (route) =>
    route.fulfill({
      status: 403,
      json: { error: 'forbidden', message: '这条数据不在你的店铺范围内' },
    }),
  );
  await page.clock.install();
  await pick(page, 'Tom Harris', 'Forcome Direct');
  await row(page, 'Tom Harris').getByRole('button', { name: '指定' }).click();
  await page.clock.runFor(5_500);
  await expect(page.getByText('指定店铺失败：这条数据不在你的店铺范围内')).toBeVisible();
  await expect(page.getByText('来信仍在未归属店铺队列里')).toBeVisible();
  await expect(page.getByRole('button', { name: '立即重试' })).toHaveCount(0);
  await expect(row(page, 'Tom Harris')).toBeVisible();
});

test('撤销窗口内退出登录：还没提交的指定一律撤销，不拿下一位成员的会话提交', async ({ page }) => {
  await loginAs(page, '周敏');
  await openQueue(page);
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/channel/unassigned-mail/')) {
      posts.push(request.url());
    }
  });
  await page.clock.install();
  await pick(page, 'Lucía Herrera', 'forcome.mx');
  await row(page, 'Lucía Herrera').getByRole('button', { name: '指定' }).click();
  await expect(page.getByText('已归入 forcome.mx')).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: /周敏/ }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/dev-login|login/);
  await page.clock.runFor(10_000);
  expect(posts).toEqual([]);
});

test('撤销窗口内另一个标签页换人登录：到点时不是点「指定」的那位成员，不提交', async ({ page }) => {
  await loginAs(page, '周敏');
  await openQueue(page);
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/channel/unassigned-mail/')) {
      posts.push(request.url());
    }
  });
  await page.clock.install();
  await pick(page, 'Lucía Herrera', 'forcome.mx');
  await row(page, 'Lucía Herrera').getByRole('button', { name: '指定' }).click();
  // 同一浏览器的另一个标签页（会话 Cookie 共用）以王磊登录
  const other = await page.context().newPage();
  await loginAs(other, '王磊');
  await other.close();
  await page.clock.runFor(6_000);
  await expect(row(page, 'Lucía Herrera')).toBeVisible();
  expect(posts).toEqual([]);
});

test('提交时别人已先指定：失败浮层写已归入的店铺、不带重试，行随刷新移出（I17 ⑥）', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await openQueue(page);
  const assigned: string[] = [];
  await stubQueue(page, () => assigned);
  await page.route('**/api/channel/unassigned-mail/*/store', async (route) => {
    assigned.push('Lucía Herrera');
    await route.fulfill({
      status: 409,
      json: { error: 'not_in_queue', message: '已归入 forcome.mx' },
    });
  });
  await page.clock.install();

  await pick(page, 'Lucía Herrera', 'forcome.com');
  await row(page, 'Lucía Herrera').getByRole('button', { name: '指定' }).click();
  await page.clock.runFor(5_500);
  await expect(page.getByText('指定店铺失败：这封来信已被指定或已自动归位')).toBeVisible();
  await expect(page.getByText('已归入 forcome.mx', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '立即重试' })).toHaveCount(0);
  await expect(row(page, 'Lucía Herrera')).toHaveCount(0);
});

test('队列为空：入口计数 0 为中性色，没有提示条，表体为空状态（I17 ④）', async ({ page }) => {
  await loginAs(page, '周敏');
  await page.route('**/api/channel/unassigned-mail', async (route) => {
    const real = unassignedMailListSchema.parse(await (await route.fetch()).json());
    await route.fulfill({ json: { ...real, mails: [] } satisfies UnassignedMailList });
  });
  await page.goto('/tickets');
  await expect(entry(page).getByTestId('unassigned-count')).toHaveText('0');
  const neutral = await entry(page)
    .getByTestId('unassigned-count')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await entry(page).click();
  await expect(queue(page).getByText('没有识别不出店铺的来信')).toBeVisible();
  await expect(queue(page).getByRole('alert')).toHaveCount(0);
  await expect(queue(page).getByTestId('unassigned-count')).toHaveText('0');

  // 有待处理时计数用提醒色，与 0 的中性色不同
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.reload();
  await expect(entry(page).getByTestId('unassigned-count')).not.toHaveText('0');
  const warning = await entry(page)
    .getByTestId('unassigned-count')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(warning).not.toBe(neutral);
});

test('站内通知「未归属店铺来信」点进来直接打开队列', async ({ page }) => {
  await loginAs(page, '周敏');
  await page.goto('/aftersales/ledger');
  await page
    .getByRole('banner')
    .getByRole('button', { name: /站内通知/ })
    .click();
  const item = page.getByTestId('notification-item').filter({ hasText: '未归属店铺来信' }).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(
    (url) => url.pathname === '/tickets' && url.searchParams.get('view') === 'unassigned',
  );
  await expect(queue(page)).toBeVisible();
});
