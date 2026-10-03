import { expect, test } from '@playwright/test';

/*
 * 冒烟（待办 02 验收、03 号待办部署后自动运行）：开发登录 → 打开首页 → 看到顶栏。
 * 成员来自示例数据夹具（王磊 · 售后负责人）。
 */
test('未登录时进入开发登录页；选一位成员登录后打开首页，看到顶栏', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/dev-login$/);
  await expect(page.getByRole('heading', { name: '开发登录' })).toBeVisible();

  await page.getByRole('button', { name: /王磊/ }).click();

  await expect(page).toHaveURL(/:\d+\/$/);
  const topbar = page.getByRole('banner');
  await expect(topbar).toBeVisible();
  await expect(topbar.getByText('Forcome', { exact: true })).toBeVisible();
  await expect(topbar.getByText('王磊')).toBeVisible();
  await expect(topbar.getByText('售后负责人')).toBeVisible();

  // 会话在服务端，刷新后仍是登录状态
  await page.reload();
  await expect(page.getByRole('banner').getByText('王磊')).toBeVisible();
});

test('已登录时打开开发登录页以外的地址不会被带回登录页', async ({ page }) => {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: /周敏/ }).click();
  await expect(page.getByRole('banner').getByText('客服主管')).toBeVisible();

  await page.goto('/');
  await expect(page).not.toHaveURL(/dev-login/);
  await expect(page.getByRole('banner').getByText('周敏')).toBeVisible();
});
