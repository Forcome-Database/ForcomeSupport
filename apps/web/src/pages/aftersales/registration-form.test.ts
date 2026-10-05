import { costShares, emptyRegistrationInput, type AftersalesDetail } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { amountOfCents, centsOf } from '@/lib/cents';
import {
  amountText,
  changedFieldLabels,
  conversionOf,
  emptyRegistrationForm,
  factoryPercents,
  feeTotalCents,
  fieldLabel,
  FORM_ORDER,
  formErrorsOf,
  formValuesOf,
  groupCents,
  lockedFields,
  percentText,
  ratioFormOf,
  rateText,
  registrationInputOf,
  shareCents,
  shareTotalCents,
  withRatioSide,
  type FeeForm,
} from './registration-form';

const usd = (amount: string): FeeForm => ({ amount, currency: 'USD' });
/** 费用发生日 09-11 可用的演示汇率（当天还没公布，取 09-10） */
const DEMO_RATES = {
  MXN: { rate: '18.000000', date: '2026-09-10', source: 'ecb' as const },
  CAD: { rate: '1.360000', date: '2026-09-10', source: 'ecb' as const },
};

describe('新建登记的表单（S14）', () => {
  it('空表单交上去是空白的登记，只多了默认的费用发生日与数量', () => {
    expect(registrationInputOf(emptyRegistrationForm('2026-09-11'))).toEqual({
      ...emptyRegistrationInput(),
      feeDate: '2026-09-11',
      partQuantity: 1,
    });
  });

  it('改一侧比例另一侧自动补足 100；填错时另一侧清空（显示「—」）', () => {
    const side = { fsh: '', factory: '' };
    expect(withRatioSide(side, 'factory', '50')).toEqual({ fsh: '50', factory: '50' });
    expect(withRatioSide(side, 'fsh', '30')).toEqual({ fsh: '30', factory: '70' });
    expect(withRatioSide(side, 'factory', '130')).toEqual({ fsh: '', factory: '130' });
    expect(withRatioSide({ fsh: '0', factory: '100' }, 'factory', '')).toEqual({
      fsh: '',
      factory: '',
    });
  });

  it('比例只收数字（最多 3 位），金额只收数字与两位小数', () => {
    expect(percentText('1a3-0.5')).toBe('130');
    expect(amountText('12.345')).toBe('12.34');
    expect(amountText('-3.2.1x')).toBe('3.21');
    expect(amountText('889')).toBe('889');
    // 汇率（修改汇率）：数字与一个小数点，最多 6 位整数、6 位小数
    expect(rateText('17.5x')).toBe('17.5');
    expect(rateText('1234567.12345678')).toBe('123456.123456');
  });

  it('责任类型的默认比例写成两侧；各组的工厂比例只认填对的', () => {
    expect(ratioFormOf({ product: 100, freight: 100, other: 50 })).toEqual({
      product: { fsh: '0', factory: '100' },
      freight: { fsh: '0', factory: '100' },
      other: { fsh: '50', factory: '50' },
    });
    expect(
      factoryPercents({
        product: { fsh: '', factory: '130' },
        freight: { fsh: '30', factory: '' },
        other: { fsh: '', factory: '' },
      }),
    ).toEqual({ product: null, freight: 70, other: null });
  });

  it('接口的字段错误按抽屉自上而下排好，费用项写在金额框下；第一个错误的叫法', () => {
    const errors = formErrorsOf({
      'fees.compensation': '部分补偿、免退货退款的款项记在额外赔偿，须大于 0',
      'ratios.product.factory': '比例为 0–100 的整数',
      responsibilityReason: '责任为「其他」时须填写理由',
    });
    expect(errors.map((e) => e.field)).toEqual([
      'responsibilityReason',
      'ratios.product.factory',
      'fees.compensation.amount',
    ]);
    expect(errors.map((e) => fieldLabel(e.field))).toEqual([
      '责任理由',
      '承担比例（三组）',
      '额外赔偿',
    ]);
    expect(fieldLabel('sourceTicket')).toBe('来源工单');
  });

  it('抽屉的字段顺序：索赔对象与状态在责任理由之前（S14 自上而下），每个字段都有叫法', () => {
    expect(FORM_ORDER.slice(0, 13)).toEqual([
      'method',
      'storeId',
      'site',
      'orderNumber',
      'customerName',
      'sourceTicket',
      'feeDate',
      'ownerId',
      'responsibility',
      'factory',
      'claimTarget',
      'claimStatus',
      'responsibilityReason',
    ]);
    for (const field of FORM_ORDER) expect(fieldLabel(field), field).toBeTruthy();
  });

  it('比例表的金额：三组按费用项归组（其他费用 = 额外赔偿 + 其他），没填按 0', () => {
    const fees = {
      productCost: usd('3.20'),
      freight: usd('6.80'),
      compensation: usd(''),
      otherCost: usd('0'),
    };
    expect(groupCents(fees, undefined)).toEqual({ product: 320, freight: 680, other: 0 });
    expect(feeTotalCents(fees, undefined)).toBe(1000);
  });

  it('非美元按费用发生日的汇率折算成美元再算（R-FL-06）；汇率还没取到或没有时，这一组与合计写「—」', () => {
    const fees = {
      productCost: { amount: '12', currency: 'CAD' as const },
      freight: usd('6.80'),
      compensation: { amount: '889.00', currency: 'MXN' as const },
      otherCost: usd('0'),
    };
    // 889 ÷ 18 = 49.39，12 ÷ 1.36 = 8.82（四舍五入到分，与保存时冻结的美元值一致）
    expect(groupCents(fees, DEMO_RATES)).toEqual({ product: 882, freight: 680, other: 4939 });
    expect(feeTotalCents(fees, DEMO_RATES)).toBe(882 + 680 + 4939);
    expect(groupCents(fees, undefined)).toEqual({ product: null, freight: 680, other: null });
    expect(feeTotalCents(fees, { ...DEMO_RATES, MXN: null })).toBeNull();
    // 没填的不用汇率；填了 0 的非美元金额与保存时一样也要汇率（没有汇率时保存会报错，这里也算不出）
    const blank = { ...fees, productCost: { amount: '', currency: 'CAD' as const } };
    expect(groupCents(blank, undefined).product).toBe(0);
    const zero = { ...fees, productCost: { amount: '0', currency: 'CAD' as const } };
    expect(groupCents(zero, DEMO_RATES).product).toBe(0);
    expect(groupCents(zero, { ...DEMO_RATES, CAD: null }).product).toBeNull();
  });

  it('金额框下的折算：非美元且填了金额才有；汇率取不到时说明原因', () => {
    expect(conversionOf({ amount: '889.00', currency: 'MXN' }, DEMO_RATES)).toEqual({
      kind: 'converted',
      usd: '49.39',
      rate: DEMO_RATES.MXN,
    });
    expect(
      conversionOf({ amount: '889.00', currency: 'MXN' }, { ...DEMO_RATES, MXN: null }),
    ).toEqual({ kind: 'no_rate' });
    // 汇率还在取（undefined）、美元、没填、填错：不显示
    expect(conversionOf({ amount: '889.00', currency: 'MXN' }, undefined)).toBeNull();
    expect(conversionOf(usd('3.20'), DEMO_RATES)).toBeNull();
    expect(conversionOf({ amount: '', currency: 'MXN' }, DEMO_RATES)).toBeNull();
    expect(conversionOf({ amount: '1.234', currency: 'MXN' }, DEMO_RATES)).toBeNull();
  });

  it('两方承担：工厂按比例四舍五入到分，FSH = 金额 − 工厂', () => {
    expect(shareCents(320, 100)).toEqual({ fsh: 0, factory: 320 });
    expect(shareCents(1105, 50)).toEqual({ fsh: 552, factory: 553 });
    expect(shareCents(680, 0)).toEqual({ fsh: 680, factory: 0 });
  });

  it('「FSH 合计 · 工厂合计」按整行取整，与台账的承担金额（contracts 的 costShares）一致', () => {
    // 逐组取整再相加会得 3 + 3 = 6 分；整行：2.5 + 2.5 = 5 分
    expect(
      shareTotalCents(
        { product: 5, freight: 5, other: 0 },
        { product: 50, freight: 50, other: 50 },
      ),
    ).toEqual({ fsh: 5, factory: 5 });
    for (const [amounts, percents] of [
      [
        { product: 980, freight: 1360, other: 450 },
        { product: 100, freight: 0, other: 50 },
      ],
      [
        { product: 7, freight: 3, other: 1 },
        { product: 33, freight: 17, other: 51 },
      ],
    ] as const) {
      const row = costShares(
        {
          productCost: amountOfCents(amounts.product),
          freight: amountOfCents(amounts.freight),
          compensation: amountOfCents(amounts.other),
          otherCost: null,
        },
        percents,
      );
      expect(shareTotalCents(amounts, percents)).toEqual({
        fsh: centsOf(row.fsh!),
        factory: centsOf(row.factory!),
      });
    }
    expect(
      shareTotalCents(
        { product: 5, freight: null, other: 0 },
        { product: 50, freight: 50, other: 50 },
      ),
    ).toBeNull();
  });
});

