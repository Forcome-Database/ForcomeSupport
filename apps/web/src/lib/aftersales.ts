import type { LedgerQuery } from '@forcome/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api';

/** 售后单与台账的查询；新建登记、编辑、设为已完成、取消后整组失效 */
export const AFTERSALES_QUERY_KEY = ['aftersales'] as const;

/** P13 登记台账与当月登记完整率（筛选条件放在地址栏） */
export const ledgerQuery = (query: LedgerQuery = {}) =>
  queryOptions({
    queryKey: [...AFTERSALES_QUERY_KEY, 'ledger', query],
    queryFn: () => api.ledger(query),
  });

/** P13 筛选行的选项（负责人）；成员变动不频繁，5 分钟内不再取 */
export const ledgerOptionsQuery = queryOptions({
  queryKey: [...AFTERSALES_QUERY_KEY, 'ledger-options'],
  queryFn: api.ledgerOptions,
  staleTime: 5 * 60_000,
});

/** 一张售后单的完整登记（编辑登记抽屉） */
export const aftersalesQuery = (number: string) =>
  queryOptions({
    queryKey: [...AFTERSALES_QUERY_KEY, 'detail', number],
    queryFn: () => api.aftersales(number),
  });

/** 新建登记与编辑登记抽屉的选项（负责人、默认比例、生产厂、配件） */
export const registrationOptionsQuery = queryOptions({
  queryKey: [...AFTERSALES_QUERY_KEY, 'registration-options'],
  queryFn: api.registrationOptions,
});

/** 某个费用发生日可用的汇率（抽屉即时折算）；汇率每天才更新一次，取过的日期 10 分钟内不再取 */
export const exchangeRatesQuery = (date: string) =>
  queryOptions({
    queryKey: [...AFTERSALES_QUERY_KEY, 'exchange-rates', date],
    queryFn: () => api.exchangeRates(date),
    staleTime: 10 * 60_000,
  });
