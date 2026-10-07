import {
  messageSourceLabels,
  ticketChannelLabels,
  ticketCloseReasonLabels,
  ticketStatusLabels,
  type TicketDetail,
  type TicketStatusStep,
} from '@forcome/contracts';
import type { ReactNode } from 'react';
import { SectionLabel } from '@/components/section-label';
import { TicketStatusBadge } from '@/components/ticket-badges';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { EMPTY_VALUE, FLOW, INFO, ORDER, SLA } from './p05-copy';
import { closeRuleWords, dayClockOf, orderWords, slaLine, stepWords } from './p05-words';

/*
 * P05 右栏（宽 380，卡片间距 12；原型 build_tickets.p05_p1() 与 I18 补充小样③–⑤，待办 17）：工单信息 · 订单（平台镜像）·
 * SLA 结果 · 状态流转。卡片内边距 12 / 16、间距 8，卡头是区块小标题 + 右侧 11 号次要色说明（原型 card(title, extra)）。
 */

function SideCard({
  title,
  extra,
  children,
  testId,
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
  testId: string;
}) {
  return (
    <Card className="gap-2 px-4 py-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>{title}</SectionLabel>
        {extra && <span className="text-11 whitespace-nowrap text-muted-foreground">{extra}</span>}
      </div>
      {children}
    </Card>
  );
}

/** 键值一行（原型 kv()）：12 号，标签次要色、值加粗靠右 */
function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-12 leading-normal">
      <span className="whitespace-nowrap text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-semibold break-words text-foreground">{value}</span>
    </div>
  );
}

function InfoCard({ detail }: { detail: TicketDetail }) {
  const { ticket } = detail;
  return (
    <SideCard title={INFO.title} testId="ticket-info">
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
          <KeyValue label={INFO.store} value={ticket.store.name} />
          <KeyValue label={INFO.site} value={ticket.site} />
          <KeyValue label={INFO.channel} value={ticketChannelLabels[ticket.channel]} />
          <KeyValue label={INFO.source} value={messageSourceLabels[ticket.source]} />
        </div>
        <KeyValue label={INFO.mailbox} value={detail.mailbox} />
        <KeyValue label={INFO.orderNumber} value={ticket.orderNumber ?? EMPTY_VALUE} />
      </div>
    </SideCard>
  );
}

function OrderCardView({ detail }: { detail: TicketDetail }) {
  const order = detail.order;
  if (!order) {
    return (
      <SideCard title={ORDER.title} testId="ticket-order-card">
        <span className="text-12 text-muted-foreground">{ORDER.none}</span>
      </SideCard>
    );
  }
  const words = orderWords(order, new Date(detail.now));
  return (
    <SideCard title={ORDER.title} extra={words.synced} testId="ticket-order-card">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-13 font-bold whitespace-nowrap text-foreground">
            {order.number}
          </span>
          <span className="flex items-center gap-1.5">
            <Badge tone={order.cancelled ? 'muted' : 'neutral'} dot>
              {words.status}
            </Badge>
            <span className="text-12 whitespace-nowrap text-muted-foreground">{words.updated}</span>
          </span>
        </div>
        <div className="flex flex-col gap-0.75">
          <KeyValue label={ORDER.items} value={words.items} />
          <KeyValue label={ORDER.amount} value={words.amount} />
          {words.fulfillment !== null && words.promise !== null && (
            <div className="grid grid-cols-2 gap-x-5">
              <KeyValue label={ORDER.fulfillment} value={words.fulfillment} />
              <KeyValue label={ORDER.promise} value={words.promise} />
            </div>
          )}
          <KeyValue label={ORDER.shipTo} value={words.shipTo} />
          <KeyValue label={ORDER.carrier} value={words.carrier} />
        </div>
      </div>
    </SideCard>
  );
}

