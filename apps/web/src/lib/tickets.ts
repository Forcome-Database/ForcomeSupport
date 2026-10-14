import { businessDate, businessDateTime } from '@forcome/calendar';
import { queryOptions } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { TicketListQuery } from '@forcome/contracts';
import { api, ApiRequestError } from './api';
import { isBackgroundFetch } from './background-fetch';

/** 工单的查询；数据变化后整组失效（实时推送「工单变了」时在后台重新拉取，lib/live-updates.ts） */
export const TICKETS_QUERY_KEY = ['tickets'] as const;

/** 未归属店铺来信队列（P04 入口计数与队列，pages/tickets/unassigned-mail.ts）；推送「来信变了」时失效 */
export const UNASSIGNED_MAIL_QUERY_KEY = ['unassigned-mail'] as const;

/** P04 工单列表：按地址栏的条件取一页（待办 18） */
export function ticketListQuery(query: TicketListQuery) {
  return queryOptions({
    queryKey: [...TICKETS_QUERY_KEY, 'list', query],
    queryFn: ({ queryKey }) => api.tickets(query, { background: isBackgroundFetch(queryKey) }),
  });
}

/** P05 工单详情（待办 17）；标记、撤销后用接口返回的详情直接替换 */
export function ticketDetailQuery(number: string) {
  return queryOptions({
    queryKey: [...TICKETS_QUERY_KEY, 'detail', number],
    queryFn: ({ queryKey }) =>
      api.ticketDetail(number, { background: isBackgroundFetch(queryKey) }),
    // 4xx 是确定的结果（403 为 G2，404 与编号格式不对的 400 为 G3，401 按会话结束处理），不重试
    retry: (count, error) =>
      !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500) && count < 3,
  });
}

/** SLA 剩余随时间走的刷新间隔 */
const CLOCK_TICK_MS = 30_000;

/**
 * 服务端时钟的「现在」（P04 的 SLA 剩余与「最近来信」当天只写时分都按它）：接口给的服务端当前时刻加上取到之后过去的时间，
 * 每 30 秒走一次——数据没变时剩余照样往下走、到点变成「已超时」（开发测试环境 CLOCK_START 时与浏览器时钟不同，所以不直接用浏览器时钟）。
 * 还没取到时用浏览器时钟
 */
export function useServerNow(serverNow: string | null): Date {
  // 还没取到时用打开页面时的浏览器时钟
  const [opened] = useState(() => Date.now());
  // 取到之后过去了多久（按这份数据的服务端时刻记，换了数据从 0 算起）
  const [elapsed, setElapsed] = useState({ base: serverNow, ms: 0 });
  useEffect(() => {
    const received = Date.now();
    const timer = setInterval(
      () => setElapsed({ base: serverNow, ms: Date.now() - received }),
      CLOCK_TICK_MS,
    );
    return () => clearInterval(timer);
  }, [serverNow]);
  if (serverNow === null) return new Date(opened);
  return new Date(Date.parse(serverNow) + (elapsed.base === serverNow ? elapsed.ms : 0));
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
