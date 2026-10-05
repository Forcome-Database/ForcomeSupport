import { expect, test, type Page } from '@playwright/test';

/*
 * 台账的状态与编辑登记（待办 21；6.5「第一阶段台账状态」、PRD P13「第一阶段」、S13–S15 及补充小样，AC-AS-16、AC-AS-22、
 * AC-P1-19）：完整率与「筛出缺字段」、「缺 N 项」与「待回填」、行尾「更多」（设为已完成与撤销、取消售后单）、行内补登、
 * 编辑登记抽屉的三种形态（进行中编辑、已完成补登、只读）、修改汇率、G7。
 * 开发测试环境长期运行、数据会累积，售后单又不能删：每条用例先经接口登记一张自己的单（客户名带时间戳），在它上面操作；
 * 完整率的数字随环境里的单变化，只核对相对的变化与写法。接口调用在页面里 fetch（与页面同一个会话、同一套证书校验）。
 */

async function loginAs(page: Page, name: string): Promise<void> {
  await page.goto('/dev-login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();
}

const drawer = (page: Page) => page.getByRole('dialog');
/** 只读抽屉底部的「关闭」（右上角的 × 读屏名也叫「关闭」） */
const closeButton = (page: Page) =>
  drawer(page).locator('[data-slot=sheet-footer]').getByRole('button', { name: '关闭' });
const row = (page: Page, text: string) => page.getByTestId('ledger-row').filter({ hasText: text });

/** 北京时间的今天 */
function beijingToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

/** 一张登记要改的部分（其余是 forcome.com 的寄配件：产品质量问题、FQD、HEPA 滤芯组件 × 1、四项美元费用） */
interface Registration {
  readonly customer: string;
  readonly method?: 'send_parts' | 'refund_or_compensation';
  readonly shipDate?: string | null;
  readonly trackingNumber?: string;
  readonly compensation?: { amount: string; currency: 'USD' | 'MXN' };
}

/** 经接口登记一张单（登记人是当前登录的人，负责人王磊），返回售后单号 */
async function register(page: Page, input: Registration): Promise<string> {
  return page.evaluate(
    async ({ input, today }) => {
      const json = async (res: Response) => {
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        return res.json() as Promise<Record<string, unknown>>;
      };
      const stores = (await json(await fetch('/api/channel/store-options'))) as unknown as {
        stores: { id: string; name: string }[];
      };
      const options = (await json(
        await fetch('/api/aftersales/registration-options'),
      )) as unknown as {
        owners: { id: string; name: string }[];
      };
      const store = stores.stores.find((s) => s.name === 'forcome.com');
      const owner = options.owners.find((o) => o.name === '王磊');
      const refund = input.method === 'refund_or_compensation';
      const fee = (amount: string) => ({ amount, currency: 'USD' });
      const body = {
        method: input.method ?? 'send_parts',
        storeId: store?.id,
        site: 'US',
        orderNumber: '#1063',
        customerName: input.customer,
        sourceTicket: '',
        feeDate: today,
        ownerId: owner?.id,
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
        partSku: refund ? null : 'FC-V2-HF01',
        partQuantity: refund ? null : 1,
        shipper: refund ? null : 'yicang',
        carrier: refund ? '' : 'UPS Ground',
        shipDate: input.shipDate === undefined ? null : input.shipDate,
        trackingNumber: input.trackingNumber ?? '',
        fees: {
          productCost: fee('3.20'),
          freight: fee('6.80'),
          compensation: input.compensation ?? fee('0.00'),
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
    { input, today: beijingToday() },
  );
}

/** 经接口设为已完成（不撤销） */
async function completeViaApi(page: Page, number: string): Promise<void> {
  await page.evaluate(async (n) => {
    const detail = (await (await fetch(`/api/aftersales/${n}`)).json()) as { version: number };
    const res = await fetch(`/api/aftersales/${n}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: detail.version }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  }, number);
}

async function openLedger(page: Page): Promise<void> {
  await page.goto('/aftersales/ledger');
  await expect(page.getByTestId('ledger-row').first()).toBeVisible();
}

test('设为已完成：不要求齐全，标黄「待回填」与「缺 N 项」，5 秒内撤销回到进行中；完整率可筛出缺字段的单（S15 ①、AC-AS-22）', async ({
  page,
}) => {
  const customer = `E2E 完成 ${Date.now()}`;
  await loginAs(page, '王磊');
  const number = await register(page, { customer });
  await openLedger(page);

  // 进行中还没寄出：快递单号写「—」，不标待回填、没有补登（AC-AS-22）
  const mine = row(page, number);
  await expect(mine).toContainText('进行中');
  await expect(mine.getByText('待回填')).toHaveCount(0);
  await expect(mine.getByText(/^缺 \d+ 项$/)).toHaveCount(0);
  await expect(mine.getByRole('button', { name: '补登' })).toHaveCount(0);

  await mine.getByRole('button', { name: `${number} 的更多操作` }).click();
  await page.getByRole('menuitem', { name: '设为已完成' }).click();
  await expect(page.getByText(`${number} 已完成`)).toBeVisible();
  await expect(page.getByText('缺 2 项，已标黄待回填')).toBeVisible();
  await expect(mine).toContainText('已完成');
  await expect(mine.getByText('缺 2 项')).toBeVisible();
  await expect(mine.getByTitle('缺：寄出日期、快递单号（含隐藏列里的字段）')).toBeVisible();
  await expect(mine.getByText('待回填')).toBeVisible();

  // 完整率：点「筛出缺字段的 N 单」只列当月缺字段的已完成单，带筛选芯片与「清除筛选」
  await page.getByRole('button', { name: /月登记完整率/ }).click();
  await expect(page.getByText(/^缺字段的已完成单：/)).toBeVisible();
  await expect(row(page, number)).toBeVisible();
  await expect(page.getByTestId('ledger-row').filter({ hasText: '进行中' })).toHaveCount(0);

  // 撤销：回到进行中，不再标缺
  await page.getByRole('button', { name: '撤销' }).click();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(row(page, number)).toContainText('进行中');
  await expect(row(page, number).getByText(/^缺 \d+ 项$/)).toHaveCount(0);
});

test('行内补登：售后负责人点「补登」填快递单号，为空时「保存」禁用，保存后「缺 N 项」消失（S15 ③、AC-P1-19）', async ({
  page,
}) => {
  const customer = `E2E 补登 ${Date.now()}`;
  await loginAs(page, '王磊');
  const number = await register(page, { customer, shipDate: beijingToday() });
  await completeViaApi(page, number);
  await openLedger(page);

  const mine = row(page, number);
  await expect(mine.getByText('缺 1 项')).toBeVisible();
  await mine.getByRole('button', { name: '补登' }).click();
  const input = page.getByRole('textbox', { name: `${number} 的快递单号` });
  await expect(input).toBeFocused();
  await expect(mine.getByRole('button', { name: '保存' })).toBeDisabled();
  await input.fill('1Z4R28830358229088');
  await mine.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('已补登 · 已记入审计日志')).toBeVisible();
  await expect(page.getByText(`${number} 快递单号 1Z4R28830358229088`)).toBeVisible();
  await expect(mine).toContainText('1Z4R28830358229088');
  await expect(mine.getByText(/^缺 \d+ 项$/)).toHaveCount(0);
});

test('取消售后单：二次确认，原因必填，勾选保留的已产生费用；取消后只读（S15 ②、AC-AS-16）', async ({
  page,
}) => {
  const customer = `E2E 取消 ${Date.now()}`;
  await loginAs(page, '王磊');
  const number = await register(page, { customer });
  await openLedger(page);

  await row(page, number)
    .getByRole('button', { name: `${number} 的更多操作` })
    .click();
  await page.getByRole('menuitem', { name: '取消售后单' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(`取消 ${number}？`)).toBeVisible();
  await expect(dialog.getByText(`${customer} · 寄配件 · 产品质量问题`)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  // 已登记的四项都列出、默认全部保留
  for (const fee of ['产品成本', '运费', '额外赔偿', '其他']) {
    await expect(dialog.getByRole('checkbox', { name: `保留${fee}` })).toBeChecked();
  }
  await expect(dialog.getByText('$10.00')).toBeVisible();

  // 不填原因：报错，不取消
  await dialog.getByRole('button', { name: '取消售后单' }).click();
  await expect(dialog.getByText('请填写取消原因')).toBeVisible();
  await dialog.getByRole('textbox', { name: '取消原因' }).fill('客户撤回售后申请');
  await dialog.getByRole('checkbox', { name: '保留运费' }).click();
  await expect(dialog.getByText('$3.20', { exact: true }).last()).toBeVisible();
  await dialog.getByRole('button', { name: '取消售后单' }).click();
  await expect(page.getByText(`已取消售后单 ${number}`)).toBeVisible();
  await expect(row(page, number)).toContainText('已取消');

  // 已取消为终态：「更多」两项都禁用；抽屉只读，只有「关闭」
  await row(page, number)
    .getByRole('button', { name: `${number} 的更多操作` })
    .click();
  await expect(page.getByRole('menuitem', { name: '设为已完成' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');
  await row(page, number)
    .getByRole('button', { name: `打开 ${number} 的登记` })
    .click();
  await expect(closeButton(page)).toBeVisible();
  await expect(drawer(page).getByRole('button', { name: '保存修改' })).toHaveCount(0);
});

test('编辑登记：登记人修改进行中的单（寄出后补寄出日期与快递单号），保存后台账更新；有未保存的修改时关闭先确认（S14、G8）', async ({
  page,
}) => {
  const customer = `E2E 编辑 ${Date.now()}`;
  await loginAs(page, '王磊');
  const number = await register(page, { customer });
  await openLedger(page);

  await row(page, number)
    .getByRole('button', { name: `打开 ${number} 的登记` })
    .click();
  await expect(drawer(page).getByRole('heading', { name: `编辑登记 · ${number}` })).toBeVisible();
  await expect(drawer(page).getByText(`${customer} · forcome.com · US · 寄配件`)).toBeVisible();
  const tracking = drawer(page).getByRole('textbox', { name: '快递单号', exact: true });
  await expect(tracking).toBeEnabled();
  await tracking.fill('1Z-E2E-EDIT');
  // 有未保存的修改就关闭：G8 写有几项未保存
  await page.keyboard.press('Escape');
  await expect(
    page.getByText('「编辑登记」有 1 项未保存的修改。放弃后恢复为上次保存的值。'),
  ).toBeVisible();
  await page.getByRole('button', { name: '继续编辑' }).click();

  await drawer(page).getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText('登记已保存')).toBeVisible();
  await expect(page.getByText(`${number} · ${customer}，已记入审计日志。`)).toBeVisible();
  await expect(drawer(page)).toBeHidden();
  await expect(row(page, number)).toContainText('1Z-E2E-EDIT');
});

test('补登抽屉：已完成的单只有缺的字段可填，已填的锁定（S14 补充小样之三）', async ({ page }) => {
  const customer = `E2E 补登抽屉 ${Date.now()}`;
  await loginAs(page, '王磊');
  const number = await register(page, { customer, shipDate: beijingToday() });
  await completeViaApi(page, number);
  await openLedger(page);

  await row(page, number)
    .getByRole('button', { name: `打开 ${number} 的登记` })
    .click();
  await expect(drawer(page).getByRole('heading', { name: `编辑登记 · ${number}` })).toBeVisible();
  await expect(drawer(page).getByRole('textbox', { name: '客户', exact: true })).toBeDisabled();
  await expect(drawer(page).getByRole('textbox', { name: '承运方式', exact: true })).toBeDisabled();
  const tracking = drawer(page).getByRole('textbox', { name: '快递单号', exact: true });
  await expect(tracking).toBeEnabled();
  await tracking.fill('1Z-E2E-BACKFILL');
  await drawer(page).getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText('已补登 · 已记入审计日志')).toBeVisible();
  await expect(page.getByText(`${number} 补登了 快递单号`)).toBeVisible();
  await expect(row(page, number).getByText(/^缺 \d+ 项$/)).toHaveCount(0);
});

test('修改汇率：点开后金额框下变成「1 USD = [输入框] MXN」，随「保存修改」提交，台账写手工修改的汇率（S14 补充小样之三、v2.17）', async ({
  page,
}) => {
  const customer = `E2E 改汇率 ${Date.now()}`;
  await loginAs(page, '王磊');
  // 等 worker 的汇率同步写完（刚起服务时可能还在跑）
  await expect
    .poll(
      () =>
        page.evaluate(async (day) => {
          const res = await fetch(`/api/aftersales/exchange-rates?date=${day}`);
          const body = (await res.json()) as { rates?: { MXN: unknown } };
          return body.rates?.MXN ?? null;
        }, beijingToday()),
      { timeout: 30_000 },
    )
    .not.toBeNull();
  const number = await register(page, {
    customer,
    method: 'refund_or_compensation',
    compensation: { amount: '889.00', currency: 'MXN' },
  });
  await openLedger(page);

  await row(page, number)
    .getByRole('button', { name: `打开 ${number} 的登记` })
    .click();
  await expect(
    drawer(page).getByText(/≈ \$49\.39 · 汇率 \d\d-\d\d（1 USD = 18\.00 MXN）/),
  ).toBeVisible();
  await expect(
    drawer(page).getByText('取费用发生日的欧洲央行日汇率；只有售后负责人可改，记入审计日志'),
  ).toBeVisible();
  await drawer(page).getByRole('button', { name: '修改汇率' }).click();
  const rate = drawer(page).getByRole('textbox', { name: '额外赔偿的汇率' });
  await expect(rate).toHaveValue('18.00');
  await rate.fill('17.5');
  await expect(drawer(page).getByText('费用合计 $60.80')).toBeVisible();
  await drawer(page).getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText('登记已保存')).toBeVisible();
  await expect(row(page, number)).toContainText('$50.80');
  await expect(
    row(page, number).getByTitle(
      '汇率为手工修改：1 USD = 17.50 MXN（售后负责人修改，已记入审计日志）',
    ),
  ).toBeVisible();
});

test('有人先保存了：保存时顶部给 G7 横幅，「查看最新」换成最新内容（G7）', async ({ page }) => {
  const customer = `E2E 冲突 ${Date.now()}`;
  await loginAs(page, '王磊');
  const number = await register(page, { customer });
  await openLedger(page);
  await row(page, number)
    .getByRole('button', { name: `打开 ${number} 的登记` })
    .click();
  await drawer(page).getByRole('textbox', { name: '快递单号', exact: true }).fill('1Z-MINE');

  // 别人（这里用同一个人在别处）先保存了承运方式
  await page.evaluate(async (n) => {
    const detail = (await (await fetch(`/api/aftersales/${n}`)).json()) as { version: number };
    await fetch(`/api/aftersales/${n}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: detail.version, changes: { carrier: 'UPS Standard' } }),
    });
  }, number);

  await drawer(page).getByRole('button', { name: '保存修改' }).click();
  await expect(drawer(page).getByText(/^这条记录刚被王磊修改/)).toBeVisible();
  await expect(drawer(page).getByText(/王磊改了：承运方式。/)).toBeVisible();
  await drawer(page).getByRole('button', { name: '查看最新' }).click();
  await expect(drawer(page).getByRole('textbox', { name: '承运方式', exact: true })).toHaveValue(
    'UPS Standard',
  );
  await expect(drawer(page).getByRole('textbox', { name: '快递单号', exact: true })).toHaveValue(
    '',
  );
});

