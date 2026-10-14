import {
  aftersalesNumberSchema,
  aftersalesStatusSchema,
  handlingMethodSchema,
  PENDING_OWNER,
  responsibilitySchema,
  type FeeDateRange,
  type LedgerQuery,
} from '@forcome/contracts';
import { z } from 'zod';

/**
 * P13 地址栏里的筛选条件（TanStack Router 按它校验，ADR 0007）：筛选行的费用发生日起止、店铺、处理方式、责任、状态、负责人
 * （PRD P13「第一阶段」）；missing 是点页头完整率「筛出缺字段的 N 单」，只列当月缺字段的已完成单（只随店铺）；
 * open 是要打开编辑登记抽屉的售后单号（P27 点进详情）。
 * 写错的条件丢掉。费用发生日不在地址栏时是默认的本月（S13 补充小样），由接口按服务端时钟补上并在 range 里返回。
 */
export const ledgerSearchSchema = z.object({
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  store: z.uuid().optional().catch(undefined),
  method: handlingMethodSchema.optional().catch(undefined),
  responsibility: responsibilitySchema.optional().catch(undefined),
  status: aftersalesStatusSchema.optional().catch(undefined),
  /** 负责人：成员 ID，或「待分配」（PENDING_OWNER，待办 23） */
  owner: z
    .union([z.uuid(), z.literal(PENDING_OWNER)])
    .optional()
    .catch(undefined),
  // 地址栏手写的 ?missing=1 会被路由当成数字 1（值按 JSON 解析），页面里跳转写的是字符串 "1"：两种都认
  missing: z.coerce.string().pipe(z.literal('1')).optional().catch(undefined),
  /** 打开这张单的编辑登记抽屉（从 P27 审计日志点售后单号进来，PRD P27 v2.20）；不影响列表的筛选 */
  open: aftersalesNumberSchema.optional().catch(undefined),
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

/**
 * 条件是否就是默认（费用发生日本月、其余都没选）：是的话不出「清除筛选」，列表为空时也没有按钮。
 * 地址栏写的起止与默认的本月相同也算默认（defaultRange 由接口按服务端时钟给出，加载前不知道时只认没写的）
 */
export function isDefaultSearch(search: LedgerSearch, defaultRange?: FeeDateRange): boolean {
  const sameDay = (value: string | undefined, fallback: string | undefined) =>
    value === undefined || value === fallback;
  return (
    !search.missing &&
    sameDay(search.from, defaultRange?.from) &&
    sameDay(search.to, defaultRange?.to) &&
    choiceFilters.every((key) => search[key] === undefined)
  );
}

/** 选了费用发生日：与默认的本月相同时地址栏不写起止（回到默认） */
export function withRange(
  search: LedgerSearch,
  range: FeeDateRange,
  defaultRange: FeeDateRange | undefined,
): LedgerSearch {
  const isDefault = range.from === defaultRange?.from && range.to === defaultRange.to;
  return isDefault
    ? { ...search, from: undefined, to: undefined }
    : { ...search, from: range.from, to: range.to };
}
