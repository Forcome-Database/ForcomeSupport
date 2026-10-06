import {
  messageSourceLabels,
  slaRemainingWords,
  ticketChannelLabels,
  ticketStatusLabels,
  type Site,
  type SlaTarget,
  type SlaTone,
  type TicketChannel,
  type TicketSource,
  type TicketStatus,
} from '@forcome/contracts';
import { Clock, Factory, Truck } from 'lucide-react';
import { Badge, ChannelBadge, type BadgeTone } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/*
 * 工单的状态、渠道与来源徽标（原型 state()、channel() 与 source_badge()，P04、P05 共用）：状态一律带点，颜色由原型
 * STATE_TONE 的唯一映射决定（待回复 浅靛蓝、等客户 描边、已解决 绿、已关闭 灰）；渠道徽标写「渠道 站点」，后面跟店铺名；
 * 来源只给非客户标徽标。
 */

const STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  awaiting_reply: 'accent',
  awaiting_customer: 'outline',
  resolved: 'success',
  closed: 'muted',
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {ticketStatusLabels[status]}
    </Badge>
  );
}

const CHANNEL_TONE = { amazon: 'amazon', shopify: 'shopify', email: 'mail' } as const;

/** 渠道与站点徽标的文字：「亚马逊 US」「Shopify MX」「邮件 US」 */
export function channelLabel(channel: TicketChannel, site: Site): string {
  return `${ticketChannelLabels[channel]} ${site}`;
}

/** 渠道与店铺（原型 channel(平台, 站点, 店铺)）：渠道徽标 + 次要字号（舒适 12、紧凑 11）次要色店铺名 */
export function TicketChannelStore({
  channel,
  site,
  store,
}: {
  channel: TicketChannel;
  site: Site;
  store: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <ChannelBadge channel={CHANNEL_TONE[channel]}>{channelLabel(channel, site)}</ChannelBadge>
      <span className="truncate text-minor text-muted-foreground" title={store}>
        {store}
      </span>
    </span>
  );
}

/**
 * 来源（原型 p1_row 与 source_badge()，P04「来源（非客户时显示徽标）」）：客户只写「客户」（最淡的次要色，
 * 随密度 12 / 11）；生产厂、其他供应商为紫色徽标（flow 色调，与时间线「工厂」执行者同色），带工厂、货车图标
 */
export function TicketSourceLabel({ source }: { source: TicketSource }) {
  if (source === 'customer') {
    return (
      <span className="text-minor whitespace-nowrap text-subtle-foreground">
        {messageSourceLabels.customer}
      </span>
    );
  }
  const Icon = source === 'producer' ? Factory : Truck;
  return (
    <Badge tone="flow">
      <Icon aria-hidden className="size-3" strokeWidth={2} />
      {messageSourceLabels[source]}
    </Badge>
  );
}

/** SLA 剩余的颜色（R-SL-03，原型 sla()）：≤ 2 小时与已超时红、≤ 6 小时黄，其余灰底 */
const SLA_TONE: Record<SlaTone, string> = {
  danger: 'bg-destructive-soft text-destructive-text',
  warning: 'bg-warning-soft text-warning-text',
  normal: 'bg-secondary text-ink-2',
};

/**
 * SLA 剩余胶囊（原型 sla()）：11 / 600、6 圆角、左右 7、行高 20，前面 11 的时钟；写法与颜色按 contracts 的 slaRemainingWords
 * （剩余「23h 42m」、已超时「已超时 2h 05m」，内部目标加「· 内部」）。未归属店铺队列（I17，待办 15）起用，P04 的 SLA 列（18）、P05（17）同用
 */
export function SlaBadge({ dueAt, now, target }: { dueAt: string; now: Date; target: SlaTarget }) {
  const { text, tone } = slaRemainingWords({ dueAt: new Date(dueAt), now, target });
  return (
    <span
      data-testid="sla-badge"
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1.75 text-11 leading-5 font-semibold whitespace-nowrap tabular-nums',
        SLA_TONE[tone],
      )}
    >
      <Clock className="size-2.75 shrink-0" strokeWidth={2} />
      {text}
    </span>
  );
}
