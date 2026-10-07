import {
  canMarkNoReply,
  messageSourceLabels,
  type TicketDetail,
  type TicketMessage,
  type TicketTimelineEvent,
} from '@forcome/contracts';
import { Check, Factory, Send, Truck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { TicketSourceLabel } from '@/components/ticket-badges';
import { Avatar, AvatarFallback, type AvatarTone } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { A11Y, INBOUND_VIA, LETTER, OUTBOUND, TIMELINE } from './p05-copy';
import { clockOf, dayClockOf, dayLabel, eventWords } from './p05-words';

/*
 * P05 的「全程记录」卡片（原型 build_tickets.p05_p1()、I18 ① ② 与补充小样③–⑥；待办 17）：卡头标题与分段筛选
 * 「全部 · 仅消息 · 仅事件」，内容在卡片内滚动；消息与事件行按时刻合并（同一时刻消息在前）、按日期分组（日期分隔条「09-04 周五」）。
 * - 来信卡：头像（客户为姓名首字母的灰色渐变，生产厂、其他供应商为浅紫底的工厂、货车图标）、名字、「渠道 · 时刻」，
 *   生产厂与其他供应商带来源徽标与「不计（…）」；直邮的正文顶部写「发件人 … → 进线邮箱」与粗体主题；
 *   被标记的写「无需回复 · 李婷 · 09:05」，未关闭工单里的未回复来信有「标记无需回复」（只对有这项能力的成员显示）。
 * - 我方回复卡：「我方 · 发件邮箱」（亚马逊工单加「经亚马逊买家消息」）、浅主色底；自动回复为灰色虚线卡「自动回复 · 不算回复」，
 *   正文顶部写认出它的标记头。
 * - 事件行：分隔线 · 时刻 · 系统 / 人工 · 事件。
 */

type Filter = keyof typeof TIMELINE.filters;

type Item =
  | { readonly kind: 'message'; readonly at: string; readonly message: TicketMessage }
  | { readonly kind: 'event'; readonly at: string; readonly event: TicketTimelineEvent };

/** 消息与事件行按时刻合并：同一时刻消息在前（稳定排序，消息先放） */
function itemsOf(detail: TicketDetail, filter: Filter): Item[] {
  const messages: Item[] =
    filter === 'events'
      ? []
      : detail.messages.map((message) => ({ kind: 'message', at: message.arrivedAt, message }));
  const events: Item[] =
    filter === 'messages'
      ? []
      : detail.events.map((event) => ({ kind: 'event', at: event.at, event }));
  return [...messages, ...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** 日期分隔条（原型 day_sep()） */
function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-0.5" data-testid="day-separator">
      <span className="rounded-sm bg-secondary px-2 text-11 leading-4.5 font-semibold whitespace-nowrap text-muted-foreground">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/** 事件行（原型 ev()）：分隔线 · 时刻 · 执行者标识 · 事件 */
function EventRow({ event }: { event: TicketTimelineEvent }) {
  const { actor, text } = eventWords(event);
  return (
    <div className="flex items-center gap-2.5" data-testid="timeline-event">
      <div className="h-px w-4 shrink-0 bg-border" />
      <span className="text-12 whitespace-nowrap text-subtle-foreground tabular-nums">
        {clockOf(event.at)}
      </span>
      <Badge tone={event.kind === 'no_reply' ? 'warning' : 'neutral'}>{actor}</Badge>
      <span className="text-12 whitespace-nowrap text-ink-2">{text}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/** 客户头像的字：名字前两个词的首字母（原型 customer_msg()） */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toUpperCase();
}

function MessageAvatar({ tone, children }: { tone: AvatarTone; children: ReactNode }) {
  return (
    <Avatar size="md" tone={tone}>
      <AvatarFallback>{children}</AvatarFallback>
    </Avatar>
  );
}

/** 消息卡（原型 ui.message()）：头像 + 卡头（名字、说明、右侧补充）+ 气泡 */
function MessageCard({
  avatar,
  name,
  meta,
  extra,
  bubble,
  testId,
}: {
  avatar: ReactNode;
  name: ReactNode;
  meta: string;
  extra?: ReactNode;
  bubble: ReactNode;
  testId: string;
}) {
  return (
    <div className="flex items-start gap-2.5" data-testid={testId}>
      {avatar}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {name}
          <span className="text-12 text-subtle-foreground">{meta}</span>
          {extra}
        </div>
        {bubble}
      </div>
    </div>
  );
}

const bubbleClass =
  'rounded-lg rounded-tl-[4px] border px-3.25 text-13 leading-[1.6] break-words whitespace-pre-wrap';

/** 邮件头小字（原型 mail_hdr()：直邮的发件人与进线邮箱、自动回复的标记头） */
function MailHeader({ children }: { children: ReactNode }) {
  return (
    <div className="mb-0.5 text-11 leading-normal text-subtle-foreground tabular-nums">
      {children}
    </div>
  );
}

function InboundCard({
  message,
  status,
  canMark,
  marking,
  onMark,
}: {
  message: TicketMessage;
  status: TicketDetail['ticket']['status'];
  canMark: boolean;
  marking: boolean;
  onMark: () => void;
}) {
  const source = message.source ?? 'customer';
  const name = message.from.name || message.from.address;
  const channel = message.channel ?? 'email';
  const avatar =
    source === 'customer' ? (
      <MessageAvatar tone="customer">{initialsOf(name)}</MessageAvatar>
    ) : (
      <MessageAvatar tone="violet">
        {source === 'producer' ? (
          <Factory className="size-3.5" strokeWidth={2} />
        ) : (
          <Truck className="size-3.5" strokeWidth={2} />
        )}
      </MessageAvatar>
    );
  const markedAt = message.noReply
    ? dayLabel(message.noReply.at) === dayLabel(message.arrivedAt)
      ? clockOf(message.noReply.at)
      : dayClockOf(message.noReply.at)
    : null;
  const extra = (
    <>
      {source !== 'customer' && (
        <>
          <TicketSourceLabel source={source} />
          <Badge tone="muted">{LETTER.notCounted(messageSourceLabels[source])}</Badge>
        </>
      )}
      {message.noReply && markedAt ? (
        <Badge tone="muted" className="ml-auto" data-testid="no-reply-mark">
          <Check aria-hidden className="size-3" strokeWidth={2} />
          {LETTER.marked(message.noReply.by, markedAt)}
        </Badge>
      ) : (
        canMark &&
        canMarkNoReply(status, message) && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            loading={marking}
            onClick={onMark}
          >
            {!marking && <Check />}
            {LETTER.mark}
          </Button>
        )
      )}
    </>
  );
  return (
    <MessageCard
      testId="timeline-inbound"
      avatar={avatar}
      name={<span className="text-13 font-semibold text-foreground">{name}</span>}
      meta={`${INBOUND_VIA[channel]} · ${clockOf(message.arrivedAt)}`}
      extra={extra}
      bubble={
        <div className={cn(bubbleClass, 'border-border bg-card py-2.25 text-foreground shadow-xs')}>
          {channel === 'email' && (
            <>
              <MailHeader>{LETTER.mailHeader(message.from.address, message.mailbox)}</MailHeader>
              <div className="font-semibold">{message.subject}</div>
            </>
          )}
          {message.body}
        </div>
      }
    />
  );
}

function OutboundCard({ message, viaAmazon }: { message: TicketMessage; viaAmazon: boolean }) {
  const at = clockOf(message.arrivedAt);
  if (message.autoReply) {
    return (
      <MessageCard
        testId="timeline-auto-reply"
        avatar={
          <MessageAvatar tone="grey">
            <Send className="size-3.25 text-subtle-foreground" strokeWidth={2} />
          </MessageAvatar>
        }
        name={
          <span className="text-13 font-semibold text-muted-foreground">{OUTBOUND.sender}</span>
        }
        meta={`${message.from.address} · ${at}`}
        extra={<Badge tone="muted">{OUTBOUND.autoReply}</Badge>}
        bubble={
          <div
            className={cn(
              bubbleClass,
              'border-dashed border-input bg-muted pt-1.75 pb-2.25 text-muted-foreground',
            )}
          >
            {message.autoReplyHeader && <MailHeader>{message.autoReplyHeader}</MailHeader>}
            {message.body}
          </div>
        }
      />
    );
  }
  return (
    <MessageCard
      testId="timeline-outbound"
      avatar={
        <MessageAvatar tone="grey">
          <Send className="size-3.25 text-ink-2" strokeWidth={2} />
        </MessageAvatar>
      }
      name={<span className="text-13 font-semibold text-foreground">{OUTBOUND.sender}</span>}
      meta={[message.from.address, ...(viaAmazon ? [OUTBOUND.viaAmazon] : []), at].join(' · ')}
      bubble={
        <div
          className={cn(
            bubbleClass,
            'border-primary-line bg-message-out py-2.25 text-foreground shadow-xs',
          )}
        >
          {message.body}
        </div>
      }
    />
  );
}

export function TicketTimeline({
  detail,
  canMark,
  marking,
  onMark,
}: {
  detail: TicketDetail;
  /** 有「标记无需回复」能力（坐席、客服主管） */
  canMark: boolean;
  /** 正在提交标记的来信 */
  marking: ReadonlySet<string>;
  onMark: (message: TicketMessage) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const rows: ReactNode[] = [];
  let lastDay: string | null = null;
  for (const item of itemsOf(detail, filter)) {
    const day = dayLabel(item.at);
    if (day !== lastDay) {
      rows.push(<DaySeparator key={`day-${day}`} label={day} />);
      lastDay = day;
    }
    if (item.kind === 'event') {
      rows.push(<EventRow key={`event-${rows.length}`} event={item.event} />);
    } else if (item.message.direction === 'inbound') {
      rows.push(
        <InboundCard
          key={item.message.id}
          message={item.message}
          status={detail.ticket.status}
          canMark={canMark}
          marking={marking.has(item.message.id)}
          onMark={() => onMark(item.message)}
        />,
      );
    } else {
      rows.push(
        <OutboundCard
          key={item.message.id}
          message={item.message}
          viaAmazon={detail.ticket.channel === 'amazon'}
        />,
      );
    }
  }
  return (
    <Card className="min-h-0 flex-1 gap-3 px-4.5 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-13 font-bold text-foreground">{TIMELINE.title}</h2>
        <ToggleGroup
          type="single"
          aria-label={A11Y.filters}
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value as Filter);
          }}
        >
          {(Object.keys(TIMELINE.filters) as Filter[]).map((key) => (
            <ToggleGroupItem key={key} value={key} className="py-0.5 text-12">
              {TIMELINE.filters[key]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div
        data-testid="timeline"
        className="flex min-h-0 flex-1 flex-col gap-1.75 overflow-y-auto pr-1.5"
      >
        {rows}
      </div>
    </Card>
  );
}
