import {
  feeItemLabels,
  feeItems,
  type Currency,
  type FeeItem,
  type Fees,
} from '@forcome/contracts';
import type { aftersales } from './schema';

/*
 * 费用项与售后单表列的互换（R-AS-08 的四个费用项；表上一项一组列，core 的 feeColumns）。
 * 新建登记、示例数据、台账输出都经这里，汇率与美元值（待办 20）加列时只改这一处。
 */

type AftersalesRow = typeof aftersales.$inferSelect;

/** 一个费用项要写入的值：没登记时金额为空（币种随之为空） */
export interface FeeValue {
  readonly amount: string | null;
  readonly currency: Currency | null;
}

/** 四个费用项 → 售后单表的列值 */
export function feeColumnValues(fees: Readonly<Record<FeeItem, FeeValue>>) {
  const values = {} as Record<FeeItem, string | null> &
    Record<`${FeeItem}Currency`, Currency | null>;
  for (const item of feeItems) {
    const { amount, currency } = fees[item];
    values[item] = amount;
    values[`${item}Currency`] = amount === null ? null : currency;
  }
  return values;
}

/** 售后单表的列 → 四个费用项（没登记的为 null）。表上的 CHECK 保证有金额就有币种，缺了说明数据坏了，直接报错 */
export function feesOf(row: AftersalesRow): Fees {
  const fees = {} as Record<FeeItem, Fees[FeeItem]>;
  for (const item of feeItems) {
    const amount = row[item];
    const currency = row[`${item}Currency`];
    if (amount !== null && currency === null) {
      throw new Error(`售后单 ${row.number} 的${feeItemLabels[item]}缺币种`);
    }
    fees[item] = amount === null || currency === null ? null : { amount, currency };
  }
  return fees;
}
