import {
  channelSettingsSchema,
  type ChannelAlerts,
  type ChannelCard,
  type ChannelIssue,
} from '@forcome/contracts';
import { expect, test, type Page } from '@playwright/test';

/*
 * 渠道连接状态（待办 09、11、12；PRD 6.9、P18「第一阶段」、K7、K20 补充小样、G4）：
 * - 真实的接口（开发测试环境全部是 Fake，邮箱与 Shopify、亚马逊订单都在同步）：四张卡的「测试连接」与成功浮层；
 * - 卡片的各种异常写法与全站横幅用接口桩（按 contracts 的模式解析真实响应后只改连接状态），不去弄坏长期运行的环境：
 *   Gmail 同步延迟、连接异常（卡底「重新检测」与失败浮层）、几个邮箱同时异常又有延迟、钉钉同步延迟与连接异常（含从没同步成功过）；
 *   Shopify 同步延迟、连接异常（按店铺，卡底「重新检测」与失败浮层，店铺表「Admin API 连接异常」）（待办 11）；
 *   亚马逊同步延迟、连接异常（按店铺，同 Shopify）与「订单通知队列（SQS）」一行的四种写法（只影响这一行），测试连接失败按访问不了的
 *   第一个写怎么查（待办 12）；
 *   订单回补行（待办 13 Q2）：示例环境灌完数据即开始回补（同部署子命令 order-backfill），真实接口上亚马逊「90 天 · 已完成」、
 *   Shopify「60 天 · 未开通 read_all_orders」；未开始、进行中用接口桩；同步延迟照写、连接异常与未连接不显示；
 *   横幅对所有角色显示、「查看渠道状态」只对管理员，恢复后自动消失；几个渠道同时异常时各一条，从上到下 Gmail、亚马逊、Shopify。
 * 时刻按北京时间写（playwright.config 的 timezoneId）。
 */

// 接口桩里取真实响应（route.fetch）时，页面可能正好在后台重取（窗口聚焦、每分钟的定时重取）：用例结束时撤掉桩并忽略还在途中的，
// 否则这次重取被中断会报「route.fetch: Test ended」（与被测行为无关）
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

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

