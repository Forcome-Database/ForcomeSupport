import { BUSINESS_TIME_ZONE } from '@forcome/calendar';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api';

/** 渠道与店铺的查询；保存店铺后整组失效（店铺表、渠道卡，以及以后各页面的店铺选项一起刷新） */
export const CHANNEL_QUERY_KEY = ['channel'] as const;

/** 连接状态跟着后台同步变：P18 与全站横幅每分钟重取一次（同步延迟按 10 分钟算，横幅恢复后自动消失） */
const CONNECTION_REFRESH_MS = 60_000;

/** P18：渠道卡、店铺表与是否显示「数据来源」 */
export const channelSettingsQuery = queryOptions({
  queryKey: [...CHANNEL_QUERY_KEY, 'settings'],
  queryFn: api.channelSettings,
  refetchInterval: CONNECTION_REFRESH_MS,
});

/** 全站横幅（G4）：连接异常的渠道；切回页面时也重取 */
export const channelAlertsQuery = queryOptions({
  queryKey: [...CHANNEL_QUERY_KEY, 'alerts'],
  queryFn: api.channelAlerts,
  refetchInterval: CONNECTION_REFRESH_MS,
  refetchOnWindowFocus: true,
});

/** 当前成员店铺范围内的店铺（各页面的店铺筛选与选择）；保存店铺后随这一组失效 */
export const storeOptionsQuery = queryOptions({
  queryKey: [...CHANNEL_QUERY_KEY, 'store-options'],
  queryFn: api.storeOptions,
});

const clock = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 北京时间的「时:分」（原型写作「最近同步 10:12」「刘洋修改（10:18）」） */
export function formatClock(iso: string): string {
  return clock.format(new Date(iso));
}

const dayClock = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BUSINESS_TIME_ZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 北京时间的「月-日 时:分」（G4 横幅「09-11 10:05 起未收取」） */
export function formatDayClock(iso: string): string {
  const parts = Object.fromEntries(
    dayClock.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
