import { formatMoney, isValidAmount } from '@forcome/contracts';

/*
 * 金额的分（整数）：抽屉的比例表与费用合计、取消弹窗的保留合计都按分加减，不经浮点。
 */

/** 金额文字 → 分（整数，不经浮点）；没填为 0，不是合法金额（contracts 的 isValidAmount）为 null */
export function centsOf(amount: string): number | null {
  const text = amount.trim();
  if (text === '') return 0;
  if (!isValidAmount(text)) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** 分 → 金额字符串（两位小数） */
export function amountOfCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** 分 → 美元写法（「$10.00」）：比例表与费用合计用 */
export function formatUsdCents(cents: number): string {
  return formatMoney(amountOfCents(cents), 'USD');
}