/** P18 的接口桩：取真实响应，只把给定的渠道卡换成给定的状态；可另把某店铺的订单连接换成给定的状态 */
async function stubCards(
  page: Page,
  cards: Partial<Record<ChannelCard['kind'], Partial<ChannelCard>>>,
  storeOrders: Readonly<Record<string, ChannelCard['status']>> = {},
): Promise<void> {
  await page.route('**/api/channel/settings', async (route) => {
    const real = channelSettingsSchema.parse(await (await route.fetch()).json());
    const channels = real.channels.map((c) => ({ ...c, ...cards[c.kind] }));
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

test('测试连接（K20）：四张卡都有；全部可访问时成功浮层写测过的邮箱数、通讯录可访问、店铺数', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
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

  // 亚马逊订单每 4 分钟增量同步一次（worker 启动时也一次），订单通知队列（Fake SQS）在拉：已连接，SQS 正常
  await expect(async () => {
    await page.reload();
    await expect(card(page, 'amazon')).toContainText('已连接', { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(card(page, 'amazon')).toContainText(/最近同步 \d\d:\d\d/);
  await expect(card(page, 'amazon').getByTestId('order-queue-line')).toHaveText(
    /^订单通知队列（SQS）正常 · 积压 \d+$/,
  );
  await card(page, 'amazon').getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText(/^亚马逊 SP-API：\d+ 个店铺均可访问$/)).toBeVisible();
});

test('亚马逊卡同步延迟：每个延迟的店铺一行，其余说明行与 SQS 行照常；店铺表「SP-API 同步延迟」（待办 12 Q1）', async ({
  page,
}) => {
  await stubCards(
    page,
    {
      amazon: {
        status: 'delayed',
        lastSyncAt: '2026-09-11T02:05:00.000Z',
        issues: [
          issue({
            target: 'Forcome Auto',
            status: 'delayed',
            failingSince: null,
            failures: 0,
            lastSuccessAt: '2026-09-11T02:05:00.000Z',
          }),
        ],
        queue: { status: 'normal', backlog: 0 },
        backfill: { days: 90, state: 'completed', orders: 12, limited: false },
      },
    },
    { 'Forcome Auto': 'delayed' },
  );
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const amazon = card(page, 'amazon');
  await expect(amazon).toContainText('同步延迟');
  await expect(amazon).toContainText('最近同步 10:05');
  await expect(amazon.getByTestId('channel-card-lines').locator('> div')).toHaveText([
    'Forcome Auto 10:05 后未同步成功，超过 10 分钟',
    /^\d+ 个店铺 · 订单经 SP-API 准实时同步$/,
    '订单通知队列（SQS）正常 · 积压 0',
    '订单回补 90 天已完成',
  ]);
  await expect(amazon.getByRole('button', { name: '重新检测' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'A3KA8V1T6RW2NB' })).toContainText(
    'SP-API 同步延迟',
  );
});

test('亚马逊卡连接异常：每个异常的店铺一行原因与恢复指引、订单暂停同步、SQS 行照写、「重新检测」；测试失败浮层按访问不了的第一个写怎么查（待办 12 Q2、Q6）', async ({
  page,
}) => {
  await stubCards(
    page,
    {
      amazon: {
        status: 'error',
        lastSyncAt: '2026-09-11T02:02:00.000Z',
        issues: [
          issue({ target: 'Forcome Auto' }),
          issue({ target: 'Forcome Direct', status: 'delayed', failingSince: null, failures: 0 }),
        ],
        queue: { status: 'normal', backlog: 0 },
        backfill: { days: 90, state: 'completed', orders: 12, limited: false },
      },
    },
    { 'Forcome Auto': 'error' },
  );
  let failure = 'Forcome Auto 无法访问';
  await page.route('**/api/channel/connection-tests/amazon', (route) =>
    route.fulfill({ status: 502, json: { error: 'connection_test_failed', message: failure } }),
  );
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const amazon = card(page, 'amazon');
  await expect(amazon).toContainText('连接异常');
  await expect(amazon.getByTestId('channel-card-lines').locator('> div')).toHaveText([
    'Forcome Auto 访问失败（10:05 起连续 3 次）：请检查 SP-API 应用凭据与卖家授权',
    '该店铺订单暂停同步，恢复后自动补拉；来信经 Gmail 照常收取',
    'Forcome Direct 10:04 后未同步成功，超过 10 分钟',
    '订单通知队列（SQS）正常 · 积压 0',
  ]);
  // 连接异常的卡不显示订单回补行（待办 13 Q2 f）
  await expect(amazon.getByTestId('order-backfill-line')).toHaveCount(0);
  // 第一阶段没有「重新授权」与错误日志页
  await expect(amazon.getByRole('button', { name: '重新授权' })).toHaveCount(0);
  await expect(amazon.getByRole('button', { name: '查看错误日志' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'A3KA8V1T6RW2NB' })).toContainText(
    'SP-API 连接异常',
  );

  await amazon.getByRole('button', { name: '重新检测' }).click();
  await expect(page.getByText('测试连接失败：Forcome Auto 无法访问')).toBeVisible();
  await expect(page.getByText('请检查 SP-API 应用凭据与卖家授权', { exact: true })).toBeVisible();

  // 只有订单通知队列访问不了：写 AWS 的（上一次测完要重取渠道卡，按钮在这期间转圈、不响应点击）
  failure = '订单通知队列（SQS） 无法访问';
  const testButton = amazon.getByRole('button', { name: '测试连接' });
  await expect(testButton).not.toHaveAttribute('aria-busy');
  await testButton.click();
  await expect(page.getByText('测试连接失败：订单通知队列（SQS） 无法访问')).toBeVisible();
  await expect(page.getByText('请检查 AWS 访问密钥与队列地址', { exact: true })).toBeVisible();
});

test('订单通知队列（SQS）一行的四种写法：正常 · 积压 N、积压 N 条、拉取失败、未连接；只影响这一行，卡片仍是已连接、没有「重新检测」（待办 12 Q7）', async ({
  page,
}) => {
  let queue: ChannelCard['queue'] = { status: 'normal', backlog: 3 };
  await page.route('**/api/channel/settings', async (route) => {
    const real = channelSettingsSchema.parse(await (await route.fetch()).json());
    const channels = real.channels.map((c) =>
      c.kind === 'amazon'
        ? {
            ...c,
            status: 'connected' as const,
            issues: [],
            lastSyncAt: '2026-09-11T02:16:00.000Z',
            queue,
          }
        : c,
    );
    await route.fulfill({ json: { ...real, channels } });
  });
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const amazon = card(page, 'amazon');
  const line = amazon.getByTestId('order-queue-line');
  await expect(line).toHaveText('订单通知队列（SQS）正常 · 积压 3');
  for (const [next, text] of [
    [{ status: 'backlog', backlog: 12 }, '订单通知队列（SQS）积压 12 条'],
    [{ status: 'failed', backlog: 3 }, '订单通知队列（SQS）拉取失败'],
    [{ status: 'not_connected', backlog: null }, '订单通知队列（SQS）未连接'],
  ] as const) {
    queue = next;
    await page.reload();
    await expect(line).toHaveText(text);
    await expect(amazon).toContainText('已连接');
    await expect(amazon.getByRole('button', { name: '重新检测' })).toHaveCount(0);
  }
});

/**
 * 真实接口上 Shopify 回补行的样子：示例店铺回补完是「60 天 · 未开通 read_all_orders」；但别的用例（stores、audit-log）在灌完示例数据之后
 * 新建或改了 Shopify 店铺的平台标识，这些店铺还没回补，按 Q2 d 回补行回到「未开始」（提示管理员再执行一次）——两种都对，天数都是 60
 * （示例店铺按没开通 read_all_orders 回补过）。精确的「未开通 read_all_orders」画面由下面的接口桩用例与截图覆盖
 */
const SHOPIFY_BACKFILLED = /^订单回补 60 天(未开通 read_all_orders|未开始)$/;

test('订单回补行（真实接口）：示例环境上线前已回补——亚马逊「订单回补 90 天 ✓已完成」在 SQS 行之后，Shopify 没开通 read_all_orders「订单回补 60 天」在店铺行之后（待办 13）', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  // 灌完示例数据即开始回补，worker 起来后逐页做完（几秒）
  await expect(async () => {
    await page.reload();
    await expect(card(page, 'amazon').getByTestId('order-backfill-line')).toHaveText(
      '订单回补 90 天已完成',
      { timeout: 1_000 },
    );
    await expect(card(page, 'shopify').getByTestId('order-backfill-line')).toHaveText(
      SHOPIFY_BACKFILLED,
      { timeout: 1_000 },
    );
  }).toPass({ timeout: 60_000 });
  const amazonLines = card(page, 'amazon').getByTestId('channel-card-lines').locator('> div');
  await expect(amazonLines.last()).toHaveText('订单回补 90 天已完成');
  await expect(amazonLines.nth(-2)).toHaveText(/^订单通知队列（SQS）/);
  const shopifyLines = card(page, 'shopify').getByTestId('channel-card-lines').locator('> div');
  await expect(shopifyLines).toHaveText([
    /^\d+ 个店铺 · 订单经 Admin API 准实时同步$/,
    SHOPIFY_BACKFILLED,
  ]);
});

test('订单回补行的未开始与进行中：「未开始」、「进行中 · 已回补 N 笔」（千分位）；Shopify 60 天还在回补时也写进行中（待办 13 Q2）', async ({
  page,
}) => {
  let amazonBackfill: ChannelCard['backfill'] = {
    days: 90,
    state: 'not_started',
    orders: 0,
    limited: false,
  };
  await page.route('**/api/channel/settings', async (route) => {
    const real = channelSettingsSchema.parse(await (await route.fetch()).json());
    const channels = real.channels.map((c) => {
      if (c.kind === 'amazon') {
        return { ...c, status: 'connected' as const, issues: [], backfill: amazonBackfill };
      }
      if (c.kind === 'shopify') {
        return {
          ...c,
          status: 'connected' as const,
          issues: [],
          backfill: { days: 60, state: 'running' as const, orders: 8, limited: true },
        };
      }
      return c;
    });
    await route.fulfill({ json: { ...real, channels } });
  });
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const amazonLine = card(page, 'amazon').getByTestId('order-backfill-line');
  await expect(amazonLine).toHaveText('订单回补 90 天未开始');
  await expect(card(page, 'shopify').getByTestId('order-backfill-line')).toHaveText(
    '订单回补 60 天进行中 · 已回补 8 笔',
  );
  amazonBackfill = { days: 90, state: 'running', orders: 1284, limited: false };
  await page.reload();
  await expect(amazonLine).toHaveText('订单回补 90 天进行中 · 已回补 1,284 笔');
  // 只影响这一行：卡片仍是已连接
  await expect(card(page, 'amazon')).toContainText('已连接');
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
        backfill: { days: 60, state: 'completed', orders: 4, limited: true },
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
  await expect(lines.nth(2)).toHaveText('订单回补 60 天未开通 read_all_orders');
  await expect(lines).toHaveCount(3);
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
        backfill: { days: 60, state: 'completed', orders: 4, limited: true },
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
  // 连接异常的卡不显示订单回补行（待办 13 Q2 f）
  await expect(shopify.getByTestId('order-backfill-line')).toHaveCount(0);
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

test('全站横幅（G4）：Gmail、亚马逊、Shopify 同时连接异常时各一条，从上到下 Gmail、亚马逊、Shopify；亚马逊的写法（待办 12 Q3）', async ({
  page,
}) => {
  await stubAlerts(page, () => [
    { kind: 'gmail', targets: ['support@forcome.mx'], since: '2026-09-11T02:05:00.000Z' },
    { kind: 'amazon', targets: ['Forcome Auto'], since: '2026-09-11T02:05:00.000Z' },
    { kind: 'shopify', targets: ['forcome.mx'], since: '2026-09-11T02:05:00.000Z' },
  ]);
  await loginAs(page, '李婷');
  const banners = page.getByRole('alert').filter({ hasText: /连接中断|同步中断/ });
  await expect(banners).toHaveCount(3);
  await expect(banners.nth(0)).toContainText('Gmail 连接中断，来信暂存队列');
  await expect(banners.nth(1)).toContainText('亚马逊订单同步中断');
  await expect(banners.nth(2)).toContainText('Shopify 订单同步中断');
  await expect(
    banners
      .nth(1)
      .getByText(
        '09-11 10:05 起未同步。来信照常收取，恢复后自动补拉订单。管理员、客服主管已收到通知。',
      ),
  ).toBeVisible();
  await expect(banners.nth(1).getByRole('link', { name: '查看渠道状态' })).toHaveCount(0);

  await loginAs(page, '刘洋');
  const adminAmazon = page.getByRole('alert').filter({ hasText: '亚马逊订单同步中断' });
  await adminAmazon.getByRole('link', { name: '查看渠道状态' }).click();
  await expect(page).toHaveURL(/\/settings\/channels$/);
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
    { shopify: { status: 'not_connected', lastSyncAt: null, issues: [], backfill: null } },
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

test('亚马逊卡未连接（生产环境还没配置 SP-API 与 SQS）：「尚未授权」、没有最近同步与异常行、SQS 行未连接（待办 12）', async ({
  page,
}) => {
  await stubCards(
    page,
    {
      amazon: {
        status: 'not_connected',
        lastSyncAt: null,
        issues: [],
        queue: { status: 'not_connected', backlog: null },
        backfill: null,
      },
    },
    { 'Forcome Direct': 'not_connected', 'Forcome Auto': 'not_connected' },
  );
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const amazon = card(page, 'amazon');
  await expect(amazon).toContainText('未连接');
  await expect(amazon).toContainText('尚未授权');
  await expect(amazon).not.toContainText('最近同步');
  await expect(amazon.getByTestId('channel-card-lines').locator('> div')).toHaveText([
    /^\d+ 个店铺 · 订单经 SP-API 准实时同步$/,
    '订单通知队列（SQS）未连接',
  ]);
  await expect(page.getByRole('row').filter({ hasText: 'A1FD7Q2M9XK3LC' })).toContainText(
    'SP-API 未连接',
  );
});
