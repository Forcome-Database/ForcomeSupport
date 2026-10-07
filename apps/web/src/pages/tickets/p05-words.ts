import { BUSINESS_TIME_ZONE } from '@forcome/calendar';
import {
  formatMoney,
  fulfillmentChannelLabels,
  messageSourceLabels,
  orderStatusLabel,
  slaRemainingWords,
  ticketCloseReasonLabels,
  ticketStatusLabels,
  type OrderCard,
  type SlaTone,
  type TicketCloseReason,
  type TicketDetail,
  type TicketMessage,
  type TicketStatus,
  type TicketStatusStep,
  type TicketTimelineEvent,
} from '@forcome/contracts';
import type { BadgeTone } from '@/components/ui/badge';
import { formatLastInbound } from '@/lib/tickets';
import {
  ACTOR_TAG,
  AUTO_CLOSE,
  CLOSE_RULE,
  EMPTY_VALUE,
  EVENT,
  FLOW,
  LETTER,
  ORDER,
  SLA,
} from './p05-copy';

/*
 * P05 工单详情的写法（待办 17，协调者 2026-10-07 决定 Q1–Q6；文案在 p05-copy.ts）：时刻都按北京时间；
 * 元信息与状态流转卡头的自动关闭、事件行、状态流转每一步、SLA 结果一行、订单卡。纯函数，单测在 p05-words.test.ts。
 */

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

const WEEKDAYS: Record<string, string> = {
  Mon: '一',
  Tue: '二',
  Wed: '三',
  Thu: '四',
  Fri: '五',
  Sat: '六',
  Sun: '日',
};

function partsOf(iso: string) {
  const all = parts.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    all.find((p) => p.type === type)?.value ?? '';
  return {
    day: `${part('month')}-${part('day')}`,
    clock: `${part('hour')}:${part('minute')}`,
    weekday: WEEKDAYS[part('weekday')] ?? '',
  };
}

/** 时:分（全程记录里同一天的时刻） */
export function clockOf(iso: string): string {
  return partsOf(iso).clock;
}

/** 月-日 */
export function dayOf(iso: string): string {
  return partsOf(iso).day;
}

/** 月-日 时:分 */
export function dayClockOf(iso: string): string {
  const { day, clock } = partsOf(iso);
  return `${day} ${clock}`;
}

/** 日期分隔条「09-04 周五」 */
export function dayLabel(iso: string): string {
  const { day, weekday } = partsOf(iso);
  return `${day} 周${weekday}`;
}

const MINUTE = 60_000;

/** 首次回复时长：「28m」「6h 32m」「1d 3h」（不足一分钟的舍去） */
export function durationWords(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) {
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  }
  return `${Math.floor(minutes / (24 * 60))}d ${Math.floor((minutes % (24 * 60)) / 60)}h`;
}

const reasonOf = (reason: TicketCloseReason | null) =>
  reason ? ticketCloseReasonLabels[reason] : EMPTY_VALUE;

/** 元信息里的自动关闭：未关闭写预计（待回复不写状态前缀），已关闭写实际关闭时刻 */
export function autoCloseWords(detail: Pick<TicketDetail, 'ticket' | 'autoClose' | 'statusFlow'>) {
  const { status } = detail.ticket;
  if (status === 'closed') {
    const closed = detail.statusFlow.findLast((s) => s.to === 'closed');
    return closed ? AUTO_CLOSE.closed(dayClockOf(closed.at), reasonOf(closed.closeReason)) : null;
  }
  const plan = detail.autoClose;
  if (!plan) return null;
  const rule = CLOSE_RULE[status];
  const at = dayClockOf(plan.at);
  const reason = reasonOf(plan.reason);
  return status === 'awaiting_reply'
    ? AUTO_CLOSE.planned(rule, at, reason)
    : AUTO_CLOSE.plannedWithStatus(ticketStatusLabels[status], rule, at, reason);
}

/** 状态流转卡头：未关闭写「已解决 7 天无来信自动关闭」，已关闭不写 */
export function closeRuleWords(status: TicketStatus): string | null {
  return status === 'closed' ? null : FLOW.rule(ticketStatusLabels[status], CLOSE_RULE[status]);
}

/** 一次状态变更的事件名（状态流转「触发方 · 事件」的事件） */
function stepEvent(step: Pick<TicketStatusStep, 'event' | 'from'>): string {
  switch (step.event) {
    case 'inbound':
      return step.from === null ? FLOW.events.created : FLOW.events.inbound;
    case 'inbound_reopen':
      return FLOW.events.reopened;
    case 'reply_detected':
      return FLOW.events.replyDetected;
    case 'all_marked_no_reply':
      return FLOW.events.marked;
    case 'undo_mark_no_reply':
      return FLOW.events.undone;
    case 'idle_7_days':
      return FLOW.events.idle7;
    case 'idle_14_days':
      return FLOW.events.idle14;
  }
}

/** 状态流转的一步：「系统 · 新建」，关闭的那步「系统 · 7 天无来信（客户未回复）」 */
export function stepWords(step: TicketStatusStep): string {
  const event = stepEvent(step);
  return step.to === 'closed'
    ? FLOW.closedStep(step.actorName, event, reasonOf(step.closeReason))
    : FLOW.step(step.actorName, event);
}

