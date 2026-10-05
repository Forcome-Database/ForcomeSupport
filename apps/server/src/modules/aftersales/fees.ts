import {
  feeItemLabels,
  feeItems,
  isValidAmount,
  registrationMessages,
  usdOf,
  type Currency,
  type ExchangeRate,
  type FeeInput,
  type FeeItem,
  type FieldErrors,
  type Fees,
  type ForeignCurrency,
} from '@forcome/contracts';
import { exchangeRateOn, type DbExecutor } from '../core';
import type { aftersales } from './schema';

/*
 * 费用项与售后单表列的互换（R-AS-08 的四个费用项；表上一项一组列，core 的 feeColumns）与按费用发生日的折算
 * （R-FL-06、E-20）。新建登记、修改汇率、示例数据、台账输出都经这里。
 */

type AftersalesRow = typeof aftersales.$inferSelect;

/** 一个费用项要写入的值：原币金额与币种、冻结美元值、折算用的汇率（美元为 null）；没登记时全为空 */
export interface FeeValue {
  readonly amount: string | null;
  readonly currency: Currency | null;
  readonly usd: string | null;
  readonly rate: ExchangeRate | null;
}

/** 没登记的费用项 */
export const NO_FEE: FeeValue = { amount: null, currency: null, usd: null, rate: null };

/** 美元金额：不折算，美元值就是原值 */
export function usdFee(amount: string): FeeValue {
  return { amount, currency: 'USD', usd: amount, rate: null };
}

/** 非美元金额按给定汇率冻结美元值（四舍五入到分） */
export function convertedFee(
  amount: string,
  currency: ForeignCurrency,
  rate: ExchangeRate,
): FeeValue {
  return { amount, currency, usd: usdOf(amount, rate.rate), rate };
}

/** 四个费用项 → 售后单表的列值 */
export function feeColumnValues(fees: Readonly<Record<FeeItem, FeeValue>>) {
  const values = {} as Record<FeeItem | `${FeeItem}Usd` | `${FeeItem}Rate`, string | null> &
    Record<`${FeeItem}Currency`, Currency | null> &
    Record<`${FeeItem}RateDate`, string | null> &
    Record<`${FeeItem}RateSource`, ExchangeRate['source'] | null>;
  for (const item of feeItems) {
    const fee = fees[item];
    values[item] = fee.amount;
    values[`${item}Currency`] = fee.amount === null ? null : fee.currency;
    values[`${item}Usd`] = fee.amount === null ? null : fee.usd;
    values[`${item}Rate`] = fee.rate?.rate ?? null;
    values[`${item}RateDate`] = fee.rate?.date ?? null;
    values[`${item}RateSource`] = fee.rate?.source ?? null;
  }
  return values;
}

/**
 * 售后单表的列 → 四个费用项（没登记的为 null）。表上的 CHECK 保证币种、美元值与汇率的组合；「有金额就有美元值」
 * 由这里把关（加列前的旧数据由迁移与示例数据补齐，ADR 0006 修订）——缺了说明数据坏了，直接报错，不静默按原币或美元处理
 */
export function feesOf(row: AftersalesRow): Fees {
  const fees = {} as Record<FeeItem, Fees[FeeItem]>;
  for (const item of feeItems) {
    const amount = row[item];
    if (amount === null) {
      fees[item] = null;
      continue;
    }
    const currency = row[`${item}Currency`];
    const usd = row[`${item}Usd`];
    if (currency === null || usd === null) {
      throw new Error(`售后单 ${row.number} 的${feeItemLabels[item]}缺币种或美元值`);
    }
    const rate = row[`${item}Rate`];
    const rateDate = row[`${item}RateDate`];
    const rateSource = row[`${item}RateSource`];
    fees[item] = {
      amount,
      currency,
      usd,
      rate:
        rate !== null && rateDate !== null && rateSource !== null
          ? { rate, date: rateDate, source: rateSource }
          : null,
    };
  }
  return fees;
}

/**
 * 按费用发生日折算四个费用项（R-FL-06、E-20、AC-P1-08）：美元不折算；非美元取当天、缺失时取此前最近一个有汇率的日期，
 * 冻结美元值四舍五入到分。没填的项为空；金额格式不对的项跳过（报错由 registrationErrors 给出）；某币种在该日及之前
 * 都没有汇率时，在该项上报错（同一次保存的其他错误一起列出）。
 */
export async function convertFees(
  db: DbExecutor,
  fees: Readonly<Record<FeeItem, FeeInput>>,
  feeDate: string,
): Promise<{ values: Record<FeeItem, FeeValue>; errors: FieldErrors }> {
  const rates = new Map<ForeignCurrency, Promise<ExchangeRate | null>>();
  const rateOf = (currency: ForeignCurrency) => {
    let found = rates.get(currency);
    if (!found) {
      found = exchangeRateOn(db, currency, feeDate);
      rates.set(currency, found);
    }
    return found;
  };
  const values = {} as Record<FeeItem, FeeValue>;
  const errors: FieldErrors = {};
  for (const item of feeItems) {
    const { amount, currency } = fees[item];
    if (amount === null || !isValidAmount(amount)) {
      values[item] = NO_FEE;
      continue;
    }
    if (currency === 'USD') {
      values[item] = usdFee(amount);
      continue;
    }
    const rate = await rateOf(currency);
    if (rate) {
      values[item] = convertedFee(amount, currency, rate);
    } else {
      values[item] = NO_FEE;
      errors[`fees.${item}`] = registrationMessages.noRate;
    }
  }
  return { values, errors };
}
