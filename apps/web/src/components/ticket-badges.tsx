import {
  ticketChannelLabels,
  ticketStatusLabels,
  type Site,
  type TicketChannel,
  type TicketStatus,
} from '@forcome/contracts';
import { Badge, ChannelBadge, type BadgeTone } from '@/components/ui/badge';

/*
 * 工单的状态与渠道徽标（原型 state() 与 channel()，P04、P05 共用）：状态一律带点，颜色由原型 STATE_TONE 的
 * 唯一映射决定（待回复 浅靛蓝、等客户 描边、已解决 绿、已关闭 灰）；渠道徽标写「渠道 站点」，后面跟店铺名。
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
