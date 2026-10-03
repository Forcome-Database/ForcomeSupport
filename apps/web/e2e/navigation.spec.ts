import { expect, test, type Page } from '@playwright/test';

/*
 * 外壳（待办 04）：按角色的导航与默认首页（PRD 4.1 第一阶段表）、无权限页面 G2（AC-ST-03）、
 * 密度切换并保存在服务端（AC-ST-04、G9）与保存失败的浮层（G5）、退出登录、
 * 只有生产厂对接人角色的成员登录被拒（AC-P1-21、G12）。
 * 开发测试环境长期运行、数据会累积：改了密度的用例最后改回舒适，开头也不假定当前是哪一档。
 */

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

async function logout(page: Page): Promise<void> {
  await page
    .getByRole('banner')
    .getByRole('button', { name: /售后负责人|客服主管|坐席|管理员|知识库负责人/ })
    .click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/dev-login$/);
}

const navLinks = (page: Page) => page.getByRole('navigation', { name: '导航' }).getByRole('link');

test('各角色登录后进入自己的默认首页，导航只有第一期有权限的入口', async ({ page }) => {
  const table: [string, string, string[]][] = [
    ['李婷', '/tickets', ['工单', '售后']],
    ['周敏', '/tickets', ['工单', '售后', '报表']],
    ['王磊', '/aftersales/ledger', ['工单', '售后', '报表']],
    ['赵倩', '/reports', ['工单', '报表']],
    ['刘洋', '/reports', ['报表', '设置']],
  ];
  for (const [name, home, nav] of table) {
    await loginAs(page, name);
    await expect(page).toHaveURL((url) => url.pathname === home);
    await expect(navLinks(page)).toHaveText(nav);
    // 当前页面对应的入口标为当前项
    await expect(navLinks(page).and(page.locator('[aria-current="page"]'))).toHaveCount(1);
    // 第一阶段顶栏不显示店铺范围切换与全局搜索
    await expect(page.getByRole('banner').getByRole('searchbox')).toHaveCount(0);
    await logout(page);
  }
});

test('坐席从链接打开设置页显示无权限，只能返回首页（AC-ST-03、G2）', async ({ page }) => {
  await loginAs(page, '李婷');
  await page.goto('/settings');

  await expect(page.getByText('没有访问权限')).toBeVisible();
  await expect(
    page.getByText('「渠道与店铺」只对管理员开放。你当前的角色是坐席，如需开通请联系管理员刘洋。'),
  ).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('link')).toHaveText(['返回首页']);
  await expect(main.getByRole('button')).toHaveCount(0);

  await main.getByRole('link', { name: '返回首页' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/tickets');
  await expect(page.getByText('没有访问权限')).toHaveCount(0);
});

async function chooseDensity(page: Page, label: '舒适' | '紧凑'): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: /周敏/ }).click();
  await page.getByRole('menuitem', { name: /密度/ }).click();
  await page.getByRole('menuitemradio', { name: label }).click();
  await page.keyboard.press('Escape');
}

const density = (page: Page) => page.locator('html').getAttribute('data-density');
const bodyFontSize = (page: Page) => page.evaluate(() => getComputedStyle(document.body).fontSize);

/** 打开头像菜单量「审计日志」菜单项的字号，再关上 */
async function menuItemFontSize(page: Page): Promise<string> {
  await page.getByRole('banner').getByRole('button', { name: /周敏/ }).click();
  const size = await page
    .getByRole('menuitem', { name: /审计日志/ })
    .evaluate((el) => getComputedStyle(el).fontSize);
  await page.keyboard.press('Escape');
  return size;
}

test('密度切到紧凑后，刷新与重新登录都保持（AC-ST-04、G9）', async ({ page }) => {
  await loginAs(page, '周敏');
  await chooseDensity(page, '舒适');
  await expect.poll(() => density(page)).toBe('comfortable');
  expect(await bodyFontSize(page)).toBe('13px');

  expect(await menuItemFontSize(page)).toBe('13px');

  await chooseDensity(page, '紧凑');
  await expect.poll(() => density(page)).toBe('compact');
  // 设计规范第 12 节紧凑档：正文 12（页面正文与菜单项都随之变化）
  expect(await bodyFontSize(page)).toBe('12px');
  expect(await menuItemFontSize(page)).toBe('12px');

  await page.reload();
  await expect(page.getByRole('banner').getByText('周敏')).toBeVisible();
  expect(await density(page)).toBe('compact');

  await logout(page);
  await loginAs(page, '周敏');
  expect(await density(page)).toBe('compact');
  expect(await bodyFontSize(page)).toBe('12px');

  // 顶栏「密度」按钮在两档之间切换
  await page.getByRole('button', { name: /^密度：紧凑/ }).click();
  await expect.poll(() => density(page)).toBe('comfortable');
  await page.reload();
  await expect(page.getByRole('banner').getByText('周敏')).toBeVisible();
  expect(await density(page)).toBe('comfortable');
});

