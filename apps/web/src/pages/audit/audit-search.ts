import {
  AUDIT_SEARCH_MAX,
  auditActionFilterSchema,
  auditPeriodSchema,
  phase1AuditObjectTypes,
  SYSTEM_ACTOR,
  type AuditLogFilter,
  type AuditLogQuery,
} from '@forcome/contracts';
import { z } from 'zod';

/**
 * P27 地址栏里的筛选条件（TanStack Router 按它校验，ADR 0007；PRD P27「条件写在地址栏」）：时间（今天 · 近 7 天 · 自定义
 * 与自定义的起止）、操作人、对象类型（第一期九种）、动作（筛选键，如 export、aftersales.complete）、对象编号搜索与页码。
 * 写错的条件丢掉。
 * 时间不在地址栏时是默认的今天；页码 1 不写。
 */
export const auditSearchSchema = z.object({
  period: auditPeriodSchema.optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  actor: z
    .union([z.literal(SYSTEM_ACTOR), z.uuid()])
    .optional()
    .catch(undefined),
  type: z.enum(phase1AuditObjectTypes).optional().catch(undefined),
  action: auditActionFilterSchema.optional().catch(undefined),
  // 地址栏手写的数字样子的编号会被路由按 JSON 读成数字：两种都认
  q: z.coerce.string().min(1).max(AUDIT_SEARCH_MAX).optional().catch(undefined),
  page: z.coerce.number().int().min(2).optional().catch(undefined),
});
export type AuditSearch = z.infer<typeof auditSearchSchema>;

/** 交给接口的筛选条件（导出用）：只有自定义时带起止 */
export function auditFilterOf(search: AuditSearch): AuditLogFilter {
  const { period, from, to, actor, type, action, q } = search;
  const custom = period === 'custom';
  return {
    period,
    from: custom ? from : undefined,
    to: custom ? to : undefined,
    actor,
    type,
    action,
    q,
  };
}

/** 交给接口的查询条件（列表用）：筛选条件加页码 */
export function auditQueryOf(search: AuditSearch): AuditLogQuery {
  return { ...auditFilterOf(search), page: search.page };
}

/** 条件是否就是默认（今天、其余都没选）：是的话不出「清除筛选」 */
export function isDefaultSearch(search: AuditSearch): boolean {
  return (
    (search.period === undefined || search.period === 'today') &&
    search.actor === undefined &&
    search.type === undefined &&
    search.action === undefined &&
    search.q === undefined
  );
}

/** 改了筛选条件：回到第一页；选了对象类型后，不属于该类型的动作条件丢掉（由调用方判断后传入） */
export function withFilter(search: AuditSearch, next: Partial<AuditSearch>): AuditSearch {
  return { ...search, ...next, page: undefined };
}
