import {
  connectionStatusLabels,
  type ChannelCard,
  type ChannelKind,
  type ConnectionStatus,
  type Store,
} from '@forcome/contracts';
import {
  Link2,
  MessageSquare,
  Package,
  Store as StoreIcon,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { InfoTip } from '@/components/info-tip';
import { SectionLabel } from '@/components/section-label';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatClock } from '@/lib/channel';
import { cn } from '@/lib/utils';
import {
  A11Y,
  CARD_LINES,
  CHANNEL_CARDS,
  CHANNEL_SECTION,
  LAST_SYNC,
  NOT_AUTHORIZED,
  PHASE2_CARDS,
  RULE_CARD_STATE,
  SIMULATED,
} from './p18-copy';

/*
 * P18 渠道卡（第一阶段，K20；原型 build_settings.p18_channels_p1()）：3 × 2 网格，间距 10。
 * 亚马逊 SP-API、Shopify Admin API、Gmail、钉钉四张卡头写连接状态（接模拟数据时前面另标「模拟数据」），
 * 有同步记录时副标题写「最近同步 hh:mm」，未连接写「尚未授权」；积加、易仓为灰色虚线卡「第二阶段接入」，没有同步时间与测试连接。
 * 「测试连接」、亚马逊卡的订单通知队列（SQS）与订单回补行、Shopify 卡的回补窗口行随 09、11、12、13 号待办加上。
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

type TileTone = (typeof connectionTones)[ConnectionStatus];

/** 图标块的色调（原型 tile()：ok / warn / bad 为浅底配文字色，muted 为浅线色底配次要色） */
const tileTones: Record<TileTone, string> = {
  success: 'bg-success-soft text-success-text',
  warning: 'bg-warning-soft text-warning-text',
  danger: 'bg-destructive-soft text-destructive-text',
  muted: 'bg-border-soft text-muted-foreground',
};

/** 卡头左侧 32 的图标块（原型 tile()），色调跟连接状态（与状态徽标同一张映射） */
function Tile({ icon: Icon, tone }: { icon: LucideIcon; tone: TileTone }) {
  return (
    <div
      className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', tileTones[tone])}
    >
      <Icon className="size-4.5" strokeWidth={1.75} />
    </div>
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

/** 各卡的说明行（第一期能力，K20）：店铺数、邮箱数按数据写 */
function cardLines(kind: ChannelKind, stores: readonly Store[]): string[] {
  const storeCount = (platform: Store['platform']) =>
    stores.filter((s) => s.platform === platform).length;
  const mailboxCount = (platform: Store['platform']) =>
    stores.filter((s) => s.platform === platform).reduce((n, s) => n + s.mailboxes.length, 0);
  switch (kind) {
    case 'amazon':
      return [CHANNEL_CARDS.amazon.stores(storeCount('amazon'))];
    case 'shopify':
      return [CHANNEL_CARDS.shopify.stores(storeCount('shopify'))];
    case 'gmail':
      return [
        CHANNEL_CARDS.gmail.mailboxes(mailboxCount('amazon'), mailboxCount('shopify')),
        CARD_LINES.gmailSent,
      ];
    case 'dingtalk':
      return [...CARD_LINES.dingtalk];
  }
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
  tone: TileTone;
  name: string;
  sub: string | null;
  right: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <Tile icon={icon} tone={tone} />
        <div className="flex min-w-0 flex-col">
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
      <div className="flex shrink-0 items-center gap-1.5">{right}</div>
    </div>
  );
}

function ConnectedCard({ card, stores }: { card: ChannelCard; stores: readonly Store[] }) {
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
          </>
        }
      />
      <div className="flex flex-col gap-0.5">
        {cardLines(card.kind, stores).map((line) => (
          <div key={line} className="text-12 text-muted-foreground">
            {line}
          </div>
        ))}
      </div>
    </Card>
  );
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
          <ConnectedCard key={card.kind} card={card} stores={stores} />
        ))}
        <PhaseTwoCard icon={Link2} {...PHASE2_CARDS.jijia} />
        <PhaseTwoCard icon={Package} {...PHASE2_CARDS.yicang} />
      </div>
    </section>
  );
}
