import { expect, test, type Page } from '@playwright/test';

/*
 * P13 登记台账与新建登记（待办 19；PRD P13「第一阶段」、S13、S14，AC-P1-17、AC-P1-18）。
 * 开发测试环境长期运行、数据会累积，售后单又不能删：新建的那张用带时间戳的客户名找回来，每次部署多一张进行中的测试单；
 * 校验的用例保存不成功，不留数据。
 */

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

const drawer = (page: Page) => page.getByRole('dialog');

/** 下拉的名字是字段名，旁边带灰字说明的（负责人、生产厂）按开头匹配 */
async function choose(page: Page, label: string, option: string): Promise<void> {
  await drawer(page)
    .getByRole('combobox', { name: new RegExp(`^${label}`) })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

const textbox = (page: Page, name: string) =>
  drawer(page).getByRole('textbox', { name, exact: true });

test('售后负责人新建一张寄配件登记，保存后在台账里看到它（S14）', async ({ page }) => {
  const customer = `E2E 冒烟 ${Date.now()}`;
  await loginAs(page, '王磊');
  await page.goto('/aftersales/ledger');
  await expect(page.getByRole('heading', { name: '登记台账' })).toBeVisible();
  await expect(
    page.getByText('售后单的处理方式、费用与承担比例 · 第一阶段由客服主管、售后负责人手工登记'),
  ).toBeVisible();

  await page.getByRole('button', { name: '新建登记' }).click();
  await expect(drawer(page).getByRole('heading', { name: '新建登记' })).toBeVisible();
  await drawer(page)
    .getByRole('radio', { name: /寄配件/ })
    .click();

  // 选店铺：站点带出店铺的默认站点；forcome.com 只有王磊一位售后负责人，默认他（AC-P1-18）
  await choose(page, '店铺', 'forcome.com');
  await expect(drawer(page).getByRole('combobox', { name: '站点', exact: true })).toHaveText('US');
  await expect(drawer(page).getByRole('combobox', { name: /^负责人/ })).toHaveText(
    '王磊（售后负责人）',
  );
  await expect(drawer(page).getByText('该店铺唯一的售后负责人，已默认')).toBeVisible();
  await textbox(page, '订单号').fill('#1063');
  await textbox(page, '客户').fill(customer);

  // 选「产品质量问题」：三组比例按种子数据预填 FSH 0 / 工厂 100
  await choose(page, '责任类型', '产品质量问题');
  for (const group of ['产品成本', '快递物流', '其他费用']) {
    await expect(textbox(page, `${group} FSH %`)).toHaveValue('0');
    await expect(textbox(page, `${group} 工厂 %`)).toHaveValue('100');
  }
  // 改一侧，另一侧自动补足 100
  await textbox(page, '快递物流 工厂 %').fill('50');
  await expect(textbox(page, '快递物流 FSH %')).toHaveValue('50');
  await textbox(page, '快递物流 工厂 %').fill('100');

  // 寄配件：选配件后生产厂按配件 SKU 预填
  await choose(page, '配件', 'HEPA 滤芯组件 FC-V2-HF01');
  await expect(drawer(page).getByRole('combobox', { name: /^生产厂/ })).toHaveText('FQD');
  await expect(drawer(page).getByText('按配件 FC-V2-HF01 预填')).toBeVisible();
  await choose(page, '发货方', '易仓');
  await textbox(page, '承运方式').fill('UPS Ground');
  await textbox(page, '产品成本').fill('3.20');
  await textbox(page, '运费').fill('6.80');
  await textbox(page, '额外赔偿').fill('0');
  await textbox(page, '其他').fill('0');
  await expect(drawer(page).getByText('费用合计 $10.00')).toBeVisible();
  await expect(drawer(page).getByText('FSH 合计 $0.00 · 工厂合计 $10.00')).toBeVisible();

  await drawer(page).getByRole('button', { name: '保存登记' }).click();
  await expect(page.getByText('登记已保存')).toBeVisible();
  await expect(drawer(page)).toBeHidden();

  const row = page.getByTestId('ledger-row').filter({ hasText: customer });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/S-\d{8}-\d{4}/);
  await expect(row).toContainText('forcome.com · US');
  await expect(row).toContainText('寄配件');
  await expect(row).toContainText('产品质量问题');
  await expect(row).toContainText('进行中');
  await expect(row).toContainText('$3.20');
  await expect(row).toContainText('$6.80');
});

