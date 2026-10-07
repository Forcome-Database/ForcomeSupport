import { z } from 'zod';
import { orderCardSchema } from './order-card';
import {
  ticketCloseReasonSchema,
  ticketEventSchema,
  ticketListItemSchema,
  ticketMessageSchema,
  ticketStatusSchema,
  ticketTriggerSchema,
} from './ticket';

/*
 * P05 工单详情（PRD P05「第一阶段」、状态 I18，待办 17）：全程记录（消息与事件行）、自动关闭预计、SLA 结果（消息的 sla）、
 * 状态流转与订单卡；以及唯一的写操作「标记无需回复」与 5 秒内的撤销（AC-P1-01）。
 * 时刻一律是业务时刻：由来信或我方回复引起的状态变化取那封邮件的时间，按时关闭取到期时刻，标记与撤销取操作时刻
 * （ADR 0008「待办 17 落地」修订；示例回放把几天的邮件压在几秒内处理，处理时刻对不上邮件时间）。
 */

const instant = z.iso.datetime({ offset: true });

/** 「标记无需回复」的撤销窗口（PRD P05「第一阶段」、AC-P1-01：5 秒内可撤销） */
export const NO_REPLY_UNDO_SECONDS = 5;

export const noReplyActions = ['mark', 'undo'] as const;
export const noReplyActionSchema = z.enum(noReplyActions);
export type NoReplyAction = z.infer<typeof noReplyActionSchema>;

/**
 * 全程记录的一条事件行（按时刻与消息合并、按日期分组）：
 * - status：一次状态变更（新建、新来信、识别到我方回复、重开、按时关闭）；
 * - no_reply：成员标记或撤销「标记无需回复」，to 为它引起的状态变化（全部未回复来信都被标记 → 已解决，撤销 → 待回复），
 *   没有引起状态变化为空。由标记引起的状态变更只作为 no_reply 给出，不另给 status。撤销不删原来那行，再追加一行（协调者 2026-10-07 决定）
 */
export const ticketTimelineEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('status'),
    at: instant,
    event: ticketEventSchema,
    /** 迁移前的状态；新建为空（「新建工单」与「新来信」都是 inbound 事件，靠它区分） */
    from: ticketStatusSchema.nullable(),
    to: ticketStatusSchema,
    trigger: ticketTriggerSchema,
    actorName: z.string(),
    closeReason: ticketCloseReasonSchema.nullable(),
  }),
  z.object({
    kind: z.literal('no_reply'),
    at: instant,
    action: noReplyActionSchema,
    actorName: z.string(),
    /** 被标记的来信 */
    messageId: z.uuid(),
    to: ticketStatusSchema.nullable(),
  }),
]);
export type TicketTimelineEvent = z.infer<typeof ticketTimelineEventSchema>;

/** 状态流转的一步（每次状态变更，新建也是一步；没有引起状态变化的标记与撤销不进状态流转） */
export const ticketStatusStepSchema = z.object({
  at: instant,
  event: ticketEventSchema,
  /** 迁移前的状态；新建为空 */
  from: ticketStatusSchema.nullable(),
  to: ticketStatusSchema,
  trigger: ticketTriggerSchema,
  actorName: z.string(),
  closeReason: ticketCloseReasonSchema.nullable(),
});
export type TicketStatusStep = z.infer<typeof ticketStatusStepSchema>;

/** GET /api/tickets/{number}：P05 工单详情 */
export const ticketDetailSchema = z.object({
  ticket: ticketListItemSchema,
  /** 进线邮箱：收到首封来信的店铺邮箱（工单信息） */
  mailbox: z.string(),
  /** 服务端当前时刻（SLA 剩余按它算；开发测试环境设了起始时刻时与浏览器时钟不同） */
  now: instant,
  /** 自动关闭预计（6.1：待回复 14 天、等客户与已解决 7 天，从最近一封来信起算）；已关闭为空 */
  autoClose: z.object({ at: instant, reason: ticketCloseReasonSchema }).nullable(),
  /** 来信与归到这里的我方回复，按到达时间先后 */
  messages: z.array(ticketMessageSchema),
  /** 事件行，按时刻先后 */
  events: z.array(ticketTimelineEventSchema),
  /** 状态流转，按发生先后 */
  statusFlow: z.array(ticketStatusStepSchema),
  /** 订单卡；没有关联订单为空（「未关联订单」） */
  order: orderCardSchema.nullable(),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

/** 标记无需回复与撤销被拒的说法（400 / 403 / 409 的 message；P05 失败浮层的标题写「<动作>失败：<它>」） */
export const noReplyMessages = {
  notFound: '没有这封来信',
  closed: '工单已关闭，不能标记无需回复',
  replied: '这封来信已被回复，不需要标记',
  marked: (by: string) => `这封来信已被${by}标记无需回复`,
  notMarked: '这封来信没有标记无需回复，没有可撤销的',
  undoExpired: '已超过撤销时限，这封来信保持无需回复',
  notYours: '只有标记的人可以撤销',
} as const;
