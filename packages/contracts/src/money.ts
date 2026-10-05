import { z } from 'zod';

/** 币种：北美三站的原币（USD、CAD、MXN），美元为折算与报表口径（R-AS-08） */
export const currencies = ['USD', 'CAD', 'MXN'] as const;
export const currencySchema = z.enum(currencies);
export type Currency = z.infer<typeof currencySchema>;

/** 币种符号（原型 ui.CURRENCY：美元 $、比索 MX$、加元 CA$） */
export const currencySymbols: Record<Currency, string> = { USD: '$', CAD: 'CA$', MXN: 'MX$' };

/**
 * 金额写法（原型 money / money_cur）：币种符号 + 千分位 + 两位小数，例「$1,234.50」「MX$889.00」。
 * amount 是 numeric(12,2) 读出的十进制字符串，按字符串处理，不经浮点。
 */
export function formatMoney(amount: string, currency: Currency): string {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = fraction.padEnd(2, '0').slice(0, 2);
  return `${negative ? '-' : ''}${currencySymbols[currency]}${grouped}.${cents}`;
}
