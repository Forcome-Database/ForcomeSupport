import { expect, test, type Browser, type Page } from '@playwright/test';

/*
 * P20 团队与权限（待办 06；PRD P20「第一阶段」v2.24、K6、K17 与 P20 补充小样、G2、G7、G8，AC-ST-06）：
 * 成员表与角色权限页签、非管理员无权限、「从钉钉添加」（必填与报错、角色里没有生产厂对接人、添加后以该成员开发登录进入默认首页）、
 * 格内修改与吸底保存栏（已修改、摘要、成功浮层、只剩一个角色不能取消）、保存时的报错、离开本页（G8）、并发（G7）、断网后自动重试（K6），
 * 以及 P27 点成员进 P20 选中该行。
 * 开发测试环境长期运行、数据会累积：用例只动示例数据里新入职待添加的吴桐（钉钉用户 ID wutong），开头经开发工具
 * 「模拟离职后又回到通讯录」（POST /api/dev/dingtalk/rejoin）让他回到没有角色的样子，「添加成员」每次都能重复执行；
 * 示例成员只改不存（放弃或报错不保存）。接口调用在页面里 fetch（与页面同一个会话）。
 */

const NEWCOMER = '吴桐';
const NEWCOMER_ID = 'wutong';

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

/** 让吴桐回到「钉钉通讯录里、还没分配角色」的样子（开发工具：模拟离职后又回到通讯录） */
async function resetNewcomer(page: Page): Promise<void> {
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

/** 经接口把吴桐设成已添加的样子（坐席、只限 Forcome Direct），供后面的用例改他 */
async function addNewcomerByApi(page: Page): Promise<void> {
  await resetNewcomer(page);
  const status = await page.evaluate(async (name) => {
    const json = async (res: Response) => {
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res.json() as Promise<Record<string, unknown>>;
    };
    const { candidates } = (await json(await fetch('/api/org/team/candidates'))) as unknown as {
      candidates: { id: string; name: string }[];
    };
    const { stores } = (await json(await fetch('/api/org/team'))) as unknown as {
      stores: { id: string; name: string }[];
    };
    const res = await fetch('/api/org/team/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        memberId: candidates.find((c) => c.name === name)?.id,
        roles: ['agent'],
        stores: { all: false, storeIds: [stores.find((s) => s.name === 'Forcome Direct')?.id] },
      }),
    });
    return res.status;
  }, NEWCOMER);
  expect(status).toBe(201);
}

const row = (page: Page, name: string) =>
  page.getByTestId('team-row').filter({ hasText: new RegExp(`^.?${name}`) });
const saveBar = (page: Page) => page.getByTestId('save-bar');
const drawer = (page: Page) => page.getByRole('dialog');

async function openTeam(page: Page): Promise<void> {
  await page.goto('/settings/team');
  await expect(page.getByRole('heading', { name: '团队与权限' })).toBeVisible();
  await expect(page.getByTestId('team-row').first()).toBeVisible();
}

test('P20 成员表（参照图 P20_SettingsTeam）：页头、页签、示例成员的各列，第一阶段没有「语言」列，保存栏没有修改', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await openTeam(page);
  await expect(
    page.getByText(
      '成员与部门来自钉钉通讯录；在这里分配角色与店铺数据范围。钉钉离职的成员自动停用。',
    ),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: /成员 \d+/ })).toHaveAttribute('data-state', 'active');
  await expect(page.getByText(/^\d+ 人 · 来自钉钉通讯录，(\S+ )?\d{2}:\d{2} 同步$/)).toBeVisible();
  const headers = page.getByTestId('team-table').getByRole('columnheader');
  await expect(headers).toHaveText(['成员', '钉钉部门', '角色', '数据范围', '状态', '最近登录']);

  const liting = row(page, '李婷');
  await expect(liting).toContainText('liting@forcome.com');
  await expect(liting).toContainText('FSH / 客服部');
  await expect(liting).toContainText('坐席');
  await expect(liting).toContainText('全部店铺');
  await expect(liting).toContainText('已启用');
  await expect(row(page, '刘洋')).toContainText('刘洋（我）');
  // 生产厂对接人不在 P20（随第二期 P24）
  await expect(page.getByTestId('team-row').filter({ hasText: '陈工' })).toHaveCount(0);

  await expect(saveBar(page)).toContainText('没有未保存的修改');
  await expect(saveBar(page)).toContainText('角色与数据范围的修改在这里统一保存');
  await expect(saveBar(page).getByRole('button', { name: '保存' })).toBeDisabled();
  await expect(saveBar(page).getByRole('button', { name: '放弃' })).toBeDisabled();
});

