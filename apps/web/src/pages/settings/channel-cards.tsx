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

/*
 * P18 渠道卡（第一阶段，K20；原型 build_settings.p18_channels_p1()）：3 × 2 网格，间距 10。
 * 亚马逊 SP-API、Shopify Admin API、Gmail、钉钉四张卡头写连接状态（接模拟数据时前面另标「模拟数据」），
 * 有同步记录时副标题写「最近同步 hh:mm」，未连接写「尚未授权」；积加、易仓为灰色虚线卡「第二阶段接入」，没有同步时间与测试连接。
 * 「测试连接」、亚马逊卡的订单通知队列（SQS）与订单回补行、Shopify 卡的回补窗口行随 09、11、12、13 号待办加上。
 */

const RULE_CARD_STATE =
  '卡片显示该渠道下最差的状态，并列出异常的邮箱或店铺；店铺表「状态」列显示该店铺各连接的状态。' +
  '同步延迟按数据源阈值：Gmail、订单 10 分钟，钉钉 2 小时；连续 3 次失败为连接异常。' +
  '钉钉例外：异常只在钉钉卡显示、只提醒管理员，不出全站横幅（6.9）。';

/** 连接状态 → 徽标色调（原型 STATE_TONE 的渠道连接一组） */
export const connectionTones: Record<ConnectionStatus, BadgeTone> = {
  connected: 'success',
  delayed: 'warning',
  error: 'danger',
  not_connected: 'muted',
};

export function ConnectionBadge({ status, prefix }: { status: ConnectionStatus; prefix?: string }) {
  return (
    <Badge tone={connectionTones[status]} dot>
      {prefix ? `${prefix} ${connectionStatusLabels[status]}` : connectionStatusLabels[status]}
    </Badge>
  );
}

type TileTone = 'success' | 'warning' | 'danger' | 'muted';

const tileTones: Record<TileTone, string> = {
  success: 'bg-success-soft text-success-text',
  warning: 'bg-warning-soft text-warning-text',
  danger: 'bg-destructive-soft text-destructive-text',
  muted: 'bg-border-soft text-subtle-foreground',
};

/** 卡头左侧 32 的图标块（原型 tile()），色调跟连接状态 */
function Tile({ icon: Icon, tone }: { icon: LucideIcon; tone: TileTone }) {
  return (
    <div
      className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', tileTones[tone])}
    >
      <Icon className="size-4.5" strokeWidth={1.75} />
    </div>
  );
}

const statusTile: Record<ConnectionStatus, TileTone> = {
  connected: 'success',
  delayed: 'warning',
  error: 'danger',
  not_connected: 'muted',
};

/** 卡片底色跟最差的状态（原型 card(tone)）：同步延迟浅黄、连接异常浅红 */
const statusCard: Record<ConnectionStatus, string> = {
  connected: '',
  delayed: 'border-warning-line bg-warning-card',
  error: 'border-destructive-line bg-destructive-card',
  not_connected: '',
};

const CARD_META: Record<ChannelKind, { name: string; icon: LucideIcon }> = {
  amazon: { name: '亚马逊 SP-API', icon: StoreIcon },
  shopify: { name: 'Shopify Admin API', icon: StoreIcon },
  gmail: { name: 'Gmail', icon: MessageSquare },
  dingtalk: { name: '钉钉', icon: Users },
};

/** Gmail 卡的邮箱数：「4 个邮箱：2 个亚马逊买家消息、2 个 Shopify 客服」（某一类没有就不写） */
function mailboxLine(stores: readonly Store[]): string {
  const count = (platform: Store['platform']) =>
    stores.filter((s) => s.platform === platform).reduce((n, s) => n + s.mailboxes.length, 0);
  const amazon = count('amazon');
  const shopify = count('shopify');
  const parts = [
    amazon > 0 ? `${amazon} 个亚马逊买家消息` : null,
    shopify > 0 ? `${shopify} 个 Shopify 客服` : null,
  ].filter(Boolean);
  const total = amazon + shopify;
  return parts.length > 0 ? `${total} 个邮箱：${parts.join('、')}` : `${total} 个邮箱`;
}

/** 各卡的说明行（第一期能力，K20） */
function cardLines(kind: ChannelKind, stores: readonly Store[]): string[] {
  const storeCount = (platform: Store['platform']) =>
    stores.filter((s) => s.platform === platform).length;
  switch (kind) {
    case 'amazon':
      return [`${storeCount('amazon')} 个店铺 · 订单经 SP-API 准实时同步`];
    case 'shopify':
      return [`${storeCount('shopify')} 个店铺 · 订单经 Admin API 准实时同步`];
    case 'gmail':
      return [mailboxLine(stores), '收件与「已发送」：识别到我方回复即转等客户'];
    case 'dingtalk':
      return ['通讯录：成员与部门每小时同步', '工作通知推送；扫码登录'];
  }
}

function subtitle(card: ChannelCard): string | null {
  if (card.lastSyncAt) return `最近同步 ${formatClock(card.lastSyncAt)}`;
  return card.status === 'not_connected' ? '尚未授权' : null;
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
  const meta = CARD_META[card.kind];
  return (
    <Card
      data-testid={`channel-card-${card.kind}`}
      className={cn('h-full gap-2 px-3.5 py-2.5', statusCard[card.status])}
    >
      <CardHead
        icon={meta.icon}
        tone={statusTile[card.status]}
        name={meta.name}
        sub={subtitle(card)}
        right={
          <>
            {card.simulated && <Badge tone="info">模拟数据</Badge>}
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
        sub="暂不连接"
        muted
        right={<Badge tone="muted">第二阶段接入</Badge>}
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
    <section aria-label="渠道连接" className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <SectionLabel>渠道连接</SectionLabel>
        <InfoTip label="卡片状态按店铺计算" tip={RULE_CARD_STATE} />
      </div>
      <div className="grid grid-cols-3 items-stretch gap-2.5">
        {channels.map((card) => (
          <ConnectedCard key={card.kind} card={card} stores={stores} />
        ))}
        <PhaseTwoCard
          icon={Link2}
          name="积加 ERP"
          description="亚马逊订单收件人、库存、售后出库单、单号与运费。"
        />
        <PhaseTwoCard
          icon={Package}
          name="易仓海外仓"
          description="库存与售后出库单经积加读写，本系统不直连易仓接口。"
        />
      </div>
    </section>
  );
}
