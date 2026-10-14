import { teamSchema, type Team } from '@forcome/contracts';
import { expect, test, type Page } from '@playwright/test';

/*
 * 成员停用与改派（待办 23；PRD P20「第一阶段」与 K10 第一阶段补充小样、P13「第一阶段」与 S15 补充小样 · 改派负责人与待分配、
 * 11.4，AC-ST-02、AC-ST-05）：P20 行尾「更多 → 停用」与停用弹窗（没人可接手时置灰并写原因；选接手人后改派并停用）、
 * P13「改派负责人」、「负责人：待分配」与改派队列的站内通知。
 * 开发测试环境长期运行、数据会累积，示例成员停用后回不来：真实的停用只核对「王磊是唯一的售后负责人」这种不改数据的情形，
 * 停用成功的路径用接口桩（真实的改派与停用由集成测试 member-handover.int.test.ts 覆盖）。改派队列用新入职待添加的吴桐：
 * 经接口给他售后负责人角色、登记一张他负责的单，再经开发工具「模拟回到通讯录」让他钉钉离职（单进改派队列）后恢复在职（角色清空），
 * 最后把单改派回王磊。接口调用在页面里 fetch（与页面同一个会话）。
 */

const NEWCOMER = '吴桐';
const NEWCOMER_ID = 'wutong';

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

/** 吴桐钉钉离职后又回到通讯录（开发工具）：在职、没有角色 */
async function rejoinNewcomer(page: Page): Promise<void> {
  const status = await page.evaluate(async (userId) => {
    const res = await fetch('/api/dev/dingtalk/rejoin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    return res.status;
  }, NEWCOMER_ID);
  expect(status).toBe(200);
}

/** 经接口把吴桐添加为售后负责人（全部店铺）；当前登录的要是管理员 */
async function addNewcomerAsOwner(page: Page): Promise<void> {
  const status = await page.evaluate(async (name) => {
    const res0 = await fetch('/api/org/team/candidates');
    const { candidates } = (await res0.json()) as { candidates: { id: string; name: string }[] };
    const res = await fetch('/api/org/team/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        memberId: candidates.find((c) => c.name === name)?.id,
        roles: ['aftersales_owner'],
        stores: { all: true },
      }),
    });
    return res.status;
  }, NEWCOMER);
  expect(status).toBe(201);
}

/** 北京时间的今天 */
function beijingToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

/** 经接口登记一张 forcome.com 的调整安装方式（负责人按姓名），返回售后单号 */
async function register(page: Page, customer: string, owner: string): Promise<string> {
  return page.evaluate(
    async ({ customer, owner, today }) => {
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
      const usd = (amount: string) => ({ amount, currency: 'USD' });
      const res = await fetch('/api/aftersales/registrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: 'adjust_installation',
          storeId: stores.find((s) => s.name === 'forcome.com')?.id,
          site: 'US',
          orderNumber: '#2301',
          customerName: customer,
          sourceTicket: '',
          feeDate: today,
          ownerId: owners.find((o) => o.name === owner)?.id,
          responsibility: 'customer_use',
          responsibilityReason: '',
          factory: null,
          ratios: {
            product: { fsh: 100, factory: 0 },
            freight: { fsh: 100, factory: 0 },
            other: { fsh: 100, factory: 0 },
          },
          claimTarget: null,
          claimStatus: null,
          partSku: null,
          partQuantity: null,
          shipper: null,
          carrier: '',
          shipDate: null,
          trackingNumber: '',
          fees: {
            productCost: usd('0.00'),
            freight: usd('0.00'),
            compensation: usd('5.00'),
            otherCost: usd('0.00'),
          },
        }),
      });
      return ((await json(res)) as { number: string }).number;
    },
    { customer, owner, today: beijingToday() },
  );
}

const teamRow = (page: Page, name: string) =>
  page.getByTestId('team-row').filter({ hasText: new RegExp(`^.?${name}`) });
const dialog = (page: Page) => page.getByRole('alertdialog');
const ledgerRow = (page: Page, text: string) =>
  page.getByTestId('ledger-row').filter({ hasText: text });

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  // 前面的用例（或上次中断的运行）留下的吴桐的角色清掉：环境里只有王磊一位售后负责人
  const page = await browser.newPage();
  await loginAs(page, '刘洋');
  await rejoinNewcomer(page);
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await loginAs(page, '刘洋');
  await rejoinNewcomer(page);
  await page.close();
});

