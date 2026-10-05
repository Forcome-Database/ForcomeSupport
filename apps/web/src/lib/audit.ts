import type { AuditLogQuery } from '@forcome/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api';

/** P27 审计日志的查询；导出后整组失效（导出本身新写了一条记录） */
export const AUDIT_QUERY_KEY = ['audit'] as const;

/** P27 的一页（筛选条件放在地址栏） */
export const auditLogQuery = (query: AuditLogQuery) =>
  queryOptions({
    queryKey: [...AUDIT_QUERY_KEY, 'log', query],
    queryFn: () => api.auditLog(query),
  });

/** 操作人筛选的选项；成员变动不频繁，5 分钟内不再取 */
export const auditLogOptionsQuery = queryOptions({
  queryKey: [...AUDIT_QUERY_KEY, 'options'],
  queryFn: api.auditLogOptions,
  staleTime: 5 * 60_000,
});
