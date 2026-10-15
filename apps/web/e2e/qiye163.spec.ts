import {
  channelSettingsSchema,
  type ChannelAlerts,
  type ChannelCard,
  type ChannelIssue,
} from '@forcome/contracts';
import { expect, test, type Locator, type Page } from '@playwright/test';

/*
 * P18 的 163 企业邮箱（D-28，待办 36；PRD P18、K8 补充小样、K20 补充小样、K7、G4）：
 * - 渠道卡区的「163 企业邮箱」卡（真实接口：示例的 amz-auto@forcome.com 是 163 企业邮箱，接 Fake IMAP 在收信）与测试连接；
 *   同步延迟、连接异常与失败浮层、全站横幅用接口桩（同 channel-status.spec.ts，不去弄坏长期运行的环境）；
 * - 店铺抽屉（K8）逐行登记：示例的 Forcome Auto 一行写「已保存」，按行测试连接成功与失败（Fake IMAP 的约定写法：授权码
 *   fake-auth-failed / fake-ip-denied 为登录失败 / 登录被拒，服务器以 .invalid 结尾为连不上），改了服务器没重填授权码时报错；
 * - 登记：在「E2E 冒烟店铺」上加一行 163 企业邮箱（授权码必填、保存后写「已保存」），最后删掉这一行还原，环境里不多出邮箱；
 *   开发测试环境长期运行，上次没跑完留下的这一行先删掉再登记；还没有测试店铺时（本机全新的 e2e 库）先建它（同 stores.spec.ts）；
 * - 权限：非管理员打不开 P18、调不了店铺与按行测试连接的接口。
 */

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

const drawer = (page: Page) => page.getByRole('dialog');
const card = (page: Page) => page.getByTestId('channel-card-qiye163');
const rows = (page: Page) => drawer(page).getByTestId('mailbox-row');
const rowOf = (page: Page, address: string) =>
  drawer(page).locator(`[data-testid="mailbox-row"][data-address="${address}"]`);
const save = (page: Page) => drawer(page).getByRole('button', { name: '保存', exact: true });
const testResult = (row: Locator) => row.getByTestId('mailbox-test-result');

const E2E_STORE = 'E2E 冒烟店铺';
const E2E_MAILBOX = 'e2e-smoke@forcome.test';
const QIYE_MAILBOX = 'e2e-qiye@forcome.test';
const QIYE_GUIDE = '请检查客户端授权码，以及网易企业邮箱是否开启 IMAP 与客户端登录';

const issue = (overrides: Partial<ChannelIssue>): ChannelIssue => ({
  target: 'amz-auto@forcome.com',
  status: 'error',
  lastSuccessAt: '2026-09-11T02:04:00.000Z',
  failingSince: '2026-09-11T02:05:00.000Z',
  failures: 3,
  ...overrides,
});

