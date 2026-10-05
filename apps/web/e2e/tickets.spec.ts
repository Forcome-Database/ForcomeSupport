import { expect, test, type Page } from '@playwright/test';

/*
 * 来信到工单（待办 08）：worker 启动时 Fake Gmail 从示例数据夹具回放来信（邮箱开始监听后送达），
 * 经 Pub/Sub 拉取、同步入库、归并成「待回复」工单；坐席在 P04 看到它们（最简列表）。
 * 08 还没有自动刷新（SSE 随 18），刚启动时 worker 可能还没归并完，所以重新加载直到看到工单。
 * 开发测试环境长期运行：回放的来信按 Gmail 消息 ID 去重，重复部署不会多出工单，用例可以重复执行。
 */

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

test('坐席在 P04 看到示例来信归并成的「待回复」工单', async ({ page }) => {
  await loginAs(page, '李婷');
  await expect(page).toHaveURL((url) => url.pathname === '/tickets');
  await expect(page.getByRole('heading', { name: '工单' })).toBeVisible();
  await expect(page.getByText('全部渠道 · 全部店铺')).toBeVisible();

  const table = page.getByRole('table', { name: '工单列表' });
  await expect(table.getByRole('columnheader')).toHaveText([
    '工单号',
    '主题',
    '渠道与店铺',
    '客户',
    '状态',
    '最近来信',
  ]);

  const james = table.getByTestId('ticket-row').filter({ hasText: 'James Walker' });
  await expect(async () => {
    await page.reload();
    await expect(james).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });

  // 渠道识别随待办 10：先记「邮件」，站点取店铺默认站点
  await expect(james.getByRole('cell')).toHaveText([
    /^T-20260910-\d{4}$/,
    'Box arrived crushed, the vacuum is cracked',
    '邮件 USForcome Auto',
    'James Walker',
    '待回复',
    '09-10 08:15',
  ]);
  // P05 时间线那张工单：三封来信归到一张，编号日期取首封来信，最近来信是第三封
  await expect(
    table.getByTestId('ticket-row').filter({ hasText: 'Oliver Grant' }).getByRole('cell'),
  ).toHaveText([
    /^T-20260904-\d{4}$/,
    'Charger cable not working',
    // 亚马逊按发件域识别站点（CA）随待办 10，08 取店铺默认站点
    '邮件 USForcome Direct',
    'Oliver Grant',
    '待回复',
    '09-10 09:00',
  ]);
});