test('「角色权限」页签（K17 第一阶段）：由能力矩阵渲染，只列第一期已上线的 13 项能力', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await openTeam(page);
  await page.getByRole('tab', { name: '角色权限' }).click();
  const matrix = page.getByTestId('permission-matrix');
  await expect(page.getByText('只读 · 第一阶段只显示已上线的能力')).toBeVisible();
  await expect(matrix.getByRole('rowheader')).toHaveCount(13);
  await expect(matrix.getByRole('rowheader', { name: '新建登记（手工登记）' })).toBeVisible();
  await expect(
    matrix.getByRole('rowheader', { name: '渠道与店铺（P18）、成员与角色、店铺数据范围（P20）' }),
  ).toBeVisible();
  // 第二期的能力不出现
  await expect(matrix.getByText('提交审批单；提交时同时创建售后单（路径 B）')).toHaveCount(0);
  await expect(matrix.getByRole('columnheader', { name: '生产厂对接人' })).toBeVisible();
});

test('非管理员访问 P20 显示无权限（G2）', async ({ page }) => {
  await loginAs(page, '周敏');
  await page.goto('/settings/team');
  await expect(
    page.getByText(
      '「团队与权限」只对管理员开放。你当前的角色是客服主管，如需开通请联系管理员刘洋。',
    ),
  ).toBeVisible();
  await expect(page.getByRole('main').getByRole('link')).toHaveText(['返回首页']);
  await expect(page.getByTestId('team-table')).toHaveCount(0);
});

test('从钉钉添加（AC-ST-06）：不填时一次报全；角色里没有生产厂对接人；分配后以该成员登录进入默认首页、只看到授权店铺', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await resetNewcomer(page);
  await openTeam(page);
  await page.getByRole('button', { name: '从钉钉添加' }).click();
  await expect(drawer(page).getByRole('heading', { name: '从钉钉添加成员' })).toBeVisible();
  // 角色只有五个，没有生产厂对接人
  const roleBoxes = drawer(page).getByRole('group', { name: '角色' }).getByRole('checkbox');
  await expect(roleBoxes).toHaveCount(5);
  await expect(drawer(page).getByText('生产厂对接人')).toHaveCount(0);

  await drawer(page).getByRole('button', { name: '保存' }).click();
  for (const message of ['请选择成员', '请至少选择一个角色', '请选择数据范围']) {
    await expect(drawer(page).getByText(message, { exact: true })).toBeVisible();
  }
  // 定位到第一个错误：成员
  const memberPicker = drawer(page).getByLabel(/^成员/);
  await expect(memberPicker).toBeFocused();

  await memberPicker.click();
  await page.getByPlaceholder('搜索姓名或邮箱').fill('wutong');
  await page.getByRole('option', { name: new RegExp(NEWCOMER) }).click();
  await drawer(page).getByRole('checkbox', { name: '售后负责人' }).click();
  await drawer(page).getByRole('radio', { name: '指定店铺' }).click();
  // 指定店铺却没勾：保存后报「请至少选择一个店铺」
  await drawer(page).getByRole('button', { name: '保存' }).click();
  await expect(drawer(page).getByText('请至少选择一个店铺', { exact: true })).toBeVisible();
  await drawer(page).getByRole('checkbox', { name: 'Forcome Direct' }).click();
  await drawer(page).getByRole('button', { name: '保存' }).click();

  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByText('已添加成员')).toBeVisible();
  await expect(
    page.getByText(
      new RegExp(`^${NEWCOMER} · 售后负责人，已记入审计日志（刘洋 \\d{2}:\\d{2}）。$`),
    ),
  ).toBeVisible();
  const added = row(page, NEWCOMER);
  await expect(added).toContainText('售后负责人');
  await expect(added).toContainText('Forcome Direct');

  // 以该成员开发登录：售后负责人的默认首页是登记台账（PRD 4.1），店铺筛选只有授权的店铺
  await page.context().clearCookies();
  await loginAs(page, NEWCOMER);
  await expect(page).toHaveURL((url) => url.pathname === '/aftersales/ledger');
  await expect(page.getByRole('banner').getByText('售后负责人')).toBeVisible();
  const stores = await page.evaluate(async () => {
    const res = await fetch('/api/channel/store-options');
    return ((await res.json()) as { stores: { name: string }[] }).stores.map((s) => s.name);
  });
  expect(stores).toEqual(['Forcome Direct']);
});

