import {
  notificationTimeWords,
  type CurrentMember,
  type Notification,
  type NotificationView,
} from '@forcome/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bell, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  fetchByUser,
  markReadInCache,
  notificationListQuery,
  notificationLooks,
  notificationsKey,
  notificationTarget,
  submitRead,
  unreadBadge,
  unreadCountQuery,
  type ReadTarget,
} from '@/lib/notifications';
import { dismissToast, showError } from '@/lib/notify';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { cn } from '@/lib/utils';
import { DisabledReason } from './disabled-reason';
import { EmptyState } from './empty-state';
import { IconTile } from './icon-tile';
import { LoadError } from './load-error';
import { NOTIFICATION_COPY as copy } from './notification-copy';

/*
 * 顶栏的站内通知铃铛与面板（全局状态 G10，原型 build_ds.py 的 icon_btn(badge=)、notif_panel()、notif_item()；
 * 设计规范「通知面板（G10）→ Popover + Tabs + ScrollArea」）：
 * - 铃铛：32 见方的图标按钮，有未读时右上角红色数字角标；
 * - 面板：宽 360，顶部「通知」与右侧「全部已读」（没有未读时置灰，悬停说明原因），页签「全部 · 未读 N」；
 *   每条是类型图标（28 见方、8 圆角、色调浅底）、标题与时间、说明、对象编号，未读的用浅灰底、标题加粗、右侧主色圆点；
 *   底部一行「点一条即跳到对应对象并标为已读」；没有通知时是空状态。通知多时列表在面板里滚动。
 * 点一条：能打开目标页的跳过去并关闭面板，同时标为已读；打不开目标页的（如客服主管的渠道通知，P18 只对管理员）只标为已读，
 * 对象编号不用主色（同 P27「对象按查看者能否打开目标页决定可不可点」）。标为已读先改缓存再提交，失败时 G5 失败浮层。
 */

/** 标为已读失败的浮层（G5）：点一条与全部已读各留一条 */
const readFailures = {
  one: { toastId: 'notification-read', action: copy.failed.read },
  all: { toastId: 'notification-read-all', action: copy.failed.readAll },
} as const satisfies Record<ReadTarget['kind'], { toastId: string; action: string }>;

/**
 * 标为已读：先改缓存再提交，成功后撤掉之前失败的浮层；失败时弹不自动消失的失败浮层（G5）并重新拉取，「立即重试」成功后浮层消失。
 * 会话已结束（401）时不弹，外壳换成登录入口（同 session.ts 的 useSaveDensity）
 */
function useMarkRead() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: notificationsKey });

  return useMutation({
    mutationFn: submitRead,
    onMutate: async (target) => {
      await queryClient.cancelQueries({ queryKey: notificationsKey });
      markReadInCache(queryClient, target);
    },
    onSuccess: (_result, target) => dismissToast(readFailures[target.kind].toastId),
    onSettled: refresh,
    onError: (error, target) => {
      if (endSessionIfUnauthenticated(queryClient, error)) return;
      showError({
        id: readFailures[target.kind].toastId,
        action: readFailures[target.kind].action,
        error,
        retry: async () => {
          try {
            await submitRead(target);
          } catch (retryError) {
            // 会话已结束：浮层随之撤掉，外壳换成登录入口
            if (endSessionIfUnauthenticated(queryClient, retryError)) return;
            throw retryError;
          } finally {
            await refresh();
          }
        },
      });
    },
  });
}