/** 事件行：执行者标识（系统 / 人工）与事件 */
export function eventWords(event: TicketTimelineEvent): { actor: string; text: string } {
  if (event.kind === 'no_reply') {
    const to = event.to ? ticketStatusLabels[event.to] : null;
    const text =
      event.action === 'mark'
        ? to
          ? EVENT.markedTo(event.actorName, to)
          : EVENT.marked(event.actorName)
        : to
          ? EVENT.undoneTo(event.actorName, to)
          : EVENT.undone(event.actorName);
    return { actor: ACTOR_TAG.member, text };
  }
  const to = ticketStatusLabels[event.to];
  const reason = reasonOf(event.closeReason);
  const text = (() => {
    switch (event.event) {
      case 'inbound':
        return event.from === null ? EVENT.created(to) : EVENT.inbound(to);
      case 'inbound_reopen':
        return EVENT.reopened(to);
      case 'reply_detected':
        return EVENT.replyDetected(to);
      case 'idle_7_days':
        return EVENT.idle7(reason);
      case 'idle_14_days':
        return EVENT.idle14(reason);
      // 标记与撤销由 no_reply 事件给出；万一出现照迁移写
      case 'all_marked_no_reply':
        return EVENT.markedTo(event.actorName, to);
      case 'undo_mark_no_reply':
        return EVENT.undoneTo(event.actorName, to);
    }
  })();
  return { actor: event.trigger === 'member' ? ACTOR_TAG.member : ACTOR_TAG.system, text };
}

/** 剩余的颜色（R-SL-03）→ 「未到期」徽标的色调：普通为中性灰 */
const PENDING_TONE: Record<SlaTone, BadgeTone> = {
  danger: 'danger',
  warning: 'warning',
  normal: 'neutral',
};

export interface SlaLine {
  readonly arrival: string;
  readonly result: string;
  readonly note: string;
  readonly tone: BadgeTone;
}

/** SLA 结果的一行（每封来信）：来信时刻 · 结果 · 达标 / 未达标 / 未到期 / 不计 */
export function slaLine(message: TicketMessage, now: Date): SlaLine {
  const arrival = SLA.arrival(dayClockOf(message.arrivedAt));
  const source = message.source;
  if (source && source !== 'customer') {
    const label = messageSourceLabels[source];
    return {
      arrival,
      result: SLA.fromSource(label),
      note: LETTER.notCounted(label),
      tone: 'muted',
    };
  }
  const sla = message.sla;
  if (!sla || sla.result === 'not_required') {
    return {
      arrival,
      result: SLA.noReply(message.noReply?.by ?? EMPTY_VALUE),
      note: SLA.notCounted,
      tone: 'muted',
    };
  }
  if (message.firstReplyAt) {
    const duration = durationWords(
      Date.parse(message.firstReplyAt) - Date.parse(message.arrivedAt),
    );
    const met = sla.result === 'met';
    return {
      arrival,
      result: SLA.firstReply(duration),
      note: met ? SLA.results.met : SLA.results.missed,
      tone: met ? 'success' : 'danger',
    };
  }
  const left = slaRemainingWords({ dueAt: new Date(sla.dueAt), now, target: sla.target });
  // 过了截止就是未达标（每分钟的扫描可能还没改过来）
  if (sla.result === 'missed' || now.getTime() > Date.parse(sla.dueAt)) {
    return { arrival, result: left.text, note: SLA.results.missed, tone: 'danger' };
  }
  return {
    arrival,
    result: SLA.remaining(left.text),
    note: SLA.results.pending,
    tone: PENDING_TONE[left.tone],
  };
}

export interface OrderWords {
  readonly synced: string;
  readonly status: string;
  readonly updated: string;
  readonly items: string;
  readonly amount: string;
  /** 亚马逊才有这一行（Shopify 为 null，整行不显示） */
  readonly fulfillment: string | null;
  readonly promise: string | null;
  readonly shipTo: string;
  readonly carrier: string;
}

/** 订单卡的各项写法（Q1、Q2）：状态写平台履约状态的中文，「更新于」平台最近更新日期；没有值写「—」 */
export function orderWords(order: OrderCard, now: Date): OrderWords {
  const amazon = order.platform === 'amazon';
  const items = order.items.map((item) => `${item.title} ×${item.quantity}`).join('、');
  const amount = order.total
    ? `${formatMoney(order.total.amount, order.total.currency)}${
        order.usd ? `（≈ ${formatMoney(order.usd, 'USD')}）` : ''
      }`
    : EMPTY_VALUE;
  const shipTo = order.shipTo
    ? [order.shipTo.city, order.shipTo.province, order.shipTo.country].filter(Boolean).join(', ')
    : '';
  const carrier = order.tracking
    .map((t) => [t.company, t.number].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('、');
  return {
    synced: ORDER.synced(formatLastInbound(order.syncedAt, now)),
    status: orderStatusLabel(order),
    updated: ORDER.updated(dayOf(order.updatedAt)),
    items: items || EMPTY_VALUE,
    amount,
    fulfillment: amazon
      ? order.fulfillmentChannel
        ? fulfillmentChannelLabels[order.fulfillmentChannel]
        : EMPTY_VALUE
      : null,
    promise: amazon
      ? order.promisedDeliveryBy
        ? dayOf(order.promisedDeliveryBy)
        : EMPTY_VALUE
      : null,
    shipTo: shipTo || EMPTY_VALUE,
    carrier: carrier || EMPTY_VALUE,
  };
}