test('格内修改（K6）：改角色与数据范围 → 已修改与保存栏摘要 → 保存成功浮层；只剩一个角色时不能取消；改回原值不算修改', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await addNewcomerByApi(page);
  await openTeam(page);
  const newcomer = row(page, NEWCOMER);

  // 只剩一个角色：不能取消，悬停写原因
  await page.getByRole('button', { name: `修改${NEWCOMER}的角色` }).click();
  const only = page.getByRole('menuitemcheckbox', { name: '坐席' });
  await expect(only).toHaveAttribute('aria-disabled', 'true');
  await only.hover();
  await expect(page.getByRole('tooltip')).toHaveText('至少保留一个角色；不再需要的成员请停用');
  await page.getByRole('menuitemcheckbox', { name: '客服主管' }).click();
  await page.keyboard.press('Escape');
  await expect(newcomer).toContainText('客服主管');
  await expect(newcomer.getByText('已修改')).toHaveCount(1);
  await expect(saveBar(page)).toContainText('有 1 项未保存修改');

  await page.getByRole('button', { name: `修改${NEWCOMER}的数据范围` }).click();
  await page.getByRole('radio', { name: '全部店铺（含以后新增的）' }).click();
  await page.keyboard.press('Escape');
  await expect(newcomer.getByText('已修改')).toHaveCount(2);
  await expect(saveBar(page)).toContainText('有 2 项未保存修改');
  await expect(saveBar(page)).toContainText(
    `${NEWCOMER} 角色：坐席 → 坐席、客服主管；${NEWCOMER} 店铺范围：Forcome Direct → 全部店铺`,
  );

  // 改回原值不算修改
  await page.getByRole('button', { name: `修改${NEWCOMER}的数据范围` }).click();
  await page.getByRole('radio', { name: '指定店铺' }).click();
  await page.getByRole('checkbox', { name: 'Forcome Direct' }).click();
  await page.keyboard.press('Escape');
  await expect(saveBar(page)).toContainText('有 1 项未保存修改');

  await saveBar(page).getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('设置已保存')).toBeVisible();
  await expect(
    page.getByText(
      new RegExp(
        `^${NEWCOMER} 角色：坐席 → 坐席、客服主管，已记入审计日志（刘洋 \\d{2}:\\d{2}）。$`,
      ),
    ),
  ).toBeVisible();
  await expect(saveBar(page)).toContainText('没有未保存的修改');
  await expect(newcomer.getByText('已修改')).toHaveCount(0);
  await expect(newcomer).toContainText('客服主管');
});