test('保存时校验全部：额外赔偿为 0、比例 130、「其他」未填理由一次报出并定位到第一个错误；关闭时提示未保存（S14、AC-P1-17）', async ({
  page,
}) => {
  await loginAs(page, '周敏');
  await page.goto('/aftersales/ledger');
  await expect(page.getByTestId('ledger-row').first()).toBeVisible();
  const rowsBefore = await page.getByTestId('ledger-row').count();
  await page.getByRole('button', { name: '新建登记' }).click();
  await drawer(page)
    .getByRole('radio', { name: /退款或部分补偿/ })
    .click();
  await choose(page, '店铺', 'forcome.mx');
  // forcome.mx 只有王磊有数据范围：客服主管登记时默认王磊（AC-P1-18）
  await expect(drawer(page).getByRole('combobox', { name: /^负责人/ })).toHaveText(
    '王磊（售后负责人）',
  );
  await expect(drawer(page).getByRole('combobox', { name: '站点', exact: true })).toHaveText('MX');
  await textbox(page, '订单号').fill('#2001');
  await textbox(page, '客户').fill('E2E 校验');
  await choose(page, '责任类型', '其他');
  // 三组各 50 / 50：有工厂比例，生产厂适用（S14 的示例里已选 FQD）
  await expect(drawer(page).getByText('工厂比例大于 0 时必填')).toBeVisible();
  await choose(page, '生产厂', 'FQD');
  await textbox(page, '产品成本 工厂 %').fill('130');
  await expect(textbox(page, '产品成本 FSH %')).toHaveValue('');
  await expect(drawer(page).getByText('有比例错误，合计暂不计算')).toBeVisible();
  await textbox(page, '额外赔偿').fill('0');

  await drawer(page).getByRole('button', { name: '保存登记' }).click();
  await expect(drawer(page).getByText('有 3 项需要修改')).toBeVisible();
  await expect(
    drawer(page).getByText('已滚动到第一个错误「责任理由」；改完后再点「保存登记」。'),
  ).toBeVisible();
  await expect(drawer(page).getByText('责任为「其他」时须填写理由')).toBeVisible();
  await expect(drawer(page).getByText('比例为 0–100 的整数')).toBeVisible();
  await expect(
    drawer(page).getByText('部分补偿、免退货退款的款项记在额外赔偿，须大于 0'),
  ).toBeVisible();
  await expect(drawer(page).getByRole('textbox', { name: '责任理由' })).toBeFocused();
  await expect(drawer(page).getByText('责任为「其他」时须填写理由')).toBeInViewport({ ratio: 1 });
  await expect(drawer(page).getByText('保存按钮保持可点，点击后定位到第一个错误')).toBeVisible();

  // 改了哪个字段就撤掉它的错误
  await drawer(page).getByRole('textbox', { name: '责任理由' }).fill('双方分摊');
  await expect(drawer(page).getByText('有 2 项需要修改')).toBeVisible();

  // 关闭抽屉：有未保存的输入先确认（G8），放弃后不保存
  await page.keyboard.press('Escape');
  const leave = page.getByRole('alertdialog');
  await expect(leave.getByText('「新建登记」填写的内容还没保存，放弃后不保留。')).toBeVisible();
  await leave.getByRole('button', { name: '放弃修改' }).click();
  await expect(drawer(page)).toBeHidden();
  await expect(page.getByTestId('ledger-row')).toHaveCount(rowsBefore);
});

test('保存后定位到靠近底部的错误：横幅出现后，出错的金额框与下方的报错都完整可见（S14、AC-P1-17）', async ({
  page,
}) => {
  await loginAs(page, '王磊');
  await page.goto('/aftersales/ledger');
  await page.getByRole('button', { name: '新建登记' }).click();
  await drawer(page)
    .getByRole('radio', { name: /退款或部分补偿/ })
    .click();
  await choose(page, '店铺', 'forcome.com');
  await textbox(page, '订单号').fill('#2002');
  await textbox(page, '客户').fill('E2E 定位');
  await choose(page, '责任类型', '客户使用问题');
  for (const fee of ['产品成本', '运费', '额外赔偿', '其他']) await textbox(page, fee).fill('0');

  // 只有最下面一节的「额外赔偿」不对：保存后顶部出横幅，定位到它
  await drawer(page).getByRole('button', { name: '保存登记' }).click();
  await expect(drawer(page).getByText('有 1 项需要修改')).toBeVisible();
  const compensation = textbox(page, '额外赔偿');
  await expect(compensation).toBeFocused();
  await expect(compensation).toBeInViewport({ ratio: 1 });
  await expect(
    drawer(page).getByText('部分补偿、免退货退款的款项记在额外赔偿，须大于 0'),
  ).toBeInViewport({ ratio: 1 });

  // 不保存：关闭时放弃
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click();
  await expect(drawer(page)).toBeHidden();
});