/** 编辑登记的示例：进行中的 S-20260911-0020（退款或部分补偿，额外赔偿 MX$889.00，售后负责人手工改过汇率 17.50） */
const DETAIL: AftersalesDetail = {
  id: '0199a000-0000-7000-8000-000000000020',
  number: 'S-20260911-0020',
  status: 'in_progress',
  origin: 'manual_registration',
  version: 3,
  store: { id: '0199a000-0000-7000-8000-00000000000a', name: 'Forcome Direct' },
  site: 'MX',
  sourceTicket: null,
  orderNumber: '302-8811234-9901122',
  customerName: 'Mateo Rivas',
  registeredBy: { id: '0199a000-0000-7000-8000-000000000001', name: '王磊' },
  owner: { id: '0199a000-0000-7000-8000-000000000001', name: '王磊' },
  feeDate: '2026-09-10',
  completedAt: null,
  method: 'refund_or_compensation',
  responsibility: 'product_quality',
  responsibilityReason: null,
  factory: 'FQD',
  part: null,
  shipper: null,
  carrier: null,
  shipDate: null,
  trackingNumber: null,
  claimTarget: null,
  claimStatus: null,
  fees: {
    productCost: { amount: '0.00', currency: 'USD', usd: '0.00', rate: null },
    freight: { amount: '0.00', currency: 'USD', usd: '0.00', rate: null },
    compensation: {
      amount: '889.00',
      currency: 'MXN',
      usd: '50.80',
      rate: { rate: '17.500000', date: '2026-09-10', source: 'manual' },
    },
    otherCost: null,
  },
  ratios: {
    product: { fsh: 0, factory: 100 },
    freight: { fsh: 0, factory: 100 },
    other: { fsh: 0, factory: 100 },
  },
  missing: [],
  cancellation: null,
  updatedBy: '王磊',
  updatedAt: '2026-09-11T02:20:00.000Z',
};

