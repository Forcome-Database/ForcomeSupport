import {
  connectionStatusLabels,
  ORDER_QUEUE_NAME,
  type ChannelCard,
  type ChannelKind,
  type ConnectionStatus,
  type ConnectionTestKind,
  type OrderQueue,
  type Store,
} from '@forcome/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Link2,
  MessageSquare,
  Package,
  RefreshCw,
  Store as StoreIcon,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { IconTile, type IconTileTone } from '@/components/icon-tile';
import { InfoTip } from '@/components/info-tip';
import { SectionLabel } from '@/components/section-label';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api, ApiRequestError } from '@/lib/api';
import { CHANNEL_QUERY_KEY, formatClock } from '@/lib/channel';
import { dismissToast, showError, showSuccess } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { channelCardLines, needsRecheck } from './channel-card-lines';
import {
  A11Y,
  CHANNEL_CARDS,
  CHANNEL_SECTION,
  CONNECTION_TEST,
  GMAIL_ISSUE_LINES,
  LAST_SYNC,
  NOT_AUTHORIZED,
  ORDER_QUEUE_LINE,
  PHASE2_CARDS,
  RULE_CARD_STATE,
  SIMULATED,
} from './p18-copy';

/*
 * P18 渠道卡（第一阶段，K20 与补充小样；原型 build_settings.p18_channels_p1()、gmail_card_p1()、shopify_card_p1()、amazon_card_p1()）：
 * 3 × 2 网格，间距 10。亚马逊 SP-API、Shopify Admin API、Gmail、钉钉四张卡头写连接状态（接模拟数据时前面另标「模拟数据」），
 * 有同步记录时副标题写「最近同步 hh:mm」，未连接写「尚未授权」；说明行按连接状态写（channel-card-lines.ts）；亚马逊卡另有
 * 「订单通知队列（SQS）」一行带状态标签（原型 sqs_line()，待办 12 Q7，各状态下都照写）；四张卡头都有「测试连接」，Gmail、Shopify、
 * 亚马逊卡有连接异常的邮箱或店铺时卡底另有「重新检测」（同一个测试，K7，待办 09、11、12）；积加、易仓为灰色虚线卡「第二阶段接入」，
 * 没有同步时间与测试连接。订单回补行与 Shopify 的回补窗口行随 13。
 */

/** 连接状态 → 徽标色调（原型 STATE_TONE 的渠道连接一组） */
export const connectionTones = {
  connected: 'success',
  delayed: 'warning',
  error: 'danger',
  not_connected: 'muted',
} as const satisfies Record<ConnectionStatus, BadgeTone>;

export function ConnectionBadge({ status, prefix }: { status: ConnectionStatus; prefix?: string }) {
  return (
    <Badge tone={connectionTones[status]} dot>
      {prefix ? `${prefix} ${connectionStatusLabels[status]}` : connectionStatusLabels[status]}
    </Badge>
  );
}

/** 卡片底色跟最差的状态（原型 card(tone)）：同步延迟浅黄、连接异常浅红 */
const statusCard: Record<ConnectionStatus, string> = {
  connected: '',
  delayed: 'border-warning-line bg-warning-card',
  error: 'border-destructive-line bg-destructive-card',
  not_connected: '',
};

const CARD_ICONS: Record<ChannelKind, LucideIcon> = {
  amazon: StoreIcon,
  shopify: StoreIcon,
  gmail: MessageSquare,
  dingtalk: Users,
};

/** 测试成功浮层的说明（测过几个邮箱或店铺） */
function connectionOkWords(kind: ConnectionTestKind, targets: number): string {
  switch (kind) {
    case 'gmail':
      return CONNECTION_TEST.ok.gmail(targets);
    case 'shopify':
      return CONNECTION_TEST.ok.shopify(targets);
    case 'amazon':
      return CONNECTION_TEST.ok.amazon(targets);
    case 'dingtalk':
      return CONNECTION_TEST.ok.dingtalk;
  }
}

