import { devDingtalkScanResponseSchema, loginDeniedSchema } from '@forcome/contracts';
import { expect, test, type Page } from '@playwright/test';

/*
 * 钉钉扫码登录（待办 05；全局状态 G11、G12）：登录页的二维码（Fake 钉钉画示意二维码）与 2 分钟过期刷新、扫码确认后钉钉把浏览器
 * 带到 /login/dingtalk 换会话（进入默认首页）、三种被拒、会话过期、扫码失败的浮层（G5）。
 * 「手机扫码并确认」用开发工具模拟（POST /api/dev/dingtalk/scan，只在开启开发登录、钉钉用 Fake 时存在），之后照钉钉的做法
 * 把浏览器带到回调地址。只有「账号已停用」用接口桩（Fake 通讯录在 api 与 worker 各一份，e2e 里不改通讯录），按 contracts 严格解析。
 * 示例成员的钉钉用户 ID 是夹具的 key；两家生产厂负责人（没有角色）是 factory-head-<厂代码>。用例可在开发测试环境重复执行。
 */

/** 打开登录页，等二维码出来，返回这次登录的 state（在只发给扫码登录接口的 Cookie 里） */
async function openLogin(page: Page): Promise<string> {
  await page.goto('/login');
  await expect(page.getByTestId('login-qr')).toHaveAttribute('data-mode', 'fake');
  await expect(page.getByRole('img', { name: '钉钉登录二维码' })).toBeVisible();
  const cookie = (await page.context().cookies()).find((c) => c.name === 'forcome_login_state');
  if (!cookie) throw new Error('没有扫码登录的 state');
  return cookie.value;
}

/** 模拟某人在手机上扫码并确认，像钉钉一样把浏览器带到回调地址 */
async function scan(page: Page, userId: string): Promise<void> {
  const state = await openLogin(page);
  const body = await page.evaluate(async (id) => {
    const res = await fetch('/api/dev/dingtalk/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: id }),
    });
    return (await res.json()) as unknown;
  }, userId);
  const { authCode } = devDingtalkScanResponseSchema.parse(body);
  await page.goto(`/login/dingtalk?authCode=${encodeURIComponent(authCode)}&state=${state}`);
}

const card = (page: Page) => page.getByRole('main');