/** 抽屉里一个下拉的位置（左上角与尺寸） */
async function boxOf(page: Page, name: RegExp) {
  const box = await drawer(page).getByRole('combobox', { name }).boundingBox();
  if (!box) throw new Error(`找不到下拉 ${String(name)}`);
  return box;
}

test('责任与承担比例一节的布局：物流问题时索赔对象与索赔状态另起一行并排，责任类型右侧是生产厂或留空（S14 补充小样）', async ({
  page,
}) => {
  await loginAs(page, '王磊');
  await page.goto('/aftersales/ledger');
  await page.getByRole('button', { name: '新建登记' }).click();
  await drawer(page)
    .getByRole('radio', { name: /调整安装方式/ })
    .click();

  // 其他处理方式不受影响：产品质量问题时生产厂在责任类型右侧同一行，没有索赔字段
  await choose(page, '责任类型', '产品质量问题');
  let responsibility = await boxOf(page, /^责任类型/);
  const factory = await boxOf(page, /^生产厂/);
  expect(Math.abs(factory.y - responsibility.y)).toBeLessThan(1);
  expect(factory.x).toBeGreaterThan(responsibility.x + responsibility.width);
  await expect(drawer(page).getByRole('combobox', { name: /^索赔/ })).toHaveCount(0);

  // 物流问题：三组都是 FSH 100，生产厂不显示，责任类型右侧留空；两个索赔下拉在下一行并排
  await choose(page, '责任类型', '物流问题');
  await expect(drawer(page).getByRole('combobox', { name: /^生产厂/ })).toHaveCount(0);
  responsibility = await boxOf(page, /^责任类型/);
  let target = await boxOf(page, /^索赔对象/);
  let status = await boxOf(page, /^索赔状态/);
  expect(target.y).toBeGreaterThan(responsibility.y + responsibility.height);
  expect(Math.abs(target.x - responsibility.x)).toBeLessThan(1);
  expect(Math.abs(status.y - target.y)).toBeLessThan(1);
  expect(status.x).toBeGreaterThan(target.x + target.width);

  // 改出工厂比例：生产厂出现在责任类型右侧，两个索赔下拉仍在下一行并排
  await textbox(page, '产品成本 工厂 %').fill('50');
  const shown = await boxOf(page, /^生产厂/);
  responsibility = await boxOf(page, /^责任类型/);
  target = await boxOf(page, /^索赔对象/);
  status = await boxOf(page, /^索赔状态/);
  expect(Math.abs(shown.y - responsibility.y)).toBeLessThan(1);
  expect(shown.x).toBeGreaterThan(responsibility.x + responsibility.width);
  expect(target.y).toBeGreaterThan(responsibility.y + responsibility.height);
  expect(Math.abs(target.x - responsibility.x)).toBeLessThan(1);
  expect(Math.abs(status.y - target.y)).toBeLessThan(1);

  // 不保存：关闭时放弃
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click();
  await expect(drawer(page)).toBeHidden();
});

test('坐席只读查看台账：没有「新建登记」，不显示金额列（P13「第一阶段」）', async ({ page }) => {
  await loginAs(page, '李婷');
  await page.goto('/aftersales/ledger');
  await expect(page.getByText('售后单的处理方式与寄件登记 · 只读，不含财务字段')).toBeVisible();
  await expect(page.getByTestId('ledger-row').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '新建登记' })).toHaveCount(0);
  for (const column of ['售后单号', '客户', '店铺与站点', '处理方式', '责任', '状态']) {
    await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
  }
  for (const column of ['产品成本', '运费', '额外赔偿']) {
    await expect(page.getByRole('columnheader', { name: column })).toHaveCount(0);
  }
});
