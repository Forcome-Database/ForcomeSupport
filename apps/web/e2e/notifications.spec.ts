import { BACKGROUND_REQUEST_HEADER } from '@forcome/contracts';
import { expect, test, type Locator, type Page } from '@playwright/test';

/*
 * 站内通知（待办 31；全局状态 G10、PRD 11.4）：顶栏铃铛的未读数、360px 面板（全部 · 未读）、点一条跳到对象并标为已读、
 * 打不开目标页的只标为已读、全部已读、空状态、轮询带回新通知、标为已读失败的浮层（G5）。
 * 产生通知的业务（渠道连接、未归属来信等）随后续待办，这里经开发登录环境的「示例通知」接口（POST /api/dev/notifications，
 * 与业务调用方同一个按 11.4 取接收人的写入）发通知。开发测试环境长期运行、通知会累积：每条用例的通知带时间戳，
 * 未读数只核对相对的变化。接口调用在页面里 fetch（与页面同一套证书校验）。
 */

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

const bell = (page: Page) => page.getByRole('banner').getByRole('button', { name: /站内通知/ });
const badge = (page: Page) => page.getByTestId('notification-badge');
const panel = (page: Page) => page.getByRole('dialog', { name: '通知' });
const item = (page: Page, text: string) =>
  panel(page).getByTestId('notification-item').filter({ hasText: text });

/** 刷新页面，取服务端的未读数并等铃铛显示出来，返回它 */
async function reloadUnread(page: Page): Promise<number> {
  await page.reload();
  const unread = await page.evaluate(async () => {
    const res = await fetch('/api/notifications/unread-count');
    return ((await res.json()) as { unread: number }).unread;
  });
  await expect(bell(page)).toHaveAccessibleName(bellName(unread));
  return unread;
}

/** 铃铛的读屏名：有未读时带条数 */
const bellName = (unread: number) => (unread === 0 ? '站内通知' : `站内通知，${unread} 条未读`);

const stamp = () => `E2E${Date.now().toString(36).toUpperCase()}`;

interface Sample {
  readonly type: 'channel_disconnected' | 'dingtalk_sync_failed' | 'unassigned_mail';
  readonly body: string;
  /** 通知的时刻（带时区的 ISO）；不给为服务端当前时间 */
  readonly at?: string;
}

/** 示例通知的标题与对象，照原型 G10 的写法（钉钉同步失败原型没画，按渠道通知的写法） */
const SAMPLES = {
  unassigned_mail: {
    title: '未归属店铺来信',
    object: (body: string) => ({ type: 'message', id: body, label: 'P04 · 未归属店铺' }),
  },
  channel_disconnected: {
    title: 'Gmail 连接异常',
    object: () => ({ type: 'channel', id: 'gmail', label: 'P18 · Gmail' }),
  },
  dingtalk_sync_failed: {
    title: '钉钉同步失败',
    object: () => ({ type: 'channel', id: 'dingtalk', label: 'P18 · 钉钉' }),
  },
} as const;

/**
 * 按 11.4 发一条示例通知：未归属店铺来信 → 客服主管；渠道连接异常 → 管理员、客服主管；钉钉同步失败 → 管理员
 */