describe('编辑登记的表单（S14 编辑登记、补充小样之三）', () => {
  it('一张单的登记写成表单值：没登记的为空，比例两侧，费用原币与币种', () => {
    const values = formValuesOf(DETAIL);
    expect(values).toMatchObject({
      method: 'refund_or_compensation',
      storeId: DETAIL.store.id,
      site: 'MX',
      orderNumber: '302-8811234-9901122',
      sourceTicket: '',
      feeDate: '2026-09-10',
      ownerId: DETAIL.owner?.id,
      factory: 'FQD',
      partSku: '',
      partQuantity: '',
      carrier: '',
      ratios: { product: { fsh: '0', factory: '100' } },
      fees: {
        compensation: { amount: '889.00', currency: 'MXN' },
        otherCost: { amount: '', currency: 'USD' },
      },
    });
    // 交上去就是原来的登记（不改就没有改动）
    expect(changedFieldLabels(values, formValuesOf(DETAIL))).toEqual([]);
  });

  it('补登只能填原来空着的字段：已填的锁定，空着的可填；进行中的编辑都不锁', () => {
    const base = formValuesOf({ ...DETAIL, status: 'completed', trackingNumber: null });
    const locked = lockedFields('backfill', base);
    expect(locked('customerName')).toBe(true);
    expect(locked('ratios')).toBe(true);
    expect(locked('fees.compensation')).toBe(true);
    expect(locked('fees.otherCost')).toBe(false);
    expect(locked('trackingNumber')).toBe(false);
    expect(locked('sourceTicket')).toBe(false);
    // 按 R-AS-08 算缺的项照样可填：退款的额外赔偿登记成 0（历史导入）
    const refund = formValuesOf({ ...DETAIL, status: 'completed' });
    expect(lockedFields('backfill', refund)('fees.compensation')).toBe(true);
    expect(lockedFields('backfill', refund, ['fees.compensation'])('fees.compensation')).toBe(
      false,
    );
    // 「配件 × 数量」缺：空着的那一项可填，已填的配件不跟着解锁
    const noQuantity = { ...base, partSku: 'FC-V2-HF01', partQuantity: '' };
    const part = lockedFields('backfill', noQuantity, ['part']);
    expect([part('partSku'), part('partQuantity')]).toEqual([true, false]);
    const open = lockedFields('edit', base);
    expect(open('customerName')).toBe(false);
    const readonly = lockedFields('readonly', base);
    expect(readonly('fees.otherCost')).toBe(true);
  });

  it('改动了哪些项（G7「对方改了哪些项」、G8 计数、补登浮层写补了什么）：字段名同抽屉', () => {
    const base = formValuesOf(DETAIL);
    const edited = {
      ...base,
      trackingNumber: '1Z-NEW',
      shipDate: '2026-09-12',
      ratios: { ...base.ratios, product: { fsh: '50', factory: '50' } },
      fees: { ...base.fees, otherCost: { amount: '0', currency: 'USD' as const } },
    };
    expect(changedFieldLabels(base, edited)).toEqual([
      '承担比例（三组）',
      '寄出日期',
      '快递单号',
      '其他',
    ]);
  });

  it('原来冻结的汇率：原币金额、币种与费用发生日都没改的项沿用它（含手工改过的汇率），改了的按费用发生日取', () => {
    const fees = formValuesOf(DETAIL).fees;
    const frozen = { frozen: DETAIL.fees ?? undefined };
    expect(
      conversionOf(fees.compensation, DEMO_RATES, { frozen: DETAIL.fees?.compensation }),
    ).toEqual({
      kind: 'converted',
      usd: '50.80',
      rate: { rate: '17.500000', date: '2026-09-10', source: 'manual' },
    });
    expect(groupCents(fees, DEMO_RATES, frozen).other).toBe(5080);
    const changed = { ...fees, compensation: { amount: '900.00', currency: 'MXN' as const } };
    expect(groupCents(changed, DEMO_RATES, frozen).other).toBe(5000);
  });

  it('正在修改的汇率：填对了就按它即时折算，汇率日期为费用发生日、来源手工修改', () => {
    const fees = formValuesOf(DETAIL).fees;
    const manual = { manual: { compensation: '20' }, feeDate: '2026-09-10' };
    expect(
      conversionOf(fees.compensation, DEMO_RATES, { manual: '20', feeDate: '2026-09-10' }),
    ).toEqual({
      kind: 'converted',
      usd: '44.45',
      rate: { rate: '20.000000', date: '2026-09-10', source: 'manual' },
    });
    expect(groupCents(fees, DEMO_RATES, manual).other).toBe(4445);
    // 填错的汇率不参与（按原来的算）
    expect(
      groupCents(fees, DEMO_RATES, {
        ...manual,
        manual: { compensation: '0' },
        frozen: DETAIL.fees ?? undefined,
      }).other,
    ).toBe(5080);
  });
});