function SlaCard({ detail }: { detail: TicketDetail }) {
  const now = new Date(detail.now);
  const target = detail.ticket.channel === 'amazon' ? SLA.target.platform : SLA.target.internal;
  return (
    <SideCard title={SLA.title} extra={target} testId="ticket-sla">
      <div className="flex flex-col gap-2">
        {detail.messages
          .filter((m) => m.direction === 'inbound')
          .map((message) => {
            const line = slaLine(message, now);
            return (
              <div
                key={message.id}
                className="flex items-center gap-2 text-12"
                data-testid="sla-line"
              >
                <span className="w-27 whitespace-nowrap text-muted-foreground tabular-nums">
                  {line.arrival}
                </span>
                <span className="flex-1 font-semibold whitespace-nowrap text-foreground">
                  {line.result}
                </span>
                <Badge tone={line.tone}>{line.note}</Badge>
              </div>
            );
          })}
      </div>
    </SideCard>
  );
}

type Dot = 'done' | 'current' | 'todo' | 'closed';

const DOT_CLASS: Record<Dot, string> = {
  done: 'border-success bg-success',
  current: 'border-primary bg-primary',
  todo: 'border-input bg-card',
  closed: 'border-subtle-foreground bg-subtle-foreground',
};

/** 状态流转的一步（原型 vflow()）：圆点、竖线、左边状态与触发方，右边时间 */
function FlowStep({
  dot,
  head,
  time,
  last,
}: {
  dot: Dot;
  head: ReactNode;
  time: string;
  last: boolean;
}) {
  return (
    <div
      className={cn('relative flex items-start gap-2.5', !last && 'pb-0.75')}
      data-testid="flow-step"
    >
      <span
        aria-hidden
        className={cn('mt-1.25 size-2.5 shrink-0 rounded-full border-2', DOT_CLASS[dot])}
      />
      {!last && (
        <span aria-hidden className="absolute top-4.25 -bottom-0.75 left-1 w-0.5 bg-border" />
      )}
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        {head}
        <span className="text-12 whitespace-nowrap text-subtle-foreground tabular-nums">
          {time}
        </span>
      </div>
    </div>
  );
}

function stepHead(step: TicketStatusStep): ReactNode {
  const badge =
    step.to === 'closed' ? (
      <Badge tone="muted">{ticketStatusLabels.closed}</Badge>
    ) : (
      <TicketStatusBadge status={step.to} />
    );
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {badge}
      <span className="truncate text-11 text-muted-foreground">{stepWords(step)}</span>
    </span>
  );
}

function FlowCard({ detail }: { detail: TicketDetail }) {
  const steps = detail.statusFlow;
  const plan = detail.autoClose;
  const rows: { key: string; dot: Dot; head: ReactNode; time: string }[] = steps.map((step, i) => ({
    key: `step-${i}`,
    dot: step.to === 'closed' ? 'closed' : i === steps.length - 1 ? 'current' : 'done',
    head: stepHead(step),
    time: dayClockOf(step.at),
  }));
  if (plan) {
    rows.push({
      key: 'planned',
      dot: 'todo',
      head: (
        <span className="flex min-w-0 items-center gap-1.5">
          <Badge tone="muted">{ticketStatusLabels.closed}</Badge>
          <span className="truncate text-11 text-muted-foreground">
            {ticketCloseReasonLabels[plan.reason]}
          </span>
        </span>
      ),
      time: FLOW.planned(dayClockOf(plan.at)),
    });
  }
  return (
    <SideCard title={FLOW.title} extra={closeRuleWords(detail.ticket.status)} testId="ticket-flow">
      <div className="flex flex-col">
        {rows.map((row, i) => (
          <FlowStep
            key={row.key}
            dot={row.dot}
            head={row.head}
            time={row.time}
            last={i === rows.length - 1}
          />
        ))}
      </div>
    </SideCard>
  );
}

export function TicketSide({ detail }: { detail: TicketDetail }) {
  return (
    <div className="flex w-95 shrink-0 flex-col gap-3 overflow-y-auto">
      <InfoCard detail={detail} />
      <OrderCardView detail={detail} />
      <SlaCard detail={detail} />
      <FlowCard detail={detail} />
    </div>
  );
}