test('保存时的报错写在格子下方：指定店铺没勾店铺、去掉最后一位在职管理员的「管理员」角色；整批不保存，放弃后恢复', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await addNewcomerByApi(page);
  await openTeam(page);

  await page.getByRole('button', { name: `修改${NEWCOMER}的数据范围` }).click();
  await page.getByRole('checkbox', { name: 'Forcome Direct' }).click();
  await page.keyboard.press('Escape');
  await expect(row(page, NEWCOMER)).toContainText('—');

  await page.getByRole('button', { name: '修改刘洋的角色' }).click();
  await page.getByRole('menuitemcheckbox', { name: '坐席' }).click();
  await page.getByRole('menuitemcheckbox', { name: '管理员' }).click();
  await page.keyboard.press('Escape');

  await saveBar(page).getByRole('button', { name: '保存' }).click();
  await expect(row(page, NEWCOMER).getByText('请至少选择一个店铺')).toBeVisible();
  await expect(row(page, '刘洋').getByText('至少要有一位在职的管理员')).toBeVisible();
  await expect(saveBar(page)).toContainText('有 2 项未保存修改');

  await saveBar(page).getByRole('button', { name: '放弃' }).click();
  await expect(saveBar(page)).toContainText('没有未保存的修改');
  await expect(row(page, '刘洋')).toContainText('管理员');
  await expect(row(page, NEWCOMER)).toContainText('Forcome Direct');
  await expect(page.getByText('请至少选择一个店铺')).toHaveCount(0);
});

test('有未保存的修改时离开本页（G8）：继续编辑留在本页；放弃修改后离开；切页签不算离开', async ({
  page,
}) => {
  await loginAs(page, '刘洋');
  await addNewcomerByApi(page);
  await openTeam(page);
  await page.getByRole('button', { name: `修改${NEWCOMER}的角色` }).click();
  await page.getByRole('menuitemcheckbox', { name: '知识库负责人' }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: '角色权限' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(saveBar(page)).toContainText('有 1 项未保存修改');
  await page.getByRole('tab', { name: /成员/ }).click();

  await page
    .getByRole('navigation', { name: '设置' })
    .getByRole('link', { name: '渠道与店铺' })
    .click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('heading', { name: '离开前保存修改？' })).toBeVisible();
  await expect(dialog).toContainText(
    '「团队与权限」有 1 项未保存的修改。放弃后恢复为上次保存的值。',
  );
  await expect(dialog.getByRole('button', { name: '继续编辑' })).toBeFocused();
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await expect(page).toHaveURL(/\/settings\/team/);
  await expect(saveBar(page)).toContainText('有 1 项未保存修改');

  await page
    .getByRole('navigation', { name: '设置' })
    .getByRole('link', { name: '渠道与店铺' })
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click();
  await expect(page).toHaveURL(/\/settings\/channels/);
  await page.goto('/settings/team');
  await expect(row(page, NEWCOMER)).not.toContainText('知识库负责人');
});

async function adminPage(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const other = await context.newPage();
  await loginAs(other, '刘洋');
  return other;
}

/** 另一位管理员（另一个浏览器）把吴桐的角色改成这些并保存 */
async function otherAdminSetsRoles(
  browser: Browser,
  baseURL: string | undefined,
  toggle: string,
): Promise<void> {
  const other = await adminPage(browser, baseURL);
  await openTeam(other);
  await other.getByRole('button', { name: `修改${NEWCOMER}的角色` }).click();
  await other.getByRole('menuitemcheckbox', { name: toggle }).click();
  await other.keyboard.press('Escape');
  await saveBar(other).getByRole('button', { name: '保存' }).click();
  await expect(other.getByText('设置已保存')).toBeVisible();
  await other.context().close();
}

async function editScope(page: Page, option: '全部店铺（含以后新增的）' | 'Forcome Direct') {
  await page.getByRole('button', { name: `修改${NEWCOMER}的数据范围` }).click();
  if (option === 'Forcome Direct') {
    await page.getByRole('radio', { name: '指定店铺' }).click();
    await page.getByRole('checkbox', { name: 'Forcome Direct' }).click();
  } else {
    await page.getByRole('radio', { name: option }).click();
  }
  await page.keyboard.press('Escape');
}

