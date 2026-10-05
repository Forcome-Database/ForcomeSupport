import { emptyRegistrationInput } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import {
  amountText,
  emptyRegistrationForm,
  factoryPercents,
  feeTotalCents,
  fieldLabel,
  formErrorsOf,
  groupCents,
  percentText,
  ratioFormOf,
  registrationInputOf,
  shareCents,
  withRatioSide,
  type FeeForm,
} from './registration-form';

const usd = (amount: string): FeeForm => ({ amount, currency: 'USD' });

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
    expect(errors.map((e) => fieldLabel(e.field))).toEqual(['责任理由', '承担比例', '额外赔偿']);
    expect(fieldLabel('sourceTicket')).toBe('来源工单');
  });

  it('比例表的金额：三组按费用项归组（其他费用 = 额外赔偿 + 其他），没填按 0；有非美元的组暂不计算', () => {
    const fees = {
      productCost: usd('3.20'),
      freight: usd('6.80'),
      compensation: usd(''),
      otherCost: usd('0'),
    };
    expect(groupCents(fees)).toEqual({ product: 320, freight: 680, other: 0 });
    expect(feeTotalCents(fees)).toBe(1000);
    const peso = { ...fees, compensation: { amount: '889.00', currency: 'MXN' as const } };
    expect(groupCents(peso)).toEqual({ product: 320, freight: 680, other: null });
    expect(feeTotalCents(peso)).toBeNull();
  });

  it('两方承担：工厂按比例四舍五入到分，FSH = 金额 − 工厂', () => {
    expect(shareCents(320, 100)).toEqual({ fsh: 0, factory: 320 });
    expect(shareCents(1105, 50)).toEqual({ fsh: 552, factory: 553 });
    expect(shareCents(680, 0)).toEqual({ fsh: 680, factory: 0 });
  });
});
