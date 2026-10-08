import { businessDate, businessDateTime } from '@forcome/calendar';
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
    // 4xx 是确定的结果（403 为 G2，404 与编号格式不对的 400 为 G3，401 按会话结束处理），不重试
    retry: (count, error) =>
      !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500) && count < 3,
  });
}

/** 北京时间的「月-日」与「时:分」（P04、P05 显示时刻都用它） */
export function businessDayClock(at: Date): { day: string; clock: string } {
  // 「YYYY-MM-DD HH:mm:ss」
  const text = businessDateTime(at);
  return { day: text.slice(5, 10), clock: text.slice(11, 16) };
}

/** P04「最近来信」：当天只写时分，其余写「月-日 时:分」，都按北京时间（原型 short_time()） */
export function formatLastInbound(iso: string, now: Date): string {
  const at = new Date(iso);
  const { day, clock } = businessDayClock(at);
  return businessDate(at) === businessDate(now) ? clock : `${day} ${clock}`;
}