test('客服主管：已完成的单没有补登入口，抽屉只读；别人登记的进行中单不能设为已完成（悬停写原因）（AC-P1-19、S15 补充小样）', async ({
  page,
}) => {
  const customer = `E2E 主管 ${Date.now()}`;
  await loginAs(page, '王磊');
  const done = await register(page, { customer: `${customer} 已完成` });
  await completeViaApi(page, done);
  const open = await register(page, { customer: `${customer} 进行中` });

  await loginAs(page, '周敏');
  await openLedger(page);
  await expect(row(page, done).getByText('待回填')).toBeVisible();
  await expect(row(page, done).getByRole('button', { name: '补登' })).toHaveCount(0);
  await row(page, done)
    .getByRole('button', { name: `打开 ${done} 的登记` })
    .click();
  await expect(drawer(page).getByRole('textbox', { name: '快递单号', exact: true })).toBeDisabled();
  await expect(drawer(page).getByRole('button', { name: '保存修改' })).toHaveCount(0);
  await closeButton(page).click();

  await row(page, open)
    .getByRole('button', { name: `${open} 的更多操作` })
    .click();
  const item = page.getByRole('menuitem', { name: '设为已完成' });
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await item.hover();
  await expect(page.getByText('只有登记人或负责人可以设为已完成').first()).toBeVisible();
  // 进行中的单客服主管可以取消
  await expect(page.getByRole('menuitem', { name: '取消售后单' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('坐席：看得到完整率与「缺 N 项」，没有「更多」；点售后单号只读查看，不含比例与费用（S13 坐席视角）', async ({
  page,
}) => {
  await loginAs(page, '李婷');
  await openLedger(page);
  await expect(
    page
      .getByRole('button', { name: /月登记完整率/ })
      .or(page.getByTitle(/已完成售后单中适用字段齐全的比例/)),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /的更多操作$/ })).toHaveCount(0);
  await row(page, 'S-20260911-0020')
    .getByRole('button', { name: '打开 S-20260911-0020 的登记' })
    .click();
  await expect(
    drawer(page).getByRole('heading', { name: '编辑登记 · S-20260911-0020' }),
  ).toBeVisible();
  await expect(drawer(page).getByText('承担比例（三组）')).toHaveCount(0);
  await expect(drawer(page).getByText('费用（原币）')).toHaveCount(0);
  await expect(drawer(page).getByRole('combobox', { name: /^生产厂/ })).toHaveText('FQD');
  await expect(closeButton(page)).toBeVisible();
});
