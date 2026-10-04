import { BUSINESS_TIME_ZONE } from '@forcome/calendar';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api';

/** 渠道与店铺的查询；保存店铺后整组失效（店铺表、渠道卡，以及以后各页面的店铺选项一起刷新） */
export const CHANNEL_QUERY_KEY = ['channel'] as const;

/** P18：渠道卡、店铺表与是否显示「数据来源」 */
export const channelSettingsQuery = queryOptions({
  queryKey: [...CHANNEL_QUERY_KEY, 'settings'],
  queryFn: api.channelSettings,
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
