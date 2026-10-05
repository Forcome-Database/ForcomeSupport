import { describe, expect, it } from 'vitest';
import {
  crossRate,
  formatRate,
  formatRateDate,
  isValidRate,
  normalizeRate,
  usdOf,
} from './exchange-rate';

describe('EUR 交叉计算（R-FL-06：欧洲央行只公布 1 EUR 兑各币种，USD/MXN、USD/CAD 由两者相除）', () => {
  it('1 USD = (EUR→目标币种) ÷ (EUR→USD)，保留 6 位小数', () => {
    // Fake 用的演示汇率：EUR→USD 1.10、EUR→MXN 19.80、EUR→CAD 1.496，交叉后正好是原型的 18.00 与 1.36
    expect(crossRate('1.10', '19.80')).toBe('18.000000');
    expect(crossRate('1.10', '1.496')).toBe('1.360000');
  });

  it('欧洲央行公布的写法（4–5 位有效小数）交叉后按第 7 位四舍五入', () => {
    // 19.6532 ÷ 1.0844 = 18.1235706…
    expect(crossRate('1.0844', '19.6532')).toBe('18.123571');
    // 1.4750 ÷ 1.0844 = 1.3601991…
    expect(crossRate('1.0844', '1.4750')).toBe('1.360199');
  });

  it('正好一半时进位（四舍五入，不是银行家舍入）', () => {
    expect(crossRate('1', '1.0000005')).toBe('1.000001');
    expect(crossRate('2', '0.0000005')).toBe('0.000000');
    expect(crossRate('1', '0.0000015')).toBe('0.000002');
  });
});

describe('冻结美元值：原币 ÷ 汇率，四舍五入到分（R-FL-06、AC-P1-08）', () => {
  it('原型的例子：MX$889.00 按 1 USD = 18.00 MXN 折算为 $49.39', () => {
    expect(usdOf('889.00', '18.000000')).toBe('49.39');
    expect(usdOf('889.00', '18')).toBe('49.39');
  });

  it('加元按 1 USD = 1.36 CAD', () => {
    // 10 ÷ 1.36 = 7.3529…
    expect(usdOf('10.00', '1.360000')).toBe('7.35');
  });

  it('正好半分时进位，且不受浮点误差影响', () => {
    expect(usdOf('0.25', '2')).toBe('0.13');
    expect(usdOf('0.05', '2')).toBe('0.03');
    // 2.01 ÷ 2 = 1.005：按浮点算 Math.round(1.005 × 100) 会得到 100（1.00），这里必须是 1.01
    expect(usdOf('2.01', '2')).toBe('1.01');
  });

  it('0 折算后仍是 0，大额不丢精度', () => {
    expect(usdOf('0.00', '18.000000')).toBe('0.00');
    expect(usdOf('9999999999.99', '18.123571')).toBe('551767640.05');
  });
});

describe('汇率的输入与写法', () => {
  it('合法的汇率：大于 0，最多 6 位整数与 6 位小数（numeric(12,6)）', () => {
    for (const ok of ['18', '18.5', '17.985', '0.000001', '999999.999999']) {
      expect(isValidRate(ok), ok).toBe(true);
    }
    for (const bad of ['', '0', '0.000000', '0.0000001', '-1', '1e3', 'abc', '1234567', '18.']) {
      expect(isValidRate(bad), bad).toBe(false);
    }
  });

  it('保存时写成 6 位小数', () => {
    expect(normalizeRate('17.5')).toBe('17.500000');
    expect(normalizeRate('18.00')).toBe('18.000000');
  });

  it('汇率显示两位小数（原型「1 USD = 18.00 MXN」），汇率日期写月-日（原型「汇率 09-10」）', () => {
    expect(formatRate('18.000000')).toBe('18.00');
    expect(formatRate('1.360199')).toBe('1.36');
    expect(formatRate('18.125000')).toBe('18.13');
    expect(formatRateDate('2026-09-10')).toBe('09-10');
  });
});
