import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

describe('金额写法（原型 money / money_cur：美元 $，加元 CA$，比索 MX$，两位小数、千分位）', () => {
  it('三种币种的符号', () => {
    expect(formatMoney('3.20', 'USD')).toBe('$3.20');
    expect(formatMoney('12.00', 'CAD')).toBe('CA$12.00');
    expect(formatMoney('889.00', 'MXN')).toBe('MX$889.00');
  });

  it('千分位与补足两位小数', () => {
    expect(formatMoney('1234.5', 'USD')).toBe('$1,234.50');
    expect(formatMoney('1234567', 'MXN')).toBe('MX$1,234,567.00');
    expect(formatMoney('0', 'USD')).toBe('$0.00');
  });
});
