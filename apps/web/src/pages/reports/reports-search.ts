import {
  DEFAULT_REPORT_PERIOD,
  reportPeriodSchema,
  siteSchema,
  type ReportQuery,
} from '@forcome/contracts';
import { z } from 'zod';

/**
 * P17 地址栏里的条件（TanStack Router 按它校验，ADR 0007；PRD P17「第一阶段」，条件写在地址栏）：时间（period，没写为近 7 天；
 * custom 带起止 from / to）、店铺、站点。参数名与接口相同（contracts 的 reportQuerySchema）。写错的条件丢掉
 */
export const reportsSearchSchema = z.object({
  period: reportPeriodSchema.optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  store: z.uuid().optional().catch(undefined),
  site: siteSchema.optional().catch(undefined),
});
export type ReportsSearch = z.infer<typeof reportsSearchSchema>;

/** 交给接口的查询条件：不是自定义时不带起止 */
export function reportQueryOf(search: ReportsSearch): ReportQuery {
  const { from, to, ...rest } = search;
  return rest.period === 'custom' ? { ...rest, from, to } : rest;
}

/** 改一项条件：取默认值（近 7 天、全部）时从地址栏去掉 */
export function withFilter(search: ReportsSearch, patch: Partial<ReportsSearch>): ReportsSearch {
  const next = { ...search, ...patch };
  if (next.period === DEFAULT_REPORT_PERIOD) next.period = undefined;
  if (next.period !== 'custom') {
    next.from = undefined;
    next.to = undefined;
  }
  return next;
}

/** 是不是默认的条件（近 7 天、店铺与站点都没选）：偏离默认时才给「清除筛选」（K4，同 P04 的 Q6） */
export function isDefaultSearch(search: ReportsSearch): boolean {
  const query = reportQueryOf(search);
  return (
    (query.period ?? DEFAULT_REPORT_PERIOD) === DEFAULT_REPORT_PERIOD && !query.store && !query.site
  );
}

/** 清除筛选：回到默认（近 7 天、全部店铺、全部站点） */
export const clearedSearch: ReportsSearch = {};
