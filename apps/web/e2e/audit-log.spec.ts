import { expect, test, type Page } from '@playwright/test';

/*
 * P27 审计日志（待办 30；PRD P27「第一阶段」、10.2、K18 与补充小样、K5，AC-P1-20）：从头像菜单进入、点行展开两栏对照，
 * 只看自己的角色（坐席）的横幅与锁定的操作人、没有财务权限（管理员）的「已隐藏」与不可点的售后单编号、列表为空与清除筛选、
 * 自定义时间、导出，以及 P18 页头的入口与点进店铺、P13 点进售后单。
 * 开发测试环境长期运行、数据会累积：每条用例先经接口做一次自己的操作（客户名、店铺名带时间戳），按对象编号搜它。
 * 接口调用在页面里 fetch（与页面同一个会话、同一套证书校验）。
 */

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

/** 北京时间的今天 */
function beijingToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

/** 经接口新建一张寄配件单（forcome.com、负责人王磊、产品成本 $3.20、运费 $6.80、三组均工厂 100），返回售后单号 */
async function register(page: Page, customer: string): Promise<string> {
  return page.evaluate(
    async ({ customer, today }) => {
      const json = async (res: Response) => {
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        return res.json() as Promise<Record<string, unknown>>;
      };
      const { stores } = (await json(await fetch('/api/channel/store-options'))) as unknown as {
        stores: { id: string; name: string }[];
      };
      const { owners } = (await json(
        await fetch('/api/aftersales/registration-options'),
      )) as unknown as { owners: { id: string; name: string }[] };
      const fee = (amount: string) => ({ amount, currency: 'USD' });
      const body = {
        method: 'send_parts',
        storeId: stores.find((s) => s.name === 'forcome.com')?.id,
        site: 'US',
        orderNumber: '#1063',
        customerName: customer,
        sourceTicket: '',
        feeDate: today,
        ownerId: owners.find((o) => o.name === '王磊')?.id,
        responsibility: 'product_quality',
        responsibilityReason: '',
        factory: 'FQD',
        ratios: {
          product: { fsh: 0, factory: 100 },
          freight: { fsh: 0, factory: 100 },
          other: { fsh: 0, factory: 100 },
        },
        claimTarget: null,
        claimStatus: null,
        partSku: 'FC-V2-HF01',
        partQuantity: 1,
        shipper: 'yicang',
        carrier: 'UPS Ground',
        shipDate: null,
        trackingNumber: '',
        fees: {
          productCost: fee('3.20'),
          freight: fee('6.80'),
          compensation: fee('0.00'),
          otherCost: fee('0.00'),
        },
      };
      const created = await json(
        await fetch('/api/aftersales/registrations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      return created.number as string;
    },
    { customer, today: beijingToday() },
  );
}

const rows = (page: Page) => page.getByTestId('audit-row');
const expanded = (page: Page) => page.getByTestId('audit-expanded');
/** 展开里某一栏（0 变更前、1 变更后）某个字段那一行（字段名 + 值） */
const fieldRow = (pane: ReturnType<typeof expanded>, side: 0 | 1, label: string) =>
  pane.getByTestId(side === 0 ? 'audit-before' : 'audit-after').locator(`[data-field="${label}"]`);

test('从头像菜单进入 P27，搜对象编号，点行展开两栏对照完整前后值；售后单编号点进 P13 并打开该单（客服主管）', async ({
  page,
}) => {
  await loginAs(page, '王磊');
  const number = await register(page, `审计 ${Date.now()}`);

  await loginAs(page, '周敏');
  await page.getByRole('banner').getByRole('button', { name: /周敏/ }).click();
  await page.getByRole('menuitem', { name: /审计日志/ }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByRole('heading', { name: '审计日志' })).toBeVisible();
  await expect(page.getByText('全部操作记录 · 保留不少于 2 年')).toBeVisible();
  // 今天、看全部：没有「只能看自己」的横幅，操作人是可选的芯片
  await expect(page.getByRole('radio', { name: '今天' })).toHaveAttribute('data-state', 'on');
  await expect(page.getByText('你只能看到自己的操作记录')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^操作人：\s*全部$/ })).toBeVisible();
  await expect(page.getByText(/^共 \d+ 条 · 越权访问 \d+ 条 · 点行展开完整前后值$/)).toBeVisible();

  // 近 7 天：刚好跨过北京时间 0 点时，刚才的操作已不在「今天」里
  await page.getByRole('radio', { name: '近 7 天' }).click();
  await page.getByRole('searchbox', { name: '搜索对象编号' }).fill(number);
  await expect(page).toHaveURL(new RegExp(`period=week&q=${number}`));
  const row = rows(page).filter({ hasText: '新建登记' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('王磊');
  await expect(row).toContainText('售后负责人');
  await expect(row).toContainText(`售后单${number}`);
  await expect(row).toContainText(/状态：— → 进行中 等 \d+ 项/);

  await row.click();
  const pane = expanded(page);
  await expect(pane).toBeVisible();
  await expect(pane.getByText('变更前')).toBeVisible();
  await expect(pane.getByText('变更后')).toBeVisible();
  await expect(fieldRow(pane, 1, '状态')).toContainText('进行中');
  await expect(fieldRow(pane, 0, '状态')).toContainText('—');
  await expect(fieldRow(pane, 1, '产品成本')).toContainText('$3.20');
  await expect(fieldRow(pane, 1, '承担比例')).toContainText('三组均 FSH 0 / 工厂 100');
  await expect(pane.getByText(/· 王磊 · 售后负责人 · 来源 IP /)).toBeVisible();
  // 再点收起
  await row.click();
  await expect(expanded(page)).toHaveCount(0);

  await row.getByRole('link', { name: number }).click();
  await expect(page).toHaveURL(new RegExp(`/aftersales/ledger\\?open=${number}`));
  await expect(page.getByRole('dialog')).toContainText(number);
});

test('坐席只看到自己的操作记录：页头横幅，操作人锁定为本人（K18 ①、AC-P1-20）', async ({
  page,
}) => {
  await loginAs(page, '李婷');
  await page.goto('/audit');
  await expect(page.getByText('你只能看到自己的操作记录')).toBeVisible();
  await expect(
    page.getByText('操作人筛选已锁定为本人；客服主管与管理员可查看全部（10.2）。'),
  ).toBeVisible();
  const locked = page.getByTitle('你只能看到自己的操作记录');
  await expect(locked).toHaveText('操作人：李婷');
  // 刚登录的那一条在，且每一行都是李婷
  await expect(rows(page).filter({ hasText: '登录' }).first()).toBeVisible();
  const count = await rows(page).count();
  for (let i = 0; i < count; i += 1) await expect(rows(page).nth(i)).toContainText('李婷');
});

test('管理员没有财务权限：成本与比例的前后值「已隐藏」，售后单编号不可点（K18 ②、AC-P1-20）', async ({
  page,
}) => {
  await loginAs(page, '王磊');
  const number = await register(page, `审计隐藏 ${Date.now()}`);

  await loginAs(page, '刘洋');
  await page.goto(`/audit?period=week&q=${number}`);
  await expect(
    page.getByText(
      '你的角色没有财务权限：成本、承担比例、结算金额的前后值显示「已隐藏」，其他字段照常显示。',
    ),
  ).toBeVisible();
  const row = rows(page).filter({ hasText: '新建登记' });
  await expect(row.getByRole('link')).toHaveCount(0);
  await row.click();
  const pane = expanded(page);
  for (const label of ['产品成本', '运费', '承担比例']) {
    await expect(fieldRow(pane, 0, label)).toContainText('已隐藏');
    await expect(fieldRow(pane, 1, label)).toContainText('已隐藏');
  }
  await expect(fieldRow(pane, 1, '店铺')).toContainText('forcome.com');
  await expect(pane).not.toContainText('$3.20');
});

test('列表为空：说明写当前筛选，点「清除筛选」回到默认（补充小样 ②）', async ({ page }) => {
  await loginAs(page, '周敏');
  await page.goto('/audit?period=week&q=no-such-object');
  await expect(page.getByText('没有符合条件的操作记录')).toBeVisible();
  await expect(
    page.getByText('当前筛选：近 7 天 · 对象编号含「no-such-object」。换个条件试试，或清除筛选。'),
  ).toBeVisible();
  // 列表为空没有分页
  await expect(page.getByText(/每页 10 条/)).toHaveCount(0);
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByRole('radio', { name: '今天' })).toHaveAttribute('data-state', 'on');
  await expect(page.getByRole('searchbox', { name: '搜索对象编号' })).toHaveValue('');
});

test('时间：近 7 天表头写起止，时间列写「月-日 时:分」；自定义点开区间日历，选好起止即生效（补充小样 ④）', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await page.goto('/audit');
  await page.getByRole('radio', { name: '近 7 天' }).click();
  await expect(page).toHaveURL(/period=week/);
  await expect(page.getByRole('heading', { name: /至 .* 近 7 天$/ })).toBeVisible();
  await expect(rows(page).first().locator('td').first()).toHaveText(/^\d{2}-\d{2} \d{2}:\d{2}$/);

  await page.getByRole('radio', { name: '自定义' }).click();
  const calendar = page.getByRole('dialog', { name: '自定义的起止' });
  await expect(calendar).toBeVisible();
  await calendar.locator('td button').filter({ hasText: /^1$/ }).click();
  await expect(calendar).toBeVisible();
  await calendar.locator('td button').filter({ hasText: /^2$/ }).click();
  await expect(calendar).toHaveCount(0);
  await expect(page).toHaveURL(/period=custom&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole('radio', { name: '自定义' })).toHaveAttribute('data-state', 'on');
});

