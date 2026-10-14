import type { ReportQuery } from '@forcome/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api';
import { isBackgroundFetch } from './background-fetch';
import { TICKETS_QUERY_KEY } from './tickets';

/**
 * P17 报表的工单部分（待办 24）：按地址栏的条件取指标、每日工单量与「更新于」。挂在工单这一组下：实时推送「工单变了」时
 * 在后台重新拉取（lib/live-updates.ts），报表随业务变化更新（T+0）；后台重新拉取时照旧显示上一份，不出骨架
 */
export function ticketReportQuery(query: ReportQuery) {
  return queryOptions({
    queryKey: [...TICKETS_QUERY_KEY, 'report', query],
    // 带上中止信号：换条件或加载超过 10 秒后「重试」时，还没返回的那次请求被中止、重新取（K3）
    queryFn: ({ queryKey, signal }) =>
      api.ticketReport(query, { background: isBackgroundFetch(queryKey), signal }),
  });
}
