import {
  aftersalesStatusSchema,
  handlingMethodSchema,
  responsibilitySchema,
  type FeeDateRange,
  type LedgerQuery,
} from '@forcome/contracts';
import { z } from 'zod';

/**
 * P13 地址栏里的筛选条件（TanStack Router 按它校验，ADR 0007）：筛选行的费用发生日起止、店铺、处理方式、责任、状态、负责人
 * （PRD P13「第一阶段」）；missing 是点页头完整率「筛出缺字段的 N 单」，只列当月缺字段的已完成单（只随店铺）。
 * 写错的条件丢掉。费用发生日不在地址栏时是默认的本月（S13 补充小样），由接口按服务端时钟补上并在 range 里返回。
 */
export const ledgerSearchSchema = z.object({
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  store: z.uuid().optional().catch(undefined),
  method: handlingMethodSchema.optional().catch(undefined),
  responsibility: responsibilitySchema.optional().catch(undefined),
  status: aftersalesStatusSchema.optional().catch(undefined),
  owner: z.uuid().optional().catch(undefined),
  // 地址栏手写的 ?missing=1 会被路由当成数字 1（值按 JSON 解析），页面里跳转写的是字符串 "1"：两种都认
  missing: z.coerce.string().pipe(z.literal('1')).optional().catch(undefined),
});
export type LedgerSearch = z.infer<typeof ledgerSearchSchema>;

/** 筛选行里除费用发生日以外的单选条件 */
export const choiceFilters = ['store', 'method', 'responsibility', 'status', 'owner'] as const;
export type ChoiceFilter = (typeof choiceFilters)[number];

/** 交给接口的查询条件（列表与导出共用）：筛出缺字段时只带店铺（与完整率同口径）；其余照地址栏 */
export function ledgerQueryOf(search: LedgerSearch): LedgerQuery {
  if (search.missing) return { missing: '1', store: search.store };
  const { from, to, store, method, responsibility, status, owner } = search;
  return { from, to, store, method, responsibility, status, owner };
}

/** 条件是否就是默认（费用发生日本月、其余都没选）：是的话不出「清除筛选」，列表为空时也没有按钮 */
export function isDefaultSearch(search: LedgerSearch): boolean {
  return (
    !search.missing &&
    search.from === undefined &&
    search.to === undefined &&
    choiceFilters.every((key) => search[key] === undefined)
  );
}

/** 费用发生日的写法（原型芯片「2026-09-01 至 09-11」）：同一年的结束日不写年份，跨年写全 */
export function rangeLabel(range: FeeDateRange): string {
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${range.from} 至 ${sameYear ? range.to.slice(5) : range.to}`;
}
