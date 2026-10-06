import {
  channelSettingsSchema,
  type ChannelAlerts,
  type ChannelCard,
  type ChannelIssue,
} from '@forcome/contracts';
import { expect, test, type Page } from '@playwright/test';

/*
 * 渠道连接状态（待办 09、11；PRD 6.9、P18「第一阶段」、K7、K20 补充小样、G4）：
 * - 真实的接口（开发测试环境全部是 Fake，邮箱与 Shopify 订单都在同步）：Gmail、钉钉与 Shopify 卡的「测试连接」与成功浮层；
 * - 卡片的各种异常写法与全站横幅用接口桩（按 contracts 的模式解析真实响应后只改连接状态），不去弄坏长期运行的环境：
 *   Gmail 同步延迟、连接异常（卡底「重新检测」与失败浮层）、几个邮箱同时异常又有延迟、钉钉同步延迟与连接异常（含从没同步成功过）；
 *   Shopify 同步延迟、连接异常（按店铺，卡底「重新检测」与失败浮层，店铺表「Admin API 连接异常」）（待办 11）；
 *   横幅对所有角色显示、「查看渠道状态」只对管理员，恢复后自动消失；Gmail 与 Shopify 同时异常时各一条、Gmail 在上。
 * 时刻按北京时间写（playwright.config 的 timezoneId）。
 */

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

const card = (page: Page, kind: ChannelCard['kind']) => page.getByTestId(`channel-card-${kind}`);

const issue = (overrides: Partial<ChannelIssue>): ChannelIssue => ({
  target: 'support@forcome.mx',
  status: 'error',
  lastSuccessAt: '2026-09-11T02:04:00.000Z',
  failingSince: '2026-09-11T02:05:00.000Z',
  failures: 3,
  ...overrides,
});

/** P18 的接口桩：取真实响应，只把 Gmail、钉钉、Shopify 卡换成给定的状态；可另把某店铺的订单连接换成给定的状态 */
async function stubCards(
  page: Page,
  cards: Partial<Record<'gmail' | 'dingtalk' | 'shopify', Partial<ChannelCard>>>,
  storeOrders: Readonly<Record<string, ChannelCard['status']>> = {},
): Promise<void> {
  await page.route('**/api/channel/settings', async (route) => {
    const real = channelSettingsSchema.parse(await (await route.fetch()).json());
    const channels = real.channels.map((c) =>
      c.kind === 'gmail' || c.kind === 'dingtalk' || c.kind === 'shopify'
        ? { ...c, ...cards[c.kind] }
        : c,
    );
    const stores = real.stores.map((s) => {
      const status = storeOrders[s.name];
      return status
        ? {
            ...s,
            connections: s.connections.map((c) => (c.kind === 'orders' ? { ...c, status } : c)),
          }
        : s;
    });
    await route.fulfill({ json: { ...real, channels, stores } });
  });
}

async function stubAlerts(page: Page, alerts: () => ChannelAlerts['alerts']): Promise<void> {
  await page.route('**/api/channel/alerts', (route) =>
    route.fulfill({ json: { alerts: alerts() } satisfies ChannelAlerts }),
  );
}

