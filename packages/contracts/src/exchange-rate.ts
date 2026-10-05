import Big from 'big.js';
import { z } from 'zod';

/*
 * 汇率（R-FL-06、E-20、PRD 11.1 ExchangeRate）：欧洲央行每个工作日公布 1 EUR 兑各币种的参考汇率，USD/MXN、USD/CAD
 * 由 EUR 交叉计算；台账每个非美元金额按费用发生日取汇率，冻结美元值四舍五入到分。前后端共用这里的算法：后端保存时
 * 冻结美元值，新建登记抽屉即时显示的折算与它一致。十进制运算用 big.js（四舍五入、不经浮点）。
 */

/** 汇率保存 6 位小数（numeric(12,6)，「1 USD = rate 原币」） */
export const RATE_DECIMALS = 6;

/** 需要折算的币种（美元不折算） */
export const foreignCurrencies = ['CAD', 'MXN'] as const;
export type ForeignCurrency = (typeof foreignCurrencies)[number];

/**
 * 汇率来源：欧洲央行（主源）、Frankfurter（备用源，数据同样来自欧洲央行）；台账的费用项另有「手工修改」
 * （售后负责人改汇率，记审计）
 */
export const rateSources = ['ecb', 'frankfurter', 'manual'] as const;
export const rateSourceSchema = z.enum(rateSources);
export type RateSource = z.infer<typeof rateSourceSchema>;
export const rateSourceLabels: Record<RateSource, string> = {
  ecb: '欧洲央行',
  frankfurter: '备用源（Frankfurter）',
  manual: '手工修改',
};

/** 一个汇率：1 USD = rate 原币；date 是汇率实际所属的日期（当天缺失时为此前最近一个有汇率的日期，E-20） */
export const exchangeRateSchema = z.object({
  rate: z.string(),
  date: z.iso.date(),
  source: rateSourceSchema,
});
export type ExchangeRate = z.infer<typeof exchangeRateSchema>;

/** 某个日期可用的汇率（新建登记抽屉即时折算用）：每个币种取当天、缺失时取此前最近一个有汇率的日期；一个都没有为 null */
export const exchangeRatesOnSchema = z.object({
  date: z.iso.date(),
  rates: z.object({ CAD: exchangeRateSchema.nullable(), MXN: exchangeRateSchema.nullable() }),
});
export type ExchangeRatesOn = z.infer<typeof exchangeRatesOnSchema>;

const ROUND_HALF_UP = 1;

/** 1 USD = ? 目标币种：(EUR→目标币种) ÷ (EUR→USD)，四舍五入到 6 位小数 */
export function crossRate(eurToUsd: string, eurToTarget: string): string {
  return new Big(eurToTarget)
    .div(eurToUsd)
    .round(RATE_DECIMALS, ROUND_HALF_UP)
    .toFixed(RATE_DECIMALS);
}

/** 冻结美元值：原币金额 ÷ 汇率（1 USD = rate 原币），四舍五入到分 */
export function usdOf(amount: string, rate: string): string {
  return new Big(amount).div(rate).round(2, ROUND_HALF_UP).toFixed(2);
}

const RATE_PATTERN = /^\d{1,6}(\.\d{1,6})?$/;

/** 汇率是否合法：大于 0，最多 6 位整数与 6 位小数 */
export function isValidRate(rate: string): boolean {
  return RATE_PATTERN.test(rate) && new Big(rate).gt(0);
}

/** 汇率写成保存的精度（6 位小数），如手工填的「17.5」→「17.500000」 */
export function normalizeRate(rate: string): string {
  return new Big(rate).toFixed(RATE_DECIMALS, ROUND_HALF_UP);
}

/** 汇率的写法（原型「1 USD = 18.00 MXN」）：两位小数 */
export function formatRate(rate: string): string {
  return new Big(rate).toFixed(2, ROUND_HALF_UP);
}

/** 汇率日期的写法（原型「汇率 09-10」）：月-日 */
export function formatRateDate(date: string): string {
  return date.slice(5);
}