test('头像菜单：审计日志、密度、退出登录', async ({ page }) => {
  await loginAs(page, '王磊');
  await page.getByRole('banner').getByRole('button', { name: /王磊/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText('售后负责人 · FSH / 售后部')).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([/审计日志/, /密度/, '退出登录']);

  await menu.getByRole('menuitem', { name: /审计日志/ }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/audit');
  // 审计日志不是导航入口，没有当前项
  await expect(page.locator('nav [aria-current="page"]')).toHaveCount(0);

  await logout(page);
  await page.goto('/reports');
  await expect(page).toHaveURL(/\/dev-login$/);
});

test('只有生产厂对接人角色的成员登录被拒，显示无法进入（AC-P1-21、G12）', async ({ page }) => {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: /陈工/ }).click();

  await expect(page.getByText('暂时无法进入')).toBeVisible();
  await expect(page.getByText('工厂工作台第二阶段上线，目前无法进入。')).toBeVisible();
  await expect(page.getByText('陈工 · FQD / 品质部 · 生产厂对接人')).toBeVisible();

  await page.getByRole('button', { name: '返回登录页' }).click();
  await expect(page.getByRole('heading', { name: '开发登录' })).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/dev-login$/);
});

/** 让偏好保存接口按顺序给出的结果：'500' 失败、'401' 会话已结束、'ok' 放行；'slow500' 等 release() 后才失败 */
async function scriptPreferences(page: Page, script: ('500' | '401' | 'ok' | 'slow500')[]) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/me/preferences', async (route) => {
    const next = script.shift() ?? 'ok';
    if (next === 'ok') return route.continue();
    if (next === 'slow500') await gate;
    const status = next === '401' ? 401 : 500;
    const body =
      status === 401
        ? { error: 'session_expired', message: '7 天未操作，已退出登录' }
        : { error: 'internal', message: '服务器内部错误' };
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { release };
}

const toasts = (page: Page) => page.locator('[data-sonner-toast]');

test('密度保存失败：弹出不自动消失的失败浮层，点「立即重试」成功后浮层消失、密度保持（G5）', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await chooseDensity(page, '舒适');
  await expect.poll(() => density(page)).toBe('comfortable');
  const { release } = await scriptPreferences(page, ['500', 'slow500', '500', 'ok']);
  const saved = () => page.waitForResponse('**/api/me/preferences');

  await page.getByRole('button', { name: /^密度：舒适/ }).click();
  const toast = toasts(page);
  await expect(toast).toContainText('保存失败：服务器内部错误');
  await expect(toast).toContainText('密度已恢复为「舒适」，重试成功后改为「紧凑」。');
  expect(await density(page)).toBe('comfortable');
  // 失败浮层不自动消失（成功与信息才 3 秒消失）
  await page.waitForTimeout(3500);
  await expect(toast).toBeVisible();

  // 重试中：处理中、不能重复点；再失败：标题换成「保存仍失败」，浮层留着
  const retry = toast.getByRole('button', { name: '立即重试' });
  await retry.click();
  await expect(retry).toHaveAttribute('aria-busy', 'true');
  release();
  await expect(toast).toContainText('保存仍失败：服务器内部错误');
  await expect(retry).not.toHaveAttribute('aria-busy');

  // 同一件事再失败：替换旧浮层（不叠一条），也不沿用上一条的「仍失败」
  const failedAgain = saved();
  await page.getByRole('button', { name: /^密度：舒适/ }).click();
  await failedAgain;
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText('保存失败：服务器内部错误');
  await expect(toast).not.toContainText('仍失败');

  // 再重试成功：浮层消失，改为紧凑
  await toast.getByRole('button', { name: '立即重试' }).click();
  await expect(toast).toHaveCount(0);
  await expect.poll(() => density(page)).toBe('compact');

  // 重试保存到了服务端：刷新后仍是紧凑；最后改回舒适
  await page.unroute('**/api/me/preferences');
  await page.reload();
  await expect(page.getByRole('banner').getByText('周敏')).toBeVisible();
  expect(await density(page)).toBe('compact');
  await chooseDensity(page, '舒适');
  await expect.poll(() => density(page)).toBe('comfortable');
});

test('重试时会话已结束（401）：浮层撤掉，回到登录入口', async ({ page }) => {
  await loginAs(page, '周敏');
  await chooseDensity(page, '舒适');
  await expect.poll(() => density(page)).toBe('comfortable');
  await scriptPreferences(page, ['500', '401']);

  await page.getByRole('button', { name: /^密度：舒适/ }).click();
  await expect(toasts(page)).toContainText('保存失败：服务器内部错误');
  await toasts(page).getByRole('button', { name: '立即重试' }).click();

  await expect(page).toHaveURL(/\/dev-login$/);
  await expect(toasts(page)).toHaveCount(0);
});