test('163 企业邮箱卡（真实接口）：排在 Gmail 之后，已连接、邮箱数、「已发送」；测试连接成功浮层写邮箱数', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  await expect(page.getByTestId('channel-card-phase2')).toBeVisible();
  const kinds = await page
    .locator('[data-testid^="channel-card-"]:not([data-testid="channel-card-lines"])')
    .evaluateAll((cards) => cards.map((c) => c.getAttribute('data-testid')));
  expect(kinds).toEqual([
    'channel-card-amazon',
    'channel-card-shopify',
    'channel-card-gmail',
    'channel-card-qiye163',
    'channel-card-dingtalk',
    'channel-card-phase2',
  ]);
  // worker 起来后常驻拉取开始监听并同步一次，之前为未连接
  await expect(async () => {
    await page.reload();
    await expect(card(page)).toContainText('已连接', { timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
  await expect(card(page)).toContainText('163 企业邮箱');
  await expect(card(page)).toContainText(/最近同步 \d\d:\d\d/);
  await expect(card(page).getByText(/^\d+ 个邮箱：\d+ 个亚马逊买家消息/)).toBeVisible();
  await expect(card(page).getByText('收件与「已发送」：识别到我方回复即转等客户')).toBeVisible();

  await card(page).getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText('连接正常')).toBeVisible();
  await expect(page.getByText(/^163 企业邮箱：\d+ 个邮箱均可访问$/)).toBeVisible();
});

test('163 企业邮箱卡同步延迟与连接异常：每个邮箱一行、恢复指引按服务商、来信暂存、「重新检测」；失败浮层写邮箱与怎么查', async ({
  page,
}) => {
  let failed = false;
  await page.route('**/api/channel/settings', async (route) => {
    const real = channelSettingsSchema.parse(await (await route.fetch()).json());
    const qiye: Partial<ChannelCard> = failed
      ? { status: 'error', lastSyncAt: '2026-09-11T02:04:00.000Z', issues: [issue({})] }
      : {
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
        };
    const channels = real.channels.map((c) => (c.kind === 'qiye163' ? { ...c, ...qiye } : c));
    await route.fulfill({ json: { ...real, channels } });
  });
  await page.route('**/api/channel/connection-tests/qiye163', (route) =>
    route.fulfill({
      status: 502,
      json: { error: 'connection_test_failed', message: 'amz-auto@forcome.com 无法访问' },
    }),
  );
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const lines = card(page).getByTestId('channel-card-lines').locator('> div');
  await expect(card(page)).toContainText('同步延迟');
  await expect(card(page)).toContainText('最近同步 10:05');
  await expect(lines.first()).toHaveText('amz-auto@forcome.com 10:05 后未同步成功，超过 10 分钟');
  await expect(card(page).getByRole('button', { name: '重新检测' })).toHaveCount(0);

  failed = true;
  await page.reload();
  await expect(card(page)).toContainText('连接异常');
  await expect(lines).toHaveText([
    `amz-auto@forcome.com 访问失败（10:05 起连续 3 次）：${QIYE_GUIDE}`,
    '该邮箱来信暂存，恢复后自动补拉',
  ]);
  await card(page).getByRole('button', { name: '重新检测' }).click();
  await expect(page.getByText('测试连接失败：amz-auto@forcome.com 无法访问')).toBeVisible();
  await expect(page.getByText(QIYE_GUIDE, { exact: true })).toBeVisible();
});

test('全站横幅（G4）：163 企业邮箱连接异常时所有角色都看到，「查看渠道状态」只对管理员；与 Gmail 同时异常时 Gmail 在上', async ({
  page,
}) => {
  const qiye: ChannelAlerts['alerts'][number] = {
    kind: 'qiye163',
    targets: ['amz-auto@forcome.com'],
    since: '2026-09-11T02:05:00.000Z',
  };
  let alerts: ChannelAlerts['alerts'] = [qiye];
  await page.route('**/api/channel/alerts', (route) =>
    route.fulfill({ json: { alerts } satisfies ChannelAlerts }),
  );

  await loginAs(page, '李婷');
  const banner = page.getByRole('alert').filter({ hasText: '163 企业邮箱连接中断，来信暂存队列' });
  await expect(banner).toBeVisible();
  await expect(
    banner.getByText(
      '09-11 10:05 起未收取。恢复后自动补收，按到达顺序处理，SLA 从原到达时间计算。管理员、客服主管已收到通知。',
    ),
  ).toBeVisible();
  await expect(banner.getByRole('link', { name: '查看渠道状态' })).toHaveCount(0);

  alerts = [
    { kind: 'gmail', targets: ['support@forcome.mx'], since: '2026-09-11T02:05:00.000Z' },
    qiye,
  ];
  await loginAs(page, '刘洋');
  const banners = page.getByRole('alert').filter({ hasText: '连接中断，来信暂存队列' });
  await expect(banners).toHaveCount(2);
  await expect(banners.nth(0)).toContainText('Gmail 连接中断，来信暂存队列');
  await expect(banners.nth(1)).toContainText('163 企业邮箱连接中断，来信暂存队列');
  await banners.nth(1).getByRole('link', { name: '查看渠道状态' }).click();
  await expect(page).toHaveURL(/\/settings\/channels$/);
});

test('K8：已保存的授权码只写「已保存」；按行测试连接的成功与失败写在行内；改了服务器没重填授权码时测试与保存都要求重填', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  await page.getByRole('button', { name: '编辑 Forcome Auto' }).click();
  const row = rowOf(page, 'amz-auto@forcome.com');
  await expect(row.getByRole('combobox')).toHaveText('163 企业邮箱');
  await expect(row.getByTestId('auth-code-saved')).toHaveValue('已保存');
  await expect(row.getByRole('textbox', { name: 'IMAP 服务器' })).toHaveValue('imap.qiye.163.com');
  await expect(row.getByRole('textbox', { name: '端口' })).toHaveValue('993');
  // 授权码不回显：整个抽屉里没有密码框
  await expect(drawer(page).locator('input[type="password"]')).toHaveCount(0);
  await expect(row.getByText('不保存也能测，用这一行当前填的内容')).toBeVisible();

  // 没重填：用已保存的测
  await row.getByRole('button', { name: '测试连接' }).click();
  await expect(testResult(row)).toHaveText('连接正常：收件箱与「已发送」均可访问');

  // 重新填写：换成密码框，填 Fake 约定的错误授权码
  await row.getByRole('button', { name: '重新填写' }).click();
  const code = row.getByLabel('客户端授权码');
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute('type', 'password');
  await expect(
    row.getByText(
      '不是登录密码：管理员在网易企业邮箱开启 IMAP 与客户端登录后，为这个邮箱生成；保存后不再显示',
    ),
  ).toBeVisible();
  // 改了这一行就撤掉上次的结果
  await expect(testResult(row)).toHaveCount(0);
  // 点了「重新填写」却没填就保存：报「请填写客户端授权码」，不提交（不悄悄沿用已保存的）
  await save(page).click();
  await expect(row.getByText('请填写客户端授权码')).toBeVisible();
  await expect(code).toBeFocused();
  await expect(drawer(page)).toBeVisible();
  await code.fill('fake-auth-failed');
  await row.getByRole('button', { name: '测试连接' }).click();
  await expect(testResult(row)).toHaveText(`登录失败：${QIYE_GUIDE}`);
  await code.fill('fake-ip-denied');
  await row.getByRole('button', { name: '测试连接' }).click();
  await expect(testResult(row)).toHaveText(
    '登录被拒：网易企业邮箱限制了登录 IP，请管理员在网易后台放行本系统服务器的出口 IP',
  );
  await code.fill('e2e-code');
  await row.getByRole('textbox', { name: 'IMAP 服务器' }).fill('imap.e2e.invalid');
  await row.getByRole('button', { name: '测试连接' }).click();
  await expect(testResult(row)).toHaveText('连不上 imap.e2e.invalid:993：请检查 IMAP 服务器与端口');

  // 不保存，放弃后重开：回到已保存
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click();
  await page.getByRole('button', { name: '编辑 Forcome Auto' }).click();
  await expect(row.getByTestId('auth-code-saved')).toBeVisible();

  // 改了服务器没重填授权码（待办 35 ⑦）：回到要填授权码的样子，测试与保存都报「请填写客户端授权码」，不会登录任何主机
  await row.getByRole('textbox', { name: 'IMAP 服务器' }).fill('imaphz.qiye.163.com');
  await expect(row.getByTestId('auth-code-saved')).toHaveCount(0);
  await expect(row.getByLabel('客户端授权码')).toHaveValue('');
  await row.getByRole('button', { name: '测试连接' }).click();
  await expect(row.getByText('请填写客户端授权码')).toBeVisible();
  await expect(testResult(row)).toHaveCount(0);
  await save(page).click();
  await expect(row.getByText('请填写客户端授权码')).toBeVisible();
  await expect(row.getByLabel('客户端授权码')).toBeFocused();
  // 改回原来的服务器：又是已保存
  await row.getByRole('textbox', { name: 'IMAP 服务器' }).fill('imap.qiye.163.com');
  await expect(row.getByTestId('auth-code-saved')).toBeVisible();
  // 改回去就没有未保存的修改：直接关闭，不问
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(drawer(page)).toHaveCount(0);
});

/** 还没有「E2E 冒烟店铺」时建它（同 stores.spec.ts 的写法） */
async function ensureE2eStore(page: Page): Promise<void> {
  const storeRows = page.getByTestId('store-row');
  await expect(storeRows.filter({ hasText: 'Forcome Direct' })).toBeVisible();
  if ((await storeRows.filter({ hasText: E2E_MAILBOX }).count()) > 0) return;
  await page.getByRole('button', { name: '新增店铺' }).click();
  await drawer(page).getByRole('combobox', { name: '平台' }).click();
  await page.getByRole('option', { name: 'Shopify', exact: true }).click();
  await drawer(page).getByRole('textbox', { name: '店铺名' }).fill(E2E_STORE);
  await drawer(page).getByRole('button', { name: '站点（多选）' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'MX' }).click();
  await page.keyboard.press('Escape');
  await drawer(page).getByRole('textbox', { name: '进线邮箱 1', exact: true }).fill(E2E_MAILBOX);
  await drawer(page)
    .getByRole('textbox', { name: '平台标识 · Shopify 店铺域名' })
    .fill(`e2e-${Date.now()}.myshopify.com`);
  await save(page).click();
  await expect(drawer(page)).toHaveCount(0);
}

test('登记 163 企业邮箱：授权码必填，测试连接通过后保存；店铺表写用途与服务商，重开写「已保存」；删掉这一行还原', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  await ensureE2eStore(page);
  const e2eRow = page.getByTestId('store-row').filter({ hasText: E2E_MAILBOX });
  const edit = () => page.getByRole('button', { name: `编辑 ${E2E_STORE}` }).click();

  // 上次没跑完留下的 163 企业邮箱行先删掉
  if ((await e2eRow.filter({ hasText: QIYE_MAILBOX }).count()) > 0) {
    await edit();
    await rowOf(page, QIYE_MAILBOX)
      .getByRole('button', { name: `移除 ${QIYE_MAILBOX}` })
      .click();
    await save(page).click();
    await expect(drawer(page)).toHaveCount(0);
    await expect(e2eRow).not.toContainText(QIYE_MAILBOX);
  }

  await edit();
  const before = await rows(page).count();
  await drawer(page).getByRole('button', { name: '添加进线邮箱' }).click();
  await expect(rows(page)).toHaveCount(before + 1);
  const row = rows(page).last();
  // 新加的行默认 Gmail，没有授权码面板
  await expect(row.getByRole('combobox')).toHaveText('Gmail');
  await expect(row.getByTestId('qiye-panel')).toHaveCount(0);
  await row.getByRole('textbox', { name: `进线邮箱 ${before + 1}` }).fill(QIYE_MAILBOX);
  await row.getByRole('combobox').click();
  await page.getByRole('option', { name: '163 企业邮箱' }).click();
  // 服务器与端口预填默认值，授权码为空的密码框
  await expect(row.getByRole('textbox', { name: 'IMAP 服务器' })).toHaveValue('imap.qiye.163.com');
  await expect(row.getByRole('textbox', { name: '端口' })).toHaveValue('993');
  const code = row.getByLabel('客户端授权码');
  await expect(code).toHaveValue('');

  // 授权码必填：保存报错并定位到它
  await save(page).click();
  await expect(row.getByText('请填写客户端授权码')).toBeVisible();
  await expect(code).toBeFocused();
  // 端口不对（原型没画，按 PRD P18「校验」）
  await row.getByRole('textbox', { name: '端口' }).fill('70000');
  await code.fill('e2e-code');
  await save(page).click();
  await expect(row.getByText('端口为 1–65535 的整数')).toBeVisible();
  await row.getByRole('textbox', { name: '端口' }).fill('993');

  await row.getByRole('button', { name: '测试连接' }).click();
  await expect(testResult(row)).toHaveText('连接正常：收件箱与「已发送」均可访问');
  await save(page).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByText('店铺已保存').last()).toBeVisible();
  // 两个服务商不同的邮箱：每个地址下各写用途与服务商
  await expect(e2eRow).toContainText(QIYE_MAILBOX);
  await expect(e2eRow).toContainText('Shopify 客服邮箱 · Gmail');
  await expect(e2eRow).toContainText('Shopify 客服邮箱 · 163 企业邮箱');

  // 重开：授权码写「已保存」，不回显
  await edit();
  await expect(rowOf(page, QIYE_MAILBOX).getByTestId('auth-code-saved')).toHaveValue('已保存');
  await expect(drawer(page).locator('input[type="password"]')).toHaveCount(0);

  // 删掉这一行还原（保存后授权码一并删除）
  await rowOf(page, QIYE_MAILBOX)
    .getByRole('button', { name: `移除 ${QIYE_MAILBOX}` })
    .click();
  await save(page).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(e2eRow).not.toContainText(QIYE_MAILBOX);
  await expect(e2eRow).not.toContainText('163 企业邮箱');
});

