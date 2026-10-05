import { z } from 'zod';

/** 币种：北美三站的原币（USD、CAD、MXN），美元为折算与报表口径（R-AS-08） */
export const currencies = ['USD', 'CAD', 'MXN'] as const;
export const currencySchema = z.enum(currencies);
export type Currency = z.infer<typeof currencySchema>;

const formats = new Map<Currency, Intl.NumberFormat>();

/**
 * 金额写法（原型 money / money_cur）：币种符号 + 千分位 + 两位小数，美元「$1,234.50」、加元「CA$12.00」、比索「MX$889.00」。
 * 用 Intl.NumberFormat 的 en-US 货币格式；amount 是 numeric(12,2) 读出的十进制字符串，按字符串传入，不经浮点换算。
 */
export function formatMoney(amount: string, currency: Currency): string {
  let format = formats.get(currency);
  if (!format) {
    format = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    formats.set(currency, format);
  }
  // 十进制字符串按原值格式化（ECMA-402 的 Intl 数学值）；类型声明只写了 number | bigint
  return format.format(amount as unknown as number);
}