async function send(page: Page, sample: Sample): Promise<void> {
  const { title, object } = SAMPLES[sample.type];
  const content = {
    type: sample.type,
    title,
    body: sample.body,
    object: object(sample.body),
    ...(sample.at ? { at: sample.at } : {}),
  };
  await page.evaluate(async (body) => {
    const res = await fetch('/api/dev/notifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  }, content);
}

async function openPanel(page: Page): Promise<void> {
  await bell(page).click();
  await expect(panel(page)).toBeVisible();
}

const primaryColor = 'rgb(79, 70, 229)';
const objectLabel = (row: Locator, label: string) => row.getByText(label, { exact: true });

test('铃铛未读数 → 打开面板 → 点一条跳到对象并变为已读（G10）', async ({ page }) => {
  await page.clock.install();
  await loginAs(page, '周敏');
  await page.goto('/aftersales/ledger');
  const before = await reloadUnread(page);
  const body = `${stamp()} Harris · amz-ca2@forcome.com 未登记`;

  await send(page, { type: 'unassigned_mail', body });
  // 新通知经 SSE 推送（待办 18）落地前，铃铛 30 秒轮询一次
  await page.clock.fastForward(30_000);
  await expect(badge(page)).toHaveText(String(before + 1));
  await expect(bell(page)).toHaveAccessibleName(bellName(before + 1));

  // 打开面板取列表是人的操作（续期会话）；面板开着时的定时重新拉取是后台请求（ADR 0010 修订）
  const listRequests: (string | null)[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/notifications?view=')) {
      listRequests.push(request.headers()[BACKGROUND_REQUEST_HEADER] ?? null);
    }
  });
  await openPanel(page);
  await expect.poll(() => listRequests).toEqual([null]);
  // 等这次列表取回来再快进：取数还没回来时 TanStack Query 会跳过这一轮定时重新拉取（待办 06 发现的偶发失败）
  await expect(panel(page).getByTestId('notification-item').first()).toContainText(body);
  await page.clock.fastForward(30_000);
  await expect.poll(() => listRequests).toEqual([null, '1']);
  await expect(panel(page).getByRole('tab', { name: '全部' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(panel(page).getByRole('tab', { name: /未读/ })).toHaveText(`未读${before + 1}`);
  const row = item(page, body);
  await expect(panel(page).getByTestId('notification-item').first()).toContainText(body);
  await expect(row).toHaveAttribute('data-read', 'false');
  await expect(row).toContainText('未归属店铺来信');
  await expect(objectLabel(row, 'P04 · 未归属店铺')).toHaveCSS('color', primaryColor);
  await expect(panel(page)).toContainText('点一条即跳到对应对象并标为已读');

  await row.click();
  // 「未归属店铺来信」直接打开 P04 的未归属店铺队列（待办 15）
  await expect(page).toHaveURL(
    (url) => url.pathname === '/tickets' && url.searchParams.get('view') === 'unassigned',
  );
  await expect(panel(page)).toBeHidden();
  await expect(bell(page)).toHaveAccessibleName(bellName(before));

  // 刷新后仍是已读（已提交到服务端）
  await page.reload();
  await openPanel(page);
  await expect(item(page, body)).toHaveAttribute('data-read', 'true');
});

test('管理员点渠道连接异常跳到 P18；客服主管打不开 P18，点了只标为已读、不跳转，对象编号不用主色', async ({
  page,
}) => {
  const body = `${stamp()} support@forcome.mx 连续 3 次失败，来信暂存`;
  await loginAs(page, '刘洋');
  await send(page, { type: 'channel_disconnected', body });
  await page.reload();
  await openPanel(page);
  await expect(objectLabel(item(page, body), 'P18 · Gmail')).toHaveCSS('color', primaryColor);
  await item(page, body).click();
  await expect(page).toHaveURL((url) => url.pathname === '/settings/channels');

  await loginAs(page, '周敏');
  await openPanel(page);
  const row = item(page, body);
  await expect(row).toHaveAttribute('data-read', 'false');
  await expect(objectLabel(row, 'P18 · Gmail')).not.toHaveCSS('color', primaryColor);
  await row.click();
  await expect(row).toHaveAttribute('data-read', 'true');
  await expect(panel(page)).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === '/tickets');
});

/** 北京时间的日期（YYYY-MM-DD）：今天往前 daysAgo 天 */
function beijingDate(daysAgo: number): string {
  const day = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(day);
}

test('时间写法：当天只写「时:分」，前一天的写「月-日 时:分」（G10、PRD v2.22，同 P27）', async ({
  page,
}) => {
  // 用管理员与只发给管理员的钉钉同步失败，在「未读」页签里看：下一条用例的「全部已读」会把它们标掉，
  // 开发测试环境里通知越积越多也不会把这两条挤出最近 50 条
  const tag = stamp();
  const yesterday = beijingDate(1);
  await loginAs(page, '刘洋');
  await send(page, {
    type: 'dingtalk_sync_failed',
    body: `${tag} 前一天 · 连续 3 次失败`,
    at: `${yesterday}T18:12:00+08:00`,
  });
  await send(page, { type: 'dingtalk_sync_failed', body: `${tag} 当天 · 连续 3 次失败` });
  await page.reload();
  await openPanel(page);
  await panel(page).getByRole('tab', { name: /未读/ }).click();

  // 前一天：「月-日 时:分」（跨年时写全年份）
  const sameYear = yesterday.slice(0, 4) === beijingDate(0).slice(0, 4);
  await expect(item(page, `${tag} 前一天`).getByTestId('notification-time')).toHaveText(
    `${sameYear ? yesterday.slice(5) : yesterday} 18:12`,
  );
  // 当天：只写「时:分」
  await expect(item(page, `${tag} 当天`).getByTestId('notification-time')).toHaveText(
    /^\d{2}:\d{2}$/,
  );
});

test('「未读」页签只列未读；全部已读后角标消失、未读页签为空、「全部已读」置灰并悬停说明', async ({
  page,
}) => {
  // 用管理员与只发给管理员的钉钉同步失败：开发测试环境里周敏的示例通知（原型 G10 ①，未读 3）不被每次冒烟的「全部已读」标掉
  const tag = stamp();
  await loginAs(page, '刘洋');
  await send(page, { type: 'dingtalk_sync_failed', body: `${tag} 甲 · 连续 3 次失败` });
  await send(page, { type: 'dingtalk_sync_failed', body: `${tag} 乙 · 连续 3 次失败` });
  expect(await reloadUnread(page)).toBeGreaterThanOrEqual(2);

  await openPanel(page);
  await panel(page).getByRole('tab', { name: /未读/ }).click();
  const rows = panel(page).getByTestId('notification-item');
  await expect(rows.filter({ hasText: tag })).toHaveCount(2);
  await expect(rows.and(page.locator('[data-read="true"]'))).toHaveCount(0);

  await panel(page).getByRole('button', { name: '全部已读' }).click();
  await expect(badge(page)).toHaveCount(0);
  await expect(panel(page).getByRole('tab', { name: /未读/ })).toHaveText('未读0');
  await expect(panel(page)).toContainText('暂无通知');
  await expect(panel(page)).toContainText('渠道异常、未归属店铺来信等需要你知道的事会出现在这里。');
  const markAll = panel(page).getByRole('button', { name: '全部已读' });
  await expect(markAll).toBeDisabled();
  await markAll.locator('..').hover();
  await expect(page.getByRole('tooltip')).toHaveText('没有未读通知');

  await panel(page).getByRole('tab', { name: '全部' }).click();
  await expect(rows.filter({ hasText: tag })).toHaveCount(2);
  await expect(rows.filter({ hasText: tag }).and(page.locator('[data-read="false"]'))).toHaveCount(
    0,
  );
});

test('没有通知的角色：铃铛没有角标，面板是空状态（G10 ②）', async ({ page }) => {
  // 坐席不是第一期任何通知的接收人（11.4）
  await loginAs(page, '李婷');
  expect(await reloadUnread(page)).toBe(0);
  await expect(badge(page)).toHaveCount(0);
  await openPanel(page);
  await expect(panel(page).getByRole('tab', { name: /未读/ })).toHaveText('未读0');
  await expect(panel(page)).toContainText('暂无通知');
  await expect(panel(page)).toContainText('渠道异常、未归属店铺来信等需要你知道的事会出现在这里。');
  await expect(panel(page)).not.toContainText('点一条即跳到对应对象并标为已读');
  await expect(panel(page).getByRole('button', { name: '全部已读' })).toBeDisabled();
});

test('标为已读失败：失败浮层（G5），重试成功后浮层消失、这一条为已读；面板加载失败可重试', async ({
  page,
}) => {
  const body = `${stamp()} Retry · amz-ca2@forcome.com 未登记`;
  await loginAs(page, '周敏');
  await send(page, { type: 'unassigned_mail', body });

  await page.route('**/api/notifications?view=all', (route) =>
    route.fulfill({ status: 500, json: { error: 'internal', message: '服务器内部错误' } }),
  );
  await page.reload();
  await openPanel(page);
  // 查询失败先重试几次（TanStack Query 默认 3 次、间隔递增）才显示加载失败
  await expect(panel(page)).toContainText('加载失败', { timeout: 15_000 });
  await page.unroute('**/api/notifications?view=all');
  await panel(page).getByRole('button', { name: '重试' }).click();
  await expect(item(page, body)).toHaveAttribute('data-read', 'false');

  await page.route('**/api/notifications/*/read', (route) =>
    route.fulfill({ status: 500, json: { error: 'internal', message: '服务器内部错误' } }),
  );
  await item(page, body).click();
  const toast = page.getByText('标为已读失败：服务器内部错误');
  await expect(toast).toBeVisible();
  await page.unroute('**/api/notifications/*/read');
  await page.getByRole('button', { name: '立即重试' }).click();
  await expect(toast).toBeHidden();
  await openPanel(page);
  await expect(item(page, body)).toHaveAttribute('data-read', 'true');
});
