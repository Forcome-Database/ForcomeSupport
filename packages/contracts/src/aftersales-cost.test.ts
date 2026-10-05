import { describe, expect, it } from 'vitest';
import {
  costShares,
  ratioGroupWords,
  ratioPairsOf,
  ratioWords,
  uniformRatio,
  type FactoryRatios,
  type FeeItem,
} from './aftersales';

/*
 * 承担金额（R-AS-08、D-24）：费用合计 = 四项美元值之和；工厂承担 = 各组费用 × 该组工厂比例之和，逐行四舍五入到分；
 * FSH 承担 = 该行费用合计 − 工厂承担。三组：产品成本 / 快递物流 / 其他费用（额外赔偿 + 其他）。
 */

type UsdFees = Record<FeeItem, string | null>;

const fees = (productCost: string, freight: string, compensation: string, otherCost: string) =>
  ({ productCost, freight, compensation, otherCost }) satisfies UsdFees;

const uniform = (factory: number): FactoryRatios => ({
  product: factory,
  freight: factory,
  other: factory,
});

describe('承担金额（R-AS-08）', () => {
  it('三组相同 FSH 0 / 工厂 100：工厂承担全部（原型 S-20260903-0012 $23.40）', () => {
    expect(costShares(fees('9.80', '13.60', '0.00', '0.00'), uniform(100))).toEqual({
      total: '23.40',
      factory: '23.40',
      fsh: '0.00',
    });
  });

  it('三组相同 FSH 50 / 工厂 50：各一半（原型 S-20260908-0015 $22.10 → $11.05 / $11.05）', () => {
    expect(costShares(fees('9.80', '12.30', '0.00', '0.00'), uniform(50))).toEqual({
      total: '22.10',
      factory: '11.05',
      fsh: '11.05',
    });
  });

  it('三组不同：各组按自己的比例算，额外赔偿与其他同属「其他费用」一组', () => {
    // 产品成本 9.80 × 100% + 运费 13.60 × 0% + (额外赔偿 4.00 + 其他 1.00) × 50%
    const ratios: FactoryRatios = { product: 100, freight: 0, other: 50 };
    expect(costShares(fees('9.80', '13.60', '4.00', '1.00'), ratios)).toEqual({
      total: '28.40',
      factory: '12.30',
      fsh: '16.10',
    });
  });

  it('工厂承担逐行四舍五入到分（不是逐组取整再相加），FSH = 费用合计 − 工厂承担', () => {
    // 逐组取整会得 0.03 + 0.03 = 0.06；逐行：0.025 + 0.025 = 0.05
    expect(costShares(fees('0.05', '0.05', '0.00', '0.00'), uniform(50))).toEqual({
      total: '0.10',
      factory: '0.05',
      fsh: '0.05',
    });
    // 半分进位（四舍五入，不是银行家舍入）：0.01 × 50% = 0.005 → 0.01
    expect(costShares(fees('0.01', '0.00', '0.00', '0.00'), uniform(50))).toEqual({
      total: '0.01',
      factory: '0.01',
      fsh: '0.00',
    });
  });

  it('逐行取整后 FSH + 工厂 = 费用合计（各种比例与金额）', () => {
    const amounts = ['0.00', '0.01', '0.07', '1.99', '13.33', '49.39', '1234.57'];
    for (const product of amounts) {
      for (const other of amounts) {
        for (const ratios of [uniform(33), { product: 17, freight: 66, other: 51 }]) {
          const { total, factory, fsh } = costShares(fees(product, '0.03', other, '0.01'), ratios);
          expect(Math.round((Number(factory) + Number(fsh)) * 100)).toBe(
            Math.round(Number(total) * 100),
          );
        }
      }
    }
  });

  it('比例的写法：三组相同写一个值，不同时逐组列出（原型 data.ratio_words）', () => {
    expect(ratioWords(ratioPairsOf(uniform(100)))).toBe('三组均 FSH 0 / 工厂 100');
    expect(uniformRatio(ratioPairsOf(uniform(50)))).toEqual({ fsh: 50, factory: 50 });
    const mixed = ratioPairsOf({ product: 100, freight: 0, other: 50 });
    expect(uniformRatio(mixed)).toBeNull();
    expect(ratioGroupWords(mixed)).toEqual([
      '产品成本 FSH 0 / 工厂 100',
      '快递物流 FSH 100 / 工厂 0',
      '其他费用 FSH 50 / 工厂 50',
    ]);
    expect(ratioWords(mixed)).toBe(
      '产品成本 FSH 0 / 工厂 100 · 快递物流 FSH 100 / 工厂 0 · 其他费用 FSH 50 / 工厂 50',
    );
  });

  it('没登记的费用项不计（按 0）；比例没登记（历史导入）时承担金额为 null', () => {
    const partial: UsdFees = {
      productCost: null,
      freight: '8.40',
      compensation: null,
      otherCost: null,
    };
    expect(costShares(partial, uniform(0))).toEqual({
      total: '8.40',
      factory: '0.00',
      fsh: '8.40',
    });
    expect(costShares(partial, null)).toEqual({ total: '8.40', factory: null, fsh: null });
  });
});