test('测试连接（K20）：Gmail、钉钉与 Shopify 卡有（亚马逊随 12）；全部可访问时成功浮层写测过的邮箱数、通讯录可访问、店铺数', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  await expect(card(page, 'amazon').getByRole('button', { name: '测试连接' })).toHaveCount(0);
  // 开发测试环境的邮箱都在同步：已连接，副标题写最近同步时刻（刚部署时 worker 开始监听并同步完每个邮箱要几秒，之前为未连接）
  await expect(async () => {
    await page.reload();
    await expect(card(page, 'gmail')).toContainText('已连接', { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(card(page, 'gmail')).toContainText(/最近同步 \d\d:\d\d/);

  await card(page, 'gmail').getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText('连接正常')).toBeVisible();
  await expect(page.getByText(/^Gmail：\d+ 个邮箱均可访问$/)).toBeVisible();

  await card(page, 'dingtalk').getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText('钉钉：通讯录可访问')).toBeVisible();

  // Shopify 订单每分钟同步一次（worker 启动时也一次）：已连接，副标题写最近同步时刻
  await expect(async () => {
    await page.reload();
    await expect(card(page, 'shopify')).toContainText('已连接', { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(card(page, 'shopify')).toContainText(/最近同步 \d\d:\d\d/);
  await card(page, 'shopify').getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText(/^Shopify：\d+ 个店铺均可访问$/)).toBeVisible();
});

test('Shopify 卡同步延迟：每个延迟的店铺一行，其余说明行照常；店铺表「Admin API 同步延迟」（待办 11）', async ({
  page,
}) => {
  await stubCards(
    page,
    {
      shopify: {
        status: 'delayed',
        lastSyncAt: '2026-09-11T02:05:00.000Z',
        issues: [
          issue({
            target: 'forcome.mx',
            status: 'delayed',
            failingSince: null,
            failures: 0,
            lastSuccessAt: '2026-09-11T02:05:00.000Z',
          }),
        ],
      },
    },
    { 'forcome.mx': 'delayed' },
  );
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const shopify = card(page, 'shopify');
  await expect(shopify).toContainText('同步延迟');
  await expect(shopify).toContainText('最近同步 10:05');
  const lines = shopify.getByTestId('channel-card-lines').locator('> div');
  await expect(lines.first()).toHaveText('forcome.mx 10:05 后未同步成功，超过 10 分钟');
  await expect(lines.nth(1)).toHaveText(/^\d+ 个店铺 · 订单经 Admin API 准实时同步$/);
  await expect(shopify.getByRole('button', { name: '重新检测' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'forcome-mx.myshopify.com' })).toContainText(
    'Admin API 同步延迟',
  );
});

test('Shopify 卡连接异常：每个异常的店铺一行原因与恢复指引、订单暂停同步、「重新检测」；访问不了时失败浮层写店铺与怎么查；店铺表「Admin API 连接异常」（待办 11）', async ({
  page,
}) => {
  await stubCards(
    page,
    {
      shopify: {
        status: 'error',
        lastSyncAt: '2026-09-11T02:04:00.000Z',
        issues: [
          issue({ target: 'forcome.com', status: 'delayed', failingSince: null, failures: 0 }),
          issue({ target: 'forcome.mx', failures: 4 }),
        ],
      },
    },
    { 'forcome.mx': 'error' },
  );
  await page.route('**/api/channel/connection-tests/shopify', (route) =>
    route.fulfill({
      status: 502,
      json: { error: 'connection_test_failed', message: 'forcome.mx 无法访问' },
    }),
  );
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const shopify = card(page, 'shopify');
  await expect(shopify).toContainText('连接异常');
  await expect(shopify.getByTestId('channel-card-lines').locator('> div')).toHaveText([
    'forcome.mx 访问失败（10:05 起连续 4 次）：请检查 Admin API 应用凭据与授权范围',
    '该店铺订单暂停同步，恢复后自动补拉；来信经 Gmail 照常收取',
    'forcome.com 10:04 后未同步成功，超过 10 分钟',
  ]);
  // 第一阶段没有「重新授权」与错误日志页
  await expect(shopify.getByRole('button', { name: '重新授权' })).toHaveCount(0);
  await expect(shopify.getByRole('button', { name: '查看错误日志' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'forcome-mx.myshopify.com' })).toContainText(
    'Admin API 连接异常',
  );

  await shopify.getByRole('button', { name: '重新检测' }).click();
  await expect(page.getByText('测试连接失败：forcome.mx 无法访问')).toBeVisible();
  await expect(
    page.getByText('请检查 Admin API 应用凭据与授权范围', { exact: true }),
  ).toBeVisible();
});

test('Gmail 卡同步延迟：每个延迟的邮箱一行，其余说明行照常；钉钉卡同步延迟（K20、Q3）', async ({
  page,
}) => {
  await stubCards(page, {
    gmail: {
      status: 'delayed',
      lastSyncAt: '2026-09-11T02:05:00.000Z',
      issues: [
        issue({
          status: 'delayed',
          failingSince: null,
          failures: 0,
          lastSuccessAt: '2026-09-11T02:05:00.000Z',
        }),
      ],
    },
    dingtalk: { status: 'delayed', lastSyncAt: '2026-09-11T00:00:00.000Z', issues: [] },
  });
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const gmail = card(page, 'gmail');
  await expect(gmail).toContainText('同步延迟');
  await expect(gmail).toContainText('最近同步 10:05');
  await expect(
    gmail.getByText('support@forcome.mx 10:05 后未同步成功，超过 10 分钟'),
  ).toBeVisible();
  await expect(gmail.getByText(/^\d+ 个邮箱：/)).toBeVisible();
  await expect(gmail.getByText('收件与「已发送」：识别到我方回复即转等客户')).toBeVisible();
  await expect(gmail.getByRole('button', { name: '重新检测' })).toHaveCount(0);

  const dingtalk = card(page, 'dingtalk');
  await expect(dingtalk).toContainText('同步延迟');
  await expect(dingtalk.getByText('通讯录 08:00 后未同步成功，超过 2 小时')).toBeVisible();
  await expect(
    dingtalk.getByText('只提醒管理员，不出全站横幅；成员与部门保持上次结果，登录与权限不受影响'),
  ).toBeVisible();
  await expect(dingtalk.getByText('工作通知推送；扫码登录')).toBeVisible();
});

test('Gmail 卡连接异常：原因与恢复指引、来信暂存、「重新检测」；访问不了时失败浮层写哪个邮箱与怎么查（K7、Q2、Q4）', async ({
  page,
}) => {
  await stubCards(page, {
    gmail: { status: 'error', lastSyncAt: '2026-09-11T02:04:00.000Z', issues: [issue({})] },
  });
  await page.route('**/api/channel/connection-tests/gmail', (route) =>
    route.fulfill({
      status: 502,
      json: { error: 'connection_test_failed', message: 'support@forcome.mx 无法访问' },
    }),
  );
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const gmail = card(page, 'gmail');
  await expect(gmail).toContainText('连接异常');
  await expect(
    gmail.getByText(
      'support@forcome.mx 访问失败（10:05 起连续 3 次）：请检查全域委派范围与邮箱状态',
    ),
  ).toBeVisible();
  await expect(gmail.getByText('该邮箱来信暂存，恢复后自动补拉')).toBeVisible();
  // 第一阶段不发信、没有错误日志页
  await expect(gmail).not.toContainText('回复进入待发队列');
  await expect(gmail.getByRole('button', { name: '查看错误日志' })).toHaveCount(0);
  // 异常时不写正常的说明行
  await expect(gmail.getByText(/^\d+ 个邮箱：/)).toHaveCount(0);

  await gmail.getByRole('button', { name: '重新检测' }).click();
  await expect(page.getByText('测试连接失败：support@forcome.mx 无法访问')).toBeVisible();
  await expect(page.getByText('请检查全域委派范围与邮箱状态', { exact: true })).toBeVisible();
});

test('几个邮箱同时异常又有延迟：每个一行、次数写实际的连续失败次数，暂存说明写一次，延迟在后（E2、E3）', async ({
  page,
}) => {
  await stubCards(page, {
    gmail: {
      status: 'error',
      lastSyncAt: '2026-09-11T02:04:00.000Z',
      issues: [
        issue({ target: 'amz-auto@forcome.com', failingSince: '2026-09-11T02:12:00.000Z' }),
        issue({
          target: 'support@forcome.com',
          status: 'delayed',
          failingSince: null,
          failures: 0,
          lastSuccessAt: '2026-09-11T02:06:00.000Z',
        }),
        issue({ failures: 5 }),
      ],
    },
  });
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const lines = card(page, 'gmail').getByTestId('channel-card-lines').locator('> div');
  await expect(lines).toHaveText([
    'amz-auto@forcome.com 访问失败（10:12 起连续 3 次）：请检查全域委派范围与邮箱状态',
    'support@forcome.mx 访问失败（10:05 起连续 5 次）：请检查全域委派范围与邮箱状态',
    '该邮箱来信暂存，恢复后自动补拉',
    'support@forcome.com 10:06 后未同步成功，超过 10 分钟',
  ]);
});

test('钉钉卡连接异常与从没同步成功过（Q6、E4）；钉钉测试连接失败的浮层', async ({ page }) => {
  let synced = true;
  await page.route('**/api/channel/settings', async (route) => {
    const real = channelSettingsSchema.parse(await (await route.fetch()).json());
    const channels = real.channels.map((c) =>
      c.kind === 'dingtalk'
        ? { ...c, status: 'error' as const, lastSyncAt: synced ? '2026-09-11T00:00:00.000Z' : null }
        : c,
    );
    await route.fulfill({ json: { ...real, channels } });
  });
  await page.route('**/api/channel/connection-tests/dingtalk', (route) =>
    route.fulfill({
      status: 502,
      json: { error: 'connection_test_failed', message: '钉钉通讯录无法访问' },
    }),
  );
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const dingtalk = card(page, 'dingtalk');
  await expect(dingtalk).toContainText('连接异常');
  await expect(dingtalk.getByText('通讯录 08:00 后未同步成功，连续 3 次失败')).toBeVisible();
  await dingtalk.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText('测试连接失败：钉钉通讯录无法访问')).toBeVisible();
  await expect(page.getByText('请检查应用凭据与通讯录权限')).toBeVisible();

  synced = false;
  await page.reload();
  await expect(dingtalk.getByText('通讯录尚未同步成功，连续 3 次失败')).toBeVisible();
  // 没有最近同步时刻：副标题不写
  await expect(dingtalk).not.toContainText('最近同步');
});

test('全站横幅（G4）：Gmail 连接异常时所有角色都看到，「查看渠道状态」只对管理员；恢复后自动消失', async ({
  page,
}) => {
  let alerts: ChannelAlerts['alerts'] = [
    { kind: 'gmail', targets: ['support@forcome.mx'], since: '2026-09-11T02:05:00.000Z' },
  ];
  await stubAlerts(page, () => alerts);

  await loginAs(page, '李婷');
  const banner = page.getByRole('alert').filter({ hasText: 'Gmail 连接中断，来信暂存队列' });
  await expect(banner).toBeVisible();
  await expect(
    banner.getByText(
      '09-11 10:05 起未收取。恢复后自动补收，按到达顺序处理，SLA 从原到达时间计算。管理员、客服主管已收到通知。',
    ),
  ).toBeVisible();
  // 坐席打不开 P18：没有「查看渠道状态」；横幅不可关闭
  await expect(banner.getByRole('link', { name: '查看渠道状态' })).toHaveCount(0);
  await expect(banner.getByRole('button')).toHaveCount(0);

  // 恢复：横幅自动消失（重新取到空列表；切回页面时也会重取）
  alerts = [];
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(banner).toHaveCount(0);

  alerts = [{ kind: 'gmail', targets: ['support@forcome.mx'], since: '2026-09-11T02:05:00.000Z' }];
  await loginAs(page, '刘洋');
  const adminBanner = page.getByRole('alert').filter({ hasText: 'Gmail 连接中断，来信暂存队列' });
  await expect(adminBanner).toBeVisible();
  await adminBanner.getByRole('link', { name: '查看渠道状态' }).click();
  await expect(page).toHaveURL(/\/settings\/channels$/);
  await expect(page.getByRole('heading', { name: '渠道与店铺' })).toBeVisible();
  // 横幅在各页面都在（P18 上也在）
  await expect(adminBanner).toBeVisible();
});

test('全站横幅（G4）：Gmail 与 Shopify 同时连接异常时各一条，Gmail 在上；Shopify 的写法（待办 11）', async ({
  page,
}) => {
  await stubAlerts(page, () => [
    { kind: 'gmail', targets: ['support@forcome.mx'], since: '2026-09-11T02:05:00.000Z' },
    { kind: 'shopify', targets: ['forcome.mx'], since: '2026-09-11T02:05:00.000Z' },
  ]);
  await loginAs(page, '周敏');
  const banners = page.getByRole('alert').filter({ hasText: /连接中断|同步中断/ });
  await expect(banners).toHaveCount(2);
  await expect(banners.nth(0)).toContainText('Gmail 连接中断，来信暂存队列');
  await expect(banners.nth(1)).toContainText('Shopify 订单同步中断');
  await expect(
    banners
      .nth(1)
      .getByText(
        '09-11 10:05 起未同步。来信照常收取，恢复后自动补拉订单。管理员、客服主管已收到通知。',
      ),
  ).toBeVisible();
  // 客服主管打不开 P18：没有「查看渠道状态」
  await expect(banners.nth(1).getByRole('link', { name: '查看渠道状态' })).toHaveCount(0);

  // 管理员：Shopify 横幅也有「查看渠道状态」，点进 P18
  await loginAs(page, '刘洋');
  const adminShopify = page.getByRole('alert').filter({ hasText: 'Shopify 订单同步中断' });
  await adminShopify.getByRole('link', { name: '查看渠道状态' }).click();
  await expect(page).toHaveURL(/\/settings\/channels$/);
});

test('Shopify 卡未连接（生产环境还没配置 Shopify 凭据，或从没同步成功过）：「尚未授权」、没有最近同步与异常行（待办 11）', async ({
  page,
}) => {
  await stubCards(
    page,
    { shopify: { status: 'not_connected', lastSyncAt: null, issues: [] } },
    {
      'forcome.mx': 'not_connected',
      'forcome.com': 'not_connected',
    },
  );
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const shopify = card(page, 'shopify');
  await expect(shopify).toContainText('未连接');
  await expect(shopify).toContainText('尚未授权');
  await expect(shopify).not.toContainText('最近同步');
  await expect(shopify.getByTestId('channel-card-lines').locator('> div')).toHaveText([
    /^\d+ 个店铺 · 订单经 Admin API 准实时同步$/,
  ]);
  await expect(shopify.getByRole('button', { name: '重新检测' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'forcome-mx.myshopify.com' })).toContainText(
    'Admin API 未连接',
  );
});
