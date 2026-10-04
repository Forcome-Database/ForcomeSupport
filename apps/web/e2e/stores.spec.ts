import { expect, test, type Page } from '@playwright/test';

/*
 * P18 渠道与店铺（待办 07；PRD P18「第一阶段」、K8、K20，AC-ST-01）：新增店铺抽屉的校验与保存、关闭抽屉前的未保存提示（G8）。
 * 开发测试环境长期运行、数据会累积，而店铺没有删除：测试店铺固定为「E2E 冒烟店铺」，只在还没有时新增；
 * 已经有了（之前部署的冒烟建过）就改为验证它的店铺名与邮箱重复报错，再编辑它保存——环境里最多多出这一个测试店铺。
 */

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

const drawer = (page: Page) => page.getByRole('dialog');

const E2E_STORE = 'E2E 冒烟店铺';
const E2E_MAILBOX = 'e2e-smoke@forcome.test';

async function chooseOption(page: Page, label: string, option: string): Promise<void> {
  await drawer(page).getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('管理员打开 P18：渠道卡与示例数据的 4 个店铺', async ({ page }) => {
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');

  await expect(page.getByRole('heading', { name: '渠道与店铺' })).toBeVisible();
  await expect(
    page.getByText('订单由平台直读；客户来信统一经 Gmail 收取。店铺决定订单匹配与数据权限。'),
  ).toBeVisible();
  for (const card of ['amazon', 'shopify', 'gmail', 'dingtalk']) {
    // 开发测试环境接的是模拟数据，卡头另标「模拟数据」（K20）
    await expect(page.getByTestId(`channel-card-${card}`).getByText('模拟数据')).toBeVisible();
  }
  await expect(page.getByText('第二阶段接入')).toHaveCount(2);
  const rows = page.getByTestId('store-row');
  for (const name of ['Forcome Direct', 'Forcome Auto', 'forcome.com', 'forcome.mx']) {
    await expect(rows.filter({ hasText: name }).first()).toBeVisible();
  }
  const direct = rows.filter({ hasText: 'amz-direct@forcome.com' });
  await expect(direct).toContainText('US · CA · MX');
  await expect(direct).toContainText('卖家 ID');
  await expect(direct).toContainText('A1FD7Q2M9XK3LC');
  await expect(direct).toContainText('已连接');
  // 「查看审计日志」随 30 号待办（P27）加上，在那之前不显示
  await expect(page.getByRole('button', { name: '查看审计日志' })).toHaveCount(0);
});

test('新增店铺：字段下方逐项报错、定位到第一个错误；改正后保存出现在店铺表（K8、AC-ST-01）', async ({
  page,
}) => {
  const stamp = Date.now();
  await loginAs(page, '刘洋');
  await page.goto('/settings/channels');
  const rows = page.getByTestId('store-row');
  await expect(rows.filter({ hasText: 'Forcome Direct' })).toBeVisible();
  const e2eRow = rows.filter({ hasText: E2E_MAILBOX });
  const alreadyCreated = (await e2eRow.count()) > 0;

  await page.getByRole('button', { name: '新增店铺' }).click();
  await expect(drawer(page).getByRole('heading', { name: '新增店铺' })).toBeVisible();
  // 非生产环境另有「数据来源」，新店铺默认模拟数据
  await expect(drawer(page).getByRole('radio', { name: '模拟数据' })).toBeChecked();

  // 什么都没填就保存：各项一次列全，定位到最上面的「平台」
  await drawer(page).getByRole('button', { name: '保存', exact: true }).click();
  for (const message of [
    '请选择平台',
    '请填写店铺名',
    '请选择站点',
    '请选择默认站点',
    '至少填写一个进线邮箱',
    '请填写平台标识',
  ]) {
    await expect(drawer(page).getByText(message, { exact: true })).toBeVisible();
  }
  await expect(drawer(page).getByRole('combobox', { name: '平台' })).toBeFocused();

  // 三类错误：店铺名重复、邮箱格式错误、平台标识为空，同时报出，定位到「店铺名」
  await chooseOption(page, '平台', 'Shopify');
  await drawer(page).getByRole('textbox', { name: '店铺名' }).fill('forcome.com');
  await drawer(page).getByRole('button', { name: '站点（多选）' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'MX' }).click();
  await page.keyboard.press('Escape');
  // 只选一个站点时默认站点自动带入
  await expect(drawer(page).getByRole('combobox', { name: '默认站点' })).toHaveText('MX');
  const mailboxes = drawer(page).getByRole('textbox', { name: '进线邮箱（可填多个，含别名）' });
  await mailboxes.fill('info@forcome');
  await drawer(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(drawer(page).getByText('店铺名已存在，请换一个')).toBeVisible();
  await expect(drawer(page).getByText('邮箱格式不正确，例如 info@forcome.mx')).toBeVisible();
  await expect(drawer(page).getByText('请填写店铺域名')).toBeVisible();
  await expect(drawer(page).getByRole('textbox', { name: '店铺名' })).toBeFocused();

  // 改正后填测试店铺
  await drawer(page).getByRole('textbox', { name: '店铺名' }).fill(E2E_STORE);
  await mailboxes.fill(E2E_MAILBOX);
  await mailboxes.press('Enter');
  await expect(drawer(page).getByTestId('mailbox-chip')).toHaveText([E2E_MAILBOX]);
  const platformId = drawer(page).getByRole('textbox', { name: '平台标识 · Shopify 店铺域名' });
  await platformId.fill(`e2e-${stamp}.myshopify.com`);
  await drawer(page).getByRole('button', { name: '保存', exact: true }).click();

  if (alreadyCreated) {
    // 之前的部署已经建过：同名、同邮箱各自报错，不保存；放弃后改为编辑它
    await expect(drawer(page).getByText('店铺名已存在，请换一个')).toBeVisible();
    await expect(
      drawer(page).getByText(`${E2E_MAILBOX} 已是 ${E2E_STORE} 的进线邮箱`),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click();
    await page.getByRole('button', { name: `编辑 ${E2E_STORE}` }).click();
    await drawer(page)
      .getByRole('textbox', { name: '平台标识 · Shopify 店铺域名' })
      .fill(`e2e-${stamp}.myshopify.com`);
    await drawer(page).getByRole('button', { name: '保存', exact: true }).click();
  }

  // 保存成功：抽屉关闭，成功浮层，店铺表里有测试店铺
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByText('店铺已保存')).toBeVisible();
  await expect(e2eRow).toContainText(E2E_STORE);
  await expect(e2eRow).toContainText('MX');
  await expect(e2eRow).toContainText(`e2e-${stamp}.myshopify.com`);
  await expect(e2eRow).toContainText('已连接');

  // 编辑时有未保存的修改，按 Esc 先确认（G8）；放弃后不保存
  await page.getByRole('button', { name: `编辑 ${E2E_STORE}` }).click();
  await expect(drawer(page).getByRole('heading', { name: '编辑店铺' })).toBeVisible();
  await drawer(page).getByRole('textbox', { name: '店铺名' }).fill(`${E2E_STORE} 改`);
  await page.keyboard.press('Escape');
  const leave = page.getByRole('alertdialog');
  await expect(leave.getByRole('heading', { name: '离开前保存修改？' })).toBeVisible();
  await expect(
    leave.getByText('「编辑店铺」有 1 项未保存的修改。放弃后恢复为上次保存的值。'),
  ).toBeVisible();
  await expect(leave.getByRole('button', { name: '继续编辑' })).toBeFocused();
  await leave.getByRole('button', { name: '放弃修改' }).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(rows.filter({ hasText: `${E2E_STORE} 改` })).toHaveCount(0);
});
