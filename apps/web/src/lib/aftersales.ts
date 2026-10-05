import { queryOptions } from '@tanstack/react-query';
import { api } from './api';

/** 售后单与台账的查询；新建登记后整组失效 */
export const AFTERSALES_QUERY_KEY = ['aftersales'] as const;

/** P13 登记台账 */
export const ledgerQuery = queryOptions({
  queryKey: [...AFTERSALES_QUERY_KEY, 'ledger'],
  queryFn: api.ledger,
});

/** 新建登记抽屉的选项（负责人、默认比例、生产厂、配件） */
export const registrationOptionsQuery = queryOptions({
  queryKey: [...AFTERSALES_QUERY_KEY, 'registration-options'],
  queryFn: api.registrationOptions,
});
