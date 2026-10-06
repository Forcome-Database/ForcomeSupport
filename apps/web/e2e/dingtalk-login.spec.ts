import {
  apiErrorSchema,
  devDingtalkScanResponseSchema,
  dingtalkLoginStartSchema,
  loginDeniedSchema,
  loginFailedSchema,
} from '@forcome/contracts';
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

/** 钉钉扫码登录框的脚本（真实接口时才加载；e2e 不连外网，用接口桩代替） */
const DINGTALK_SCRIPT = 'https://g.alicdn.com/dingding/**';

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

test('取二维码失败：失败浮层「加载二维码失败：原因」+「立即重试」，重试后出二维码（G5）', async ({
  page,
}) => {
  const failure = apiErrorSchema.parse({ error: 'internal', message: '服务器内部错误' });
  await page.route('**/api/auth/dingtalk/start', (route) =>
    route.fulfill({ status: 500, json: failure }),
  );
  await page.goto('/login');
  await expect(page.getByText('加载二维码失败：服务器内部错误', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '钉钉登录二维码' })).toHaveCount(0);
  await page.unroute('**/api/auth/dingtalk/start');
  await page.getByRole('button', { name: '立即重试' }).click();
  await expect(page.getByRole('img', { name: '钉钉登录二维码' })).toBeVisible();
  await expect(page.getByText('加载二维码失败：服务器内部错误')).toHaveCount(0);
});

test('登录已过期（这次登录的 state 对不上）：失败浮层并回到二维码', async ({ page }) => {
  await openLogin(page);
  const body = await page.evaluate(async () => {
    const res = await fetch('/api/dev/dingtalk/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'liting' }),
    });
    return (await res.json()) as unknown;
  });
  const { authCode } = devDingtalkScanResponseSchema.parse(body);
  await page.goto(`/login/dingtalk?authCode=${encodeURIComponent(authCode)}&state=not-this-one`);
  await expect(page).toHaveURL((url) => url.pathname === '/login');
  await expect(page.getByText('登录失败：登录已过期', { exact: true })).toBeVisible();
  await expect(page.getByText('请重新扫码。', { exact: true })).toBeVisible();
});

test('连不上钉钉：失败浮层写下一步，回到二维码', async ({ page }) => {
  const unavailable = loginFailedSchema.parse({
    error: 'login_failed',
    reason: 'dingtalk_unavailable',
    message: '暂时连不上钉钉',
  });
  await page.route('**/api/auth/dingtalk/login', (route) =>
    route.fulfill({ status: 502, json: unavailable }),
  );
  await scan(page, 'liting');
  await expect(page).toHaveURL((url) => url.pathname === '/login');
  await expect(page.getByText('登录失败：暂时连不上钉钉', { exact: true })).toBeVisible();
  await expect(
    page.getByText('请稍后重新扫码；仍不行请联系管理员。', { exact: true }),
  ).toBeVisible();
});

test('回调地址缺授权码或 state：直接回到二维码', async ({ page }) => {
  await page.goto('/login/dingtalk');
  await expect(page).toHaveURL((url) => url.pathname === '/login');
  await expect(page.getByRole('img', { name: '钉钉登录二维码' })).toBeVisible();
});

test.describe('真实钉钉的扫码登录框（DTFrameLogin，接口桩）', () => {
  /** 开登录的接口桩：钉钉用真实接口时的参数 */
  async function realStart(page: Page, baseURL: string | undefined) {
    const start = dingtalkLoginStartSchema.parse({
      mode: 'real',
      clientId: 'dingclientid',
      redirectUri: new URL('/login/dingtalk', baseURL).toString(),
      state: 'real-state',
    });
    await page.route('**/api/auth/dingtalk/start', (route) =>
      route.fulfill({ status: 200, json: start }),
    );
    return start;
  }

  test('钉钉的登录框加载不出来：失败浮层「登录失败：暂时连不上钉钉」+「立即重试」', async ({
    page,
    baseURL,
  }) => {
    await realStart(page, baseURL);
    await page.route(DINGTALK_SCRIPT, (route) => route.abort());
    await page.goto('/login');
    await expect(page.getByTestId('login-qr')).toHaveAttribute('data-mode', 'real');
    await expect(page.getByText('登录失败：暂时连不上钉钉', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '立即重试' })).toBeVisible();
  });

  test('把授权参数交给钉钉的登录框；扫码确认后照它给的地址带到回调页换会话', async ({
    page,
    baseURL,
  }) => {
    const start = await realStart(page, baseURL);
    // 钉钉登录框的替身：记下参数，测试里再模拟「扫码确认」
    await page.route(DINGTALK_SCRIPT, (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.DTFrameLogin = function (frame, params, onSuccess) {
          var el = document.getElementById(frame.id);
          el.setAttribute('data-params', JSON.stringify(params));
          el.setAttribute('data-size', frame.width + 'x' + frame.height);
          window.__confirmScan = onSuccess;
        };`,
      }),
    );
    await page.goto('/login');
    const frame = page.getByTestId('login-qr').locator('[data-params]');
    await expect(frame).toHaveAttribute('data-size', '168x168');
    expect(JSON.parse((await frame.getAttribute('data-params')) ?? '{}')).toEqual({
      redirect_uri: encodeURIComponent(start.redirectUri),
      client_id: 'dingclientid',
      scope: 'openid',
      response_type: 'code',
      state: 'real-state',
      prompt: 'consent',
    });
    // 扫码确认：钉钉交回带授权码的地址，浏览器被带到回调页；这次的 state 是接口桩给的，服务端那边对不上
    await page.evaluate(
      (redirectUri) =>
        (
          window as unknown as {
            __confirmScan: (result: {
              redirectUrl: string;
              authCode: string;
              state: string;
            }) => void;
          }
        ).__confirmScan({
          redirectUrl: `${redirectUri}?authCode=real-code&state=real-state`,
          authCode: 'real-code',
          state: 'real-state',
        }),
      start.redirectUri,
    );
    await expect(page.getByText('登录失败：登录已过期', { exact: true })).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === '/login');
  });
});