test('导出：按当前筛选生成后直接下载，浮层写文件名并已记入审计；导出本身出现在列表里（K5、补充小样 ③）', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await page.goto('/audit');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const file = await download;
  const today = beijingToday();
  const name = `审计日志_今天_${today.slice(5).replace('-', '')}.xlsx`;
  expect(file.suggestedFilename()).toBe(name);
  await expect(page.getByText(`已导出 ${name} · 已记入审计日志`)).toBeVisible();
  await page.goto(`/audit?period=week&type=export&q=${encodeURIComponent('审计日志')}`);
  await expect(rows(page).filter({ hasText: '导出 Excel' }).first()).toContainText(
    /筛选：今天（\d{4}-\d{2}-\d{2}） · \d+ 行/,
  );
});

test('分页：第一页的「上一页」禁用并悬停写原因', async ({ page }) => {
  await loginAs(page, '周敏');
  await page.goto('/audit');
  await expect(page.getByText(/^共 \d+ 条 · 每页 10 条$/)).toBeVisible();
  const prev = page.getByRole('button', { name: '上一页' });
  await expect(prev).toBeDisabled();
  await prev.locator('..').hover();
  await expect(page.getByRole('tooltip', { name: '已是第一页' })).toBeVisible();
});

test('P18 页头「查看审计日志」进入 P27；店铺编号点进 P18 并打开店铺抽屉（管理员）', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  const name = `审计店铺 ${Date.now()}`;
  await page.evaluate(async (storeName) => {
    const res = await fetch('/api/channel/stores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: storeName,
        platform: 'shopify',
        sites: ['US'],
        defaultSite: 'US',
        mailboxes: [`audit-${Date.now()}@forcome-e2e.com`],
        platformId: `audit-${Date.now()}.myshopify.com`,
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  }, name);

  await page.goto('/settings/channels');
  await page.getByRole('link', { name: '查看审计日志' }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await page.getByRole('radio', { name: '近 7 天' }).click();
  await page.getByRole('searchbox', { name: '搜索对象编号' }).fill(name);
  const row = rows(page).filter({ hasText: '新增店铺' });
  await expect(row).toContainText(`店铺${name}`);
  await row.getByRole('link', { name }).click();
  await expect(page).toHaveURL(/\/settings\/channels\?store=/);
  await expect(page.getByRole('dialog')).toContainText('编辑店铺');
  await expect(page.getByRole('dialog').getByLabel('店铺名')).toHaveValue(name);
});