/**
 * 测试失败浮层的说明：写怎么查。亚马逊按访问不了的第一个（店铺在前、订单通知队列在后）：只有队列访问不了时写 AWS 的，否则写 SP-API 的
 */
function connectionFailedWords(kind: ConnectionTestKind, message: string): string {
  if (kind === 'amazon' && message.startsWith(ORDER_QUEUE_NAME)) {
    return CONNECTION_TEST.failedDescription.amazonQueue;
  }
  return CONNECTION_TEST.failedDescription[kind];
}

/**
 * 「测试连接」（K20，待办 09 Q4）：测试中按钮置灰转圈；全部可访问时成功浮层，访问不了时失败浮层写哪个访问不了与怎么查；
 * 网络等其他失败给「立即重试」。测试不改连接状态，测完把渠道卡与横幅重取一次（Gmail 测完会立即同步）
 */
function useConnectionTest(kind: ConnectionTestKind) {
  const queryClient = useQueryClient();
  const toastId = `connection-test-${kind}`;
  const mutation = useMutation({
    mutationFn: () => api.testConnection(kind),
    onSuccess: (result) => {
      dismissToast(toastId);
      showSuccess({
        title: CONNECTION_TEST.okTitle,
        description: connectionOkWords(kind, result.targets.length),
      });
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === 'connection_test_failed') {
        showError({
          id: toastId,
          action: CONNECTION_TEST.failedAction,
          error,
          description: connectionFailedWords(kind, error.message),
        });
        return;
      }
      showError({
        id: toastId,
        action: CONNECTION_TEST.failedAction,
        error,
        retry: () => mutation.mutateAsync(),
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CHANNEL_QUERY_KEY }),
  });
  return mutation;
}

type ConnectionTest = ReturnType<typeof useConnectionTest>;

/** 卡头右上的「测试连接」（原型 btn('测试连接', 'link', 'sm')） */
function TestConnectionButton({ test }: { test: ConnectionTest }) {
  return (
    <Button variant="text-link" size="text" loading={test.isPending} onClick={() => test.mutate()}>
      {CONNECTION_TEST.button}
    </Button>
  );
}

function subtitle(card: ChannelCard): string | null {
  if (card.lastSyncAt) return LAST_SYNC(formatClock(card.lastSyncAt));
  return card.status === 'not_connected' ? NOT_AUTHORIZED : null;
}

function CardHead({
  icon,
  tone,
  name,
  sub,
  right,
  muted = false,
}: {
  icon: LucideIcon;
  tone: IconTileTone;
  name: string;
  sub: string | null;
  right: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex shrink-0 items-center gap-2.5">
        <IconTile icon={icon} tone={tone} />
        <div className="flex flex-col">
          <div
            className={cn(
              'text-14 font-semibold whitespace-nowrap',
              muted ? 'text-ink-2' : 'text-foreground',
            )}
          >
            {name}
          </div>
          {sub && <div className="text-11 whitespace-nowrap text-subtle-foreground">{sub}</div>}
        </div>
      </div>
      {/* 卡头右侧标签多时（开发测试环境另有「模拟数据」）一行放不下：标签折到下一行，卡名照原型完整显示 */}
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">{right}</div>
    </div>
  );
}