test('权限：非管理员打不开 P18，也调不了店铺与按行测试连接的接口（只有管理员）', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await page.goto('/settings/channels');
  await expect(page.getByText('没有访问权限')).toBeVisible();
  await expect(page.getByTestId('channel-card-qiye163')).toHaveCount(0);

  const statuses = await page.evaluate(async () => {
    // 周敏的店铺选项里能拿到店铺 ID（各页面的店铺筛选用它）
    const options = (await (await fetch('/api/channel/store-options')).json()) as {
      stores: { id: string; name: string }[];
    };
    const store = options.stores.find((s) => s.name === 'Forcome Auto');
    const post = (path: string, body: unknown) =>
      fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.status);
    return {
      settings: (await fetch('/api/channel/settings')).status,
      mailboxTest: await post('/api/channel/mailbox-tests', {
        address: 'amz-auto@forcome.com',
        imapHost: 'imap.qiye.163.com',
        imapPort: 993,
      }),
      cardTest: await post('/api/channel/connection-tests/qiye163', {}),
      // 改不了：新增店铺与编辑店铺（含 163 企业邮箱的授权码）
      create: await post('/api/channel/stores', {
        name: 'E2E 越权',
        platform: 'amazon',
        sites: ['US'],
        defaultSite: 'US',
        mailboxes: [{ address: 'e2e-denied@forcome.test', provider: 'qiye163', authCode: 'x' }],
        platformId: 'A0E2EDENIED',
      }),
      update: await fetch(`/api/channel/stores/${store?.id ?? ''}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1 }),
      }).then((r) => r.status),
    };
  });
  expect(statuses).toEqual({
    settings: 403,
    mailboxTest: 403,
    cardTest: 403,
    create: 403,
    update: 403,
  });
});
