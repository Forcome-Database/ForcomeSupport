import type {
  CurrentMember,
  Notification,
  NotificationList,
  NotificationType,
  NotificationView,
} from '@forcome/contracts';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { CircleCheck, Store, TriangleAlert, Users, type LucideIcon } from 'lucide-react';
import type { IconTileTone } from '@/components/icon-tile';
import { api } from './api';
import { canOpenPage, pages, type PageDefinition } from './pages';

/*
 * 站内通知（G10，待办 31）：铃铛的未读数、面板的两个页签、标为已读（提交与缓存），以及每种通知的图标与跳转目标
 * （面板在 components/notification-bell.tsx）。新通知经 SSE 推送是待办 18 的事；在那之前铃铛与打开的面板定时重新拉取
 * （后台请求，不续期会话）。18 落地后，推送「通知变了」时让 notificationsKey 下的缓存失效即可，轮询可以去掉。
 */

/** 轮询间隔：SSE 推送（待办 18）落地前先轮询 */
export const NOTIFICATION_POLL_MS = 30_000;

/** 通知相关缓存的前缀（未读数与各页签） */
export const notificationsKey = ['notifications'] as const;

export const unreadCountQuery = queryOptions({
  queryKey: [...notificationsKey, 'unread-count'],
  queryFn: api.notificationUnread,
  refetchInterval: NOTIFICATION_POLL_MS,
});

/**
 * 下一次取哪个页签是人的操作：打开面板、切换页签、点「重试」时登记，取的时候用掉。没有登记的（面板开着时的定时重新拉取、
 * 标为已读后的刷新）是后台请求，不续期会话（ADR 0010 修订）；面板同一时间只有一个，登记放在模块里。
 * 登记时这个页签不会有在途的请求（面板关着、页签没选中时没有定时拉取；「重试」的 refetch 会取消在途的那次），所以登记总被紧接着的
 * 那一次用掉；万一被合并了，代价只是下一次定时拉取续期一次会话
 */
const userFetches = new Set<NotificationView>();

export function fetchByUser(view: NotificationView): void {
  userFetches.add(view);
}

/** 面板的一个页签，开着时定时重新拉取 */
export function notificationListQuery(view: NotificationView) {
  return queryOptions({
    queryKey: [...notificationsKey, 'list', view],
    queryFn: () => api.notifications(view, { background: !userFetches.delete(view) }),
    refetchInterval: NOTIFICATION_POLL_MS,
  });
}

/** 铃铛角标的写法：超过 99 写「99+」；没有未读时不显示（null） */
export function unreadBadge(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? '99+' : String(unread);
}

/** 每种通知的类型图标与色调（原型 data.NOTIFICATIONS：恢复绿勾、连接异常红三角、未归属店铺橙色店铺） */
export const notificationLooks: Readonly<
  Record<NotificationType, { icon: LucideIcon; tone: IconTileTone }>
> = {
  channel_recovered: { icon: CircleCheck, tone: 'success' },
  channel_disconnected: { icon: TriangleAlert, tone: 'danger' },
  // 原型没画的三种按同一套写法：钉钉同步失败同连接异常；自动归位是未归属来信有了着落（绿色店铺）；改派队列同 P13「待分配」的警示色
  dingtalk_sync_failed: { icon: TriangleAlert, tone: 'danger' },
  unassigned_mail: { icon: Store, tone: 'warning' },
  unassigned_mail_placed: { icon: Store, tone: 'success' },
  reassign_queue: { icon: Users, tone: 'warning' },
};

/**
 * 点一条跳到哪个页面（G10「点一条即跳到对象」）：按通知类型定，要带的地址参数见 notificationSearch。P13「负责人：待分配」筛选
 * （待办 23）上线后给 reassign_queue 带上筛选的地址参数；自动归位的工单在 P05（17）上线后改到详情。
 */
export const notificationTargets: Readonly<Record<NotificationType, PageDefinition>> = {
  channel_disconnected: pages.settingsChannels,
  channel_recovered: pages.settingsChannels,
  dingtalk_sync_failed: pages.settingsChannels,
  unassigned_mail: pages.tickets,
  unassigned_mail_placed: pages.tickets,
  reassign_queue: pages.aftersalesLedger,
};

/** 跳转时带的地址参数：「未归属店铺来信」直接打开 P04 的未归属店铺队列（I17，待办 15，协调者 2026-10-07 决定） */
export const notificationSearch: Readonly<
  Partial<Record<NotificationType, { view: 'unassigned' }>>
> = { unassigned_mail: { view: 'unassigned' } };

/**
 * 这一条能不能点进去（同 P27 v2.20「对象按查看者能否打开目标页决定可不可点」）：例如客服主管收到渠道连接异常，
 * 但 P18 只对管理员开放——点了只标为已读、不跳转，对象编号不用主色
 */
export function notificationTarget(
  notification: Notification,
  member: CurrentMember,
): PageDefinition | null {
  const page = notificationTargets[notification.type];
  return canOpenPage(member, page) ? page : null;
}

/** 标为已读的对象：点了的一条，或「全部已读」 */
export type ReadTarget = { readonly kind: 'one'; readonly id: string } | { readonly kind: 'all' };

/** 提交标为已读 */
export function submitRead(target: ReadTarget): Promise<void> {
  return target.kind === 'all'
    ? api.markAllNotificationsRead()
    : api.markNotificationRead(target.id);
}

/** 先在缓存里改成已读（列表里的这条或全部、未读数）：面板与角标立即变化，提交失败时由调用方重新拉取 */
export function markReadInCache(queryClient: QueryClient, target: ReadTarget): void {
  const affected = (item: Notification) => target.kind === 'all' || item.id === target.id;
  const lists = queryClient.getQueriesData<NotificationList>({
    queryKey: [...notificationsKey, 'list'],
  });
  const wasUnread = lists.some(([, list]) =>
    list?.items.some((item) => !item.read && affected(item)),
  );
  const remaining = (unread: number) =>
    target.kind === 'all' ? 0 : Math.max(unread - (wasUnread ? 1 : 0), 0);
  for (const [key, list] of lists) {
    if (!list) continue;
    const items = list.items
      .map((item) => (affected(item) ? { ...item, read: true } : item))
      // 「未读」页签只留未读的
      .filter((item) => key.at(-1) !== 'unread' || !item.read);
    queryClient.setQueryData<NotificationList>(key, {
      ...list,
      items,
      unread: remaining(list.unread),
    });
  }
  queryClient.setQueryData<number>(unreadCountQuery.queryKey, (unread) =>
    unread === undefined ? unread : remaining(unread),
  );
}