function ConnectedCard({
  card,
  stores,
  test,
}: {
  card: ChannelCard;
  stores: readonly Store[];
  test: ConnectionTest;
}) {
  const icon = CARD_ICONS[card.kind];
  return (
    <Card
      data-testid={`channel-card-${card.kind}`}
      className={cn('h-full gap-2 px-3.5 py-2.5', statusCard[card.status])}
    >
      <CardHead
        icon={icon}
        tone={connectionTones[card.status]}
        name={CHANNEL_CARDS[card.kind].name}
        sub={subtitle(card)}
        right={
          <>
            {card.simulated && <Badge tone="info">{SIMULATED}</Badge>}
            <ConnectionBadge status={card.status} />
            <TestConnectionButton test={test} />
          </>
        }
      />
      <div data-testid="channel-card-lines" className="flex flex-col gap-0.5">
        {channelCardLines(card, stores).map((line) => (
          <div key={line} className="text-12 text-muted-foreground">
            {line}
          </div>
        ))}
        {card.queue && <OrderQueueLine queue={card.queue} />}
      </div>
      {needsRecheck(card) && (
        <div className="mt-auto flex items-center gap-1.5">
          <Button size="sm" loading={test.isPending} onClick={() => test.mutate()}>
            <RefreshCw />
            {GMAIL_ISSUE_LINES.recheck}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** 订单通知队列（SQS）的标签：文字与色调（原型 sqs_line()：正常 0 绿、有积压黄；积压黄；拉取失败红；未连接灰） */
function orderQueueBadge(queue: OrderQueue): { text: string; tone: BadgeTone } {
  switch (queue.status) {
    case 'normal':
      return {
        text: ORDER_QUEUE_LINE.normal(queue.backlog ?? 0),
        tone: queue.backlog ? 'warning' : 'success',
      };
    case 'backlog':
      return { text: ORDER_QUEUE_LINE.backlog(queue.backlog ?? 0), tone: 'warning' };
    case 'failed':
      return { text: ORDER_QUEUE_LINE.failed, tone: 'danger' };
    case 'not_connected':
      return { text: ORDER_QUEUE_LINE.notConnected, tone: 'muted' };
  }
}

/** 亚马逊卡的「订单通知队列（SQS）」一行（K20、待办 12 Q7）：只影响这一行，不改卡片状态 */
function OrderQueueLine({ queue }: { queue: OrderQueue }) {
  const badge = orderQueueBadge(queue);
  return (
    <div data-testid="order-queue-line" className="flex items-center gap-1.5">
      <span className="text-12 whitespace-nowrap text-muted-foreground">
        {ORDER_QUEUE_LINE.label}
      </span>
      <Badge tone={badge.tone} dot>
        {badge.text}
      </Badge>
    </div>
  );
}

/** 渠道卡带上自己的「测试连接」 */
function TestableCard({
  kind,
  card,
  stores,
}: {
  kind: ConnectionTestKind;
  card: ChannelCard;
  stores: readonly Store[];
}) {
  const test = useConnectionTest(kind);
  return <ConnectedCard card={card} stores={stores} test={test} />;
}

/** 第一阶段尚未接入的渠道（原型 phase2_card()）：灰色虚线卡「第二阶段接入」，没有同步时间与测试连接 */
function PhaseTwoCard({
  icon,
  name,
  description,
}: {
  icon: LucideIcon;
  name: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-input bg-muted px-3.5 py-3">
      <CardHead
        icon={icon}
        tone="muted"
        name={name}
        sub={PHASE2_CARDS.subtitle}
        muted
        right={<Badge tone="muted">{PHASE2_CARDS.badge}</Badge>}
      />
      <div className="text-12 text-muted-foreground">{description}</div>
    </div>
  );
}

export function ChannelCards({
  channels,
  stores,
}: {
  channels: readonly ChannelCard[];
  stores: readonly Store[];
}) {
  return (
    <section aria-label={A11Y.channelsRegion} className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <SectionLabel>{CHANNEL_SECTION.label}</SectionLabel>
        <InfoTip label={CHANNEL_SECTION.ruleLabel} tip={RULE_CARD_STATE} />
      </div>
      <div className="grid grid-cols-3 items-stretch gap-2.5">
        {channels.map((card) => (
          // 第一期四张卡都有「测试连接」（K20，待办 09、11、12）：渠道卡的种类就是测试连接的种类
          <TestableCard key={card.kind} kind={card.kind} card={card} stores={stores} />
        ))}
        <PhaseTwoCard icon={Link2} {...PHASE2_CARDS.jijia} />
        <PhaseTwoCard icon={Package} {...PHASE2_CARDS.yicang} />
      </div>
    </section>
  );
}