test('P20 停用：王磊是唯一的售后负责人，「改派并停用」置灰并写原因；行尾「更多」不能停用自己（K10 第一阶段）', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await page.goto('/settings/team');

  // 自己：「停用」不可用，悬停写原因
  await teamRow(page, '刘洋').getByRole('button', { name: '刘洋 的更多操作' }).click();
  const self = page.getByRole('menuitem', { name: '停用' });
  await expect(self).toHaveAttribute('aria-disabled', 'true');
  await self.hover();
  await expect(page.getByRole('tooltip', { name: '不能停用自己' })).toBeVisible();
  // 先移开鼠标收起悬停说明，Esc 才关得掉菜单
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await teamRow(page, '王磊').getByRole('button', { name: '王磊 的更多操作' }).click();
  await page.getByRole('menuitem', { name: '停用' }).click();
  await expect(dialog(page)).toContainText('停用成员王磊？');
  await expect(dialog(page)).toContainText(
    '停用后王磊不能登录，现有会话立即失效；历史记录与操作日志保留。改派与停用记入审计日志。',
  );
  await expect(dialog(page)).toContainText('进行中售后单');
  await expect(dialog(page)).toContainText('王磊是唯一的售后负责人，没有其他人可接手');
  await expect(dialog(page)).toContainText('请先在成员表为其他成员分配售后负责人角色');
  await expect(dialog(page).getByRole('combobox')).toBeDisabled();
  await expect(dialog(page).getByRole('button', { name: '改派并停用' })).toBeDisabled();
  await dialog(page).getByRole('button', { name: '取消' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(teamRow(page, '王磊')).toContainText('已启用');
});

test('P20 停用：选好接手人后「改派并停用」，成员表随之更新（接口桩；没人覆盖全部店铺时按店铺各一个下拉）', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await page.goto('/settings/team');
  const team = teamSchema.parse(
    await page.evaluate(async () => (await fetch('/api/org/team')).json()),
  );
  const chenchen = team.members.find((m) => m.name === '陈晨')!;
  const [auto, direct] = ['Forcome Auto', 'Forcome Direct'].map((name) =>
    team.stores.find((s) => s.name === name)!,
  );
  const ids = ['0199a000-0000-7000-8000-0000000000a1', '0199a000-0000-7000-8000-0000000000a2'];
  const owner = (id: string, name: string, storeIds: string[]) => ({
    id,
    name,
    stores: { all: false, storeIds },
  });
  await page.route(`**/api/org/team/members/${chenchen.id}/handover`, (route) =>
    route.fulfill({
      json: {
        member: {
          id: chenchen.id,
          name: '陈晨',
          version: chenchen.version,
          aftersalesOwner: false,
        },
        cases: [
          { id: ids[0], number: 'S-20260911-0091', status: 'in_progress', store: auto, version: 0 },
          {
            id: ids[1],
            number: 'S-20260911-0092',
            status: 'in_progress',
            store: direct,
            version: 0,
          },
        ],
        owners: [
          owner('0199a000-0000-7000-8000-0000000000b1', '孙杰', [auto!.id]),
          owner('0199a000-0000-7000-8000-0000000000b2', '郑八', [direct!.id]),
        ],
      },
    }),
  );
  let submitted: unknown = null;
  const disabled: Team = {
    ...team,
    members: team.members.map((m) => (m.id === chenchen.id ? { ...m, status: 'disabled' } : m)),
  };
  await page.route(`**/api/org/team/members/${chenchen.id}/disable`, async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: disabled });
  });

  await teamRow(page, '陈晨').getByRole('button', { name: '陈晨 的更多操作' }).click();
  await page.getByRole('menuitem', { name: '停用' }).click();
  await expect(dialog(page)).toContainText('进行中售后单');
  await expect(dialog(page)).toContainText('2 张');
  await expect(dialog(page)).toContainText('S-20260911-0091');
  // 没选就提交：字段下写「请选择接手人」
  await dialog(page).getByRole('button', { name: '改派并停用' }).click();
  await expect(dialog(page)).toContainText('请选择接手人');
  expect(submitted).toBeNull();

  await dialog(page).getByLabel('接手人 · Forcome Auto').click();
  await page.getByRole('option', { name: '孙杰（售后负责人）' }).click();
  await dialog(page).getByLabel('接手人 · Forcome Direct').click();
  await page.getByRole('option', { name: '郑八（售后负责人）' }).click();
  await dialog(page).getByRole('button', { name: '改派并停用' }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText('已停用 陈晨')).toBeVisible();
  await expect(page.getByText('2 张售后单已改派给 孙杰、郑八，已记入审计日志。')).toBeVisible();
  expect(submitted).toEqual({
    version: chenchen.version,
    assignments: [
      { caseId: ids[0], ownerId: '0199a000-0000-7000-8000-0000000000b1' },
      { caseId: ids[1], ownerId: '0199a000-0000-7000-8000-0000000000b2' },
    ],
  });
  await expect(teamRow(page, '陈晨')).toContainText('已停用');
});

