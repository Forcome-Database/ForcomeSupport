import { BUSINESS_TIME_ZONE, businessDate } from '@forcome/calendar';
import { queryOptions } from '@tanstack/react-query';
import { api, ApiRequestError } from './api';

/** 工单的查询；数据变化后整组失效（SSE 推送后自动重新拉取随 18 号待办） */
export const TICKETS_QUERY_KEY = ['tickets'] as const;

/** P04 工单列表 */
export const ticketListQuery = queryOptions({
  queryKey: [...TICKETS_QUERY_KEY, 'list'],
  queryFn: api.tickets,
});

/** P05 工单详情（待办 17）；标记、撤销后用接口返回的详情直接替换 */
export function ticketDetailQuery(number: string) {
  return queryOptions({
    queryKey: [...TICKETS_QUERY_KEY, 'detail', number],
    queryFn: () => api.ticketDetail(number),
    // 403（G2）与 404（G3）是确定的结果，不重试
    retry: (count, error) =>
      !(error instanceof ApiRequestError && [403, 404].includes(error.status)) && count < 3,
  });
}

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** P04「最近来信」：当天只写时分，其余写「月-日 时:分」，都按北京时间（原型 short_time()） */
export function formatLastInbound(iso: string, now: Date): string {
  const at = new Date(iso);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.formatToParts(at).find((p) => p.type === type)?.value ?? '';
  const clock = `${part('hour')}:${part('minute')}`;
  return businessDate(at) === businessDate(now)
    ? clock
    : `${part('month')}-${part('day')} ${clock}`;
}