test('并发（G7）：别人先保存了，整批不保存并给横幅；覆盖保存（二次确认）用我的修改覆盖；查看最新放弃这个人的修改', async ({
  page,
  browser,
  baseURL,
}) => {
  await loginAs(page, '刘洋');
  await addNewcomerByApi(page);
  await openTeam(page);
  await editScope(page, '全部店铺（含以后新增的）');
  await otherAdminSetsRoles(browser, baseURL, '客服主管');

  await saveBar(page).getByRole('button', { name: '保存' }).click();
  const alert = page.getByRole('alert').filter({ hasText: '刚被' });
  await expect(alert).toContainText(new RegExp(`${NEWCOMER}刚被刘洋修改（\\d{2}:\\d{2}）`));
  await expect(alert).toContainText(
    '刘洋改了：角色。你的修改还没保存，已保留在表格中；可先查看最新内容再改，或用你的内容覆盖。',
  );
  await expect(saveBar(page)).toContainText('有 1 项未保存修改');

  // 覆盖保存：二次确认（默认焦点在「取消」）后用我的修改覆盖
  await alert.getByRole('button', { name: '覆盖保存' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('heading', { name: '覆盖刘洋的修改？' })).toBeVisible();
  await expect(confirm.getByRole('button', { name: '取消' })).toBeFocused();
  await confirm.getByRole('button', { name: '覆盖保存' }).click();
  await expect(page.getByText('设置已保存')).toBeVisible();
  await expect(alert).toHaveCount(0);
  await expect(saveBar(page)).toContainText('没有未保存的修改');
  await expect(row(page, NEWCOMER)).toContainText('全部店铺');

  // 再冲突一次，这回「查看最新」：放弃这个人的修改，表格换成最新的
  await editScope(page, 'Forcome Direct');
  await otherAdminSetsRoles(browser, baseURL, '售后负责人');
  await saveBar(page).getByRole('button', { name: '保存' }).click();
  await alert.getByRole('button', { name: '查看最新' }).click();
  await expect(alert).toHaveCount(0);
  await expect(saveBar(page)).toContainText('没有未保存的修改');
  await expect(row(page, NEWCOMER)).toContainText('售后负责人');
  await expect(row(page, NEWCOMER)).toContainText('全部店铺');
});

test('断网（K6）：保存时断网保留修改，恢复后自动重试并保存', async ({ page, context }) => {
  await loginAs(page, '刘洋');
  await addNewcomerByApi(page);
  await openTeam(page);
  await page.getByRole('button', { name: `修改${NEWCOMER}的数据范围` }).click();
  await page.getByRole('radio', { name: '全部店铺（含以后新增的）' }).click();
  await page.keyboard.press('Escape');

  await context.setOffline(true);
  await saveBar(page).getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('网络已断开，暂未保存')).toBeVisible();
  await expect(
    page.getByText('修改已保留在页面上。恢复连接后自动重试保存，无需手动操作。'),
  ).toBeVisible();
  await expect(page.getByText('等待网络恢复…')).toBeVisible();
  await expect(saveBar(page)).toContainText('有 1 项未保存修改');

  await context.setOffline(false);
  await expect(page.getByText('已自动重试并保存')).toBeVisible();
  await expect(
    page.getByText(
      new RegExp(
        `^\\d{2}:\\d{2} 网络恢复后重试成功：${NEWCOMER} 店铺范围：Forcome Direct → 全部店铺，已记入审计日志。$`,
      ),
    ),
  ).toBeVisible();
  await expect(page.getByText('网络已断开，暂未保存')).toHaveCount(0);
  await expect(saveBar(page)).toContainText('没有未保存的修改');
  await expect(row(page, NEWCOMER)).toContainText('全部店铺');
});

test('P27 点成员进 P20 并选中该行（PRD P27 v2.24）', async ({ page }) => {
  await loginAs(page, '刘洋');
  await addNewcomerByApi(page);
  await page.goto(`/audit?q=${encodeURIComponent(NEWCOMER)}`);
  const record = page.getByRole('row').filter({ hasText: '添加成员' }).first();
  await record.getByRole('link', { name: NEWCOMER }).click();
  await expect(page).toHaveURL(/\/settings\/team\?member=/);
  await expect(row(page, NEWCOMER)).toHaveAttribute('aria-selected', 'true');
});