test('钉钉离职 → 售后单进改派队列（AC-ST-05）：客服主管收到通知，点进 P13「负责人：待分配」，改派负责人', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginAs(page, '刘洋');
  await addNewcomerAsOwner(page);

  await loginAs(page, '周敏');
  const customer = `Handover ${Date.now()}`;
  const number = await register(page, customer, NEWCOMER);
  // 吴桐钉钉离职（又回到通讯录，角色清空）：他负责的进行中售后单进改派队列
  await rejoinNewcomer(page);
  await expect
    .poll(
      async () =>
        page.evaluate(async (n) => {
          const res = await fetch('/api/aftersales/ledger?owner=pending');
          const body = (await res.json()) as { items: { number: string }[] };
          return body.items.some((item) => item.number === n);
        }, number),
      { timeout: 30_000 },
    )
    .toBe(true);

  await page.goto('/tickets');
  await page
    .getByRole('banner')
    .getByRole('button', { name: /站内通知/ })
    .click();
  const note = page
    .getByRole('dialog', { name: '通知' })
    .getByTestId('notification-item')
    .filter({ hasText: '吴桐已停用（钉钉离职），forcome.com 有 1 张进行中的售后单待分配负责人' })
    .first();
  await expect(note).toContainText('售后单待改派');
  await expect(note).toContainText('P13 · 待分配');
  await note.click();

  await expect(page).toHaveURL(/\/aftersales\/ledger\?owner=pending/);
  await expect(page.getByTestId('ledger-filters')).toContainText('负责人：待分配');
  await expect(ledgerRow(page, customer)).toBeVisible();

  // 负责人列（默认隐藏）：待分配，悬停写原负责人
  await page.getByRole('button', { name: '列设置', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: '负责人', exact: true }).click();
  await page.keyboard.press('Escape');
  const pending = ledgerRow(page, customer).getByText('待分配', { exact: true });
  await pending.hover();
  await expect(page.getByRole('tooltip', { name: '原负责人 吴桐 已停用' })).toBeVisible();

  await ledgerRow(page, customer)
    .getByRole('button', { name: `${number} 的更多操作` })
    .click();
  await page.getByRole('menuitem', { name: '改派负责人' }).click();
  await expect(dialog(page)).toContainText(`改派 ${number}？`);
  await expect(dialog(page)).toContainText('现在的负责人');
  await expect(dialog(page)).toContainText('待分配（原负责人 吴桐 已停用）');
  await expect(dialog(page)).toContainText('只列有该店铺范围的售后负责人');
  await dialog(page).getByLabel('接手人').click();
  await page.getByRole('option', { name: '王磊（售后负责人）' }).click();
  await dialog(page).getByRole('button', { name: '改派', exact: true }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText(`已改派 ${number}`)).toBeVisible();
  await expect(page.getByText('负责人：待分配 → 王磊，已记入审计日志。')).toBeVisible();
  // 出了改派队列
  await expect(ledgerRow(page, customer)).toHaveCount(0);
});

test('P13 已取消的单「改派负责人」禁用并悬停「这张单已取消」', async ({ page }) => {
  await loginAs(page, '周敏');
  const customer = `Cancelled ${Date.now()}`;
  const number = await register(page, customer, '王磊');
  await page.evaluate(async (n) => {
    const ledger = (await (await fetch('/api/aftersales/ledger')).json()) as {
      items: { number: string; version: number }[];
    };
    const item = ledger.items.find((i) => i.number === n)!;
    await fetch(`/api/aftersales/${n}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: item.version, reason: '客户撤回售后申请', keptFees: [] }),
    });
  }, number);
  await page.goto('/aftersales/ledger');
  await ledgerRow(page, customer)
    .getByRole('button', { name: `${number} 的更多操作` })
    .click();
  const reassign = page.getByRole('menuitem', { name: '改派负责人' });
  await expect(reassign).toHaveAttribute('aria-disabled', 'true');
  await reassign.hover();
  await expect(page.getByRole('tooltip', { name: '这张单已取消' })).toBeVisible();
});