test('登录页（G11）：二维码与说明，2 分钟后过期加蒙层，「刷新」换一个新的二维码', async ({
  page,
}) => {
  await page.clock.install();
  const first = await openLogin(page);
  await expect(card(page).getByRole('heading', { name: '用钉钉扫码登录' })).toBeVisible();
  await expect(card(page).getByText('打开钉钉，扫一扫下方二维码', { exact: true })).toBeVisible();
  await expect(card(page).getByText('二维码 2 分钟内有效', { exact: true })).toBeVisible();
  await expect(
    card(page).getByText('成员与部门来自钉钉通讯录，由管理员在本系统分配角色后才能进入', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(card(page).getByText('二维码已过期')).toHaveCount(0);

  await page.clock.fastForward('01:59');
  await expect(card(page).getByText('二维码已过期')).toHaveCount(0);
  await page.clock.fastForward('00:02');
  await expect(card(page).getByText('二维码已过期', { exact: true })).toBeVisible();

  await card(page).getByRole('button', { name: '刷新' }).click();
  await expect(card(page).getByText('二维码已过期')).toHaveCount(0);
  await expect(page.getByRole('img', { name: '钉钉登录二维码' })).toBeVisible();
  const second = (await page.context().cookies()).find((c) => c.name === 'forcome_login_state');
  expect(second?.value).toBeTruthy();
  expect(second?.value).not.toBe(first);
});

test('扫码确认后进入该角色的默认首页（坐席 → P04），会话与开发登录相同', async ({
  page,
  baseURL,
}) => {
  await scan(page, 'liting');
  await expect(page).toHaveURL((url) => url.pathname === '/tickets');
  const topbar = page.getByRole('banner');
  await expect(topbar.getByText('李婷', { exact: true })).toBeVisible();
  await expect(topbar.getByText('坐席', { exact: true })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'forcome_session')).toMatchObject({
    httpOnly: true,
    sameSite: 'Lax',
    secure: baseURL?.startsWith('https:') ?? false,
  });
  // state 只用一次
  expect(cookies.find((c) => c.name === 'forcome_login_state')).toBeUndefined();

  // 已登录时打开登录页回到默认首页
  await page.goto('/login');
  await expect(page).toHaveURL((url) => url.pathname === '/tickets');
});

test('未分配角色（G12）：写明原因与管理员，「返回登录页」回到二维码', async ({ page }) => {
  await scan(page, 'factory-head-fqd');
  await expect(card(page).getByText('还没有分配角色', { exact: true })).toBeVisible();
  await expect(
    card(page).getByText('你的钉钉账号还没有在本系统分配角色，请联系管理员刘洋。', {
      exact: true,
    }),
  ).toBeVisible();
  await card(page).getByRole('button', { name: '返回登录页' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/login');
  await expect(card(page).getByRole('heading', { name: '用钉钉扫码登录' })).toBeVisible();
});

test('只有生产厂对接人角色（第一期，AC-P1-21）：写明是谁，「暂时无法进入」，没有按钮', async ({
  page,
}) => {
  await scan(page, 'chengong');
  await expect(card(page).getByText('陈工 · FQD / 品质部 · 生产厂对接人')).toBeVisible();
  await expect(card(page).getByText('暂时无法进入', { exact: true })).toBeVisible();
  await expect(
    card(page).getByText('工厂工作台第二阶段上线，目前无法进入。', { exact: true }),
  ).toBeVisible();
  await expect(card(page).getByRole('button')).toHaveCount(0);
});

test('账号已停用（G12）：钉钉离职或管理员停用，「返回登录页」', async ({ page }) => {
  // 接口桩：按 contracts 严格解析（Fake 通讯录在 e2e 里不改，停用的场景由集成测试覆盖）
  const denied = loginDeniedSchema.parse({
    error: 'login_denied',
    reason: 'disabled',
    message: '你的账号已停用（钉钉离职或管理员停用）。',
    member: { name: '陈晨', dept: 'FSH / 客服部', roles: ['agent'] },
  });
  await page.route('**/api/auth/dingtalk/login', (route) =>
    route.fulfill({ status: 403, json: denied }),
  );
  await scan(page, 'chenchen');
  await expect(card(page).getByText('账号已停用', { exact: true })).toBeVisible();
  await expect(
    card(page).getByText('你的账号已停用（钉钉离职或管理员停用）。', { exact: true }),
  ).toBeVisible();
  await expect(card(page).getByRole('button', { name: '返回登录页' })).toBeVisible();
});

test('扫码结果已失效：弹失败浮层（G5）并回到二维码', async ({ page }) => {
  const state = await openLogin(page);
  await page.goto(`/login/dingtalk?authCode=not-a-real-code&state=${state}`);
  await expect(page).toHaveURL((url) => url.pathname === '/login');
  await expect(page.getByText('登录失败：扫码结果已失效', { exact: true })).toBeVisible();
  await expect(page.getByText('请重新扫码。', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '钉钉登录二维码' })).toBeVisible();
});

test('会话 7 天未操作过期（G12）：「已退出登录」，「重新扫码登录」换成二维码', async ({ page }) => {
  await page.goto('/login?expired=true');
  await expect(card(page).getByText('已退出登录', { exact: true })).toBeVisible();
  await expect(card(page).getByText('7 天未操作，已退出登录。', { exact: true })).toBeVisible();
  await card(page).getByRole('button', { name: '重新扫码登录' }).click();
  await expect(card(page).getByRole('heading', { name: '用钉钉扫码登录' })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === '/login' && url.search === '');
});