export function NotificationBell({ member }: { member: CurrentMember }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<NotificationView>('all');
  const { data: unread = 0 } = useQuery(unreadCountQuery);
  const badge = unreadBadge(unread);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // 打开面板后的第一次取列表是人的操作
        if (next) fetchByUser(view);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={badge ? `${copy.bell}，${unread} 条未读` : copy.bell}
        >
          <Bell />
          {badge && (
            // 原型 icon_btn 的数字角标：红底白字 10 / 700、1.5px 白边、高 16、行高 13，压在按钮右上角外侧
            <span
              data-testid="notification-badge"
              className="absolute -top-1 -right-1.25 h-4 min-w-4 rounded-full border-[1.5px] border-card bg-destructive px-1 text-center text-10 leading-3.25 font-bold text-primary-foreground"
            >
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      {/* 原型：面板顶边在顶栏下方 6px（top 62），右边距视口 98px（铃铛右边再往右 9px） */}
      <PopoverContent
        align="end"
        sideOffset={18}
        alignOffset={-9}
        // 通知很多时面板到视口底边还留 16（同页面左右的边距），列表在面板里滚动
        collisionPadding={16}
        aria-label={copy.title}
        // 打开时焦点停在面板本身：默认会落到第一个可聚焦处，没有未读时那是「全部已读」的悬停说明，一打开就弹出来
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        className="flex max-h-(--radix-popover-content-available-height) w-90 flex-col overflow-hidden"
      >
        <Panel
          member={member}
          view={view}
          onViewChange={setView}
          unread={unread}
          onNavigate={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function Panel({
  member,
  view,
  onViewChange,
  unread,
  onNavigate,
}: {
  member: CurrentMember;
  view: NotificationView;
  onViewChange: (view: NotificationView) => void;
  unread: number;
  onNavigate: () => void;
}) {
  const queryClient = useQueryClient();
  const list = useQuery(notificationListQuery(view));
  const markRead = useMarkRead();

  // 列表带回的未读数比铃铛的轮询新：拿到就同步给角标
  useEffect(() => {
    if (list.data) queryClient.setQueryData(unreadCountQuery.queryKey, list.data.unread);
  }, [list.data, queryClient]);

  return (
    <Tabs
      value={view}
      onValueChange={(value) => {
        fetchByUser(value as NotificationView);
        onViewChange(value as NotificationView);
      }}
      className="flex min-h-0 flex-col"
    >
      <div className="flex flex-col gap-1 px-3.5 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-14 font-bold text-foreground">{copy.title}</div>
          <DisabledReason reason={unread > 0 ? null : copy.markAllDisabled}>
            <Button
              variant="text-link"
              size="text"
              disabled={unread === 0}
              onClick={() => markRead.mutate({ kind: 'all' })}
              className="gap-1 disabled:bg-transparent disabled:font-normal"
            >
              {copy.markAll}
              {unread > 0 && <Check />}
            </Button>
          </DisabledReason>
        </div>
        <TabsList>
          <TabsTrigger value="all">{copy.tabs.all}</TabsTrigger>
          <TabsTrigger value="unread">
            {copy.tabs.unread}
            <TabsCount>{unread}</TabsCount>
          </TabsTrigger>
        </TabsList>
      </div>
      {/* 已有数据时轮询失败照常显示上次的列表；还没有数据时先骨架、失败（含重试）后才是加载失败 */}
      {list.data ? (
        list.data.items.length === 0 ? (
          // 原型 notif_panel()：空状态放在列表的内边距 6 里
          <div className="p-1.5">
            <EmptyState
              compact
              icon={Bell}
              title={copy.empty.title}
              description={copy.empty.description}
            />
          </div>
        ) : (
          <>
            <ScrollArea className="min-h-0 flex-1">
              <ul className="flex flex-col gap-0.5 p-1.5" aria-label={copy.title}>
                {list.data.items.map((item) => (
                  <li key={item.id}>
                    <NotificationItem
                      item={item}
                      member={member}
                      now={list.data.now}
                      onOpen={(navigates) => {
                        if (!item.read) markRead.mutate({ kind: 'one', id: item.id });
                        if (navigates) onNavigate();
                      }}
                    />
                  </li>
                ))}
              </ul>
            </ScrollArea>
            <div className="border-t border-border-soft px-3.5 py-2 text-11 text-subtle-foreground">
              {copy.footer}
            </div>
          </>
        )
      ) : list.isError ? (
        <LoadError
          onRetry={() => {
            fetchByUser(view);
            void list.refetch();
          }}
        />
      ) : (
        <div className="flex flex-col gap-0.5 p-1.5" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-2.5 px-2.5 py-2.25">
              <Skeleton className="size-7 rounded-md" />
              <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-2.5 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      )}
    </Tabs>
  );
}

function NotificationItem({
  item,
  member,
  now,
  onOpen,
}: {
  item: Notification;
  member: CurrentMember;
  now: string;
  onOpen: (navigates: boolean) => void;
}) {
  const look = notificationLooks[item.type];
  const target = notificationTarget(item, member);
  const className = cn(
    'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2.25 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
    !item.read && 'bg-muted',
  );
  const content = (
    <>
      {!item.read && <span className="sr-only">未读</span>}
      <IconTile icon={look.icon} tone={look.tone} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="flex items-center justify-between gap-3">
          <span
            className={cn(
              'truncate text-body',
              item.read ? 'font-medium text-ink-2' : 'font-semibold text-foreground',
            )}
          >
            {item.title}
          </span>
          <span className="text-11 whitespace-nowrap text-subtle-foreground">
            {notificationTimeWords(item.createdAt, new Date(now))}
          </span>
        </span>
        <span className="truncate text-minor text-muted-foreground">{item.body}</span>
        {/* 能打开目标页的对象编号是主色 500，打不开的是灰字（G10 ①，同 P27） */}
        <span
          className={cn('truncate text-minor', target ? 'font-medium text-primary' : 'text-ink-2')}
        >
          {item.object.label}
        </span>
      </span>
      <span
        aria-hidden
        className={cn('mt-1.5 size-1.75 shrink-0 rounded-full', !item.read && 'bg-primary')}
      />
    </>
  );
  if (target) {
    return (
      <Link
        to={target.path}
        data-testid="notification-item"
        data-read={item.read}
        className={className}
        onClick={() => onOpen(true)}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      data-testid="notification-item"
      data-read={item.read}
      className={className}
      onClick={() => onOpen(false)}
    >
      {content}
    </button>
  );
}
