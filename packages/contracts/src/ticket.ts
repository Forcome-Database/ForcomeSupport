import { z } from 'zod';
import { siteSchema } from './channel';
import { slaResultSchema, slaTargetSchema } from './sla';

/*
 * 工单（PRD 11.1 Ticket、6.1「第一阶段工单生命周期」、P04「第一阶段」）：状态、渠道、迁移的事件与触发方、
 * 关闭原因，以及 P04 列表与工单详情的输出结构。迁移表本身（哪个状态遇到哪个事件变成什么）在 ticket 模块
 * 的 lifecycle.ts（ADR 0008：状态机放在对象所属的模块内），这里只放前后端共用的取值与叫法。
 */

/** 第一阶段的工单状态（6.1 第一阶段迁移表）：待回复 · 等客户 · 已解决 · 已关闭 */
export const ticketStatuses = [
  'awaiting_reply',
  'awaiting_customer',
  'resolved',
  'closed',
] as const;
export const ticketStatusSchema = z.enum(ticketStatuses);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;
export const ticketStatusLabels: Record<TicketStatus, string> = {
  awaiting_reply: '待回复',
  awaiting_customer: '等客户',
  resolved: '已解决',
  closed: '已关闭',
};

/** 渠道（R-TK-08、PRD 1.4）：亚马逊（买家消息）· Shopify（店铺联系表单）· 邮件（直邮） */
export const ticketChannels = ['amazon', 'shopify', 'email'] as const;
export const ticketChannelSchema = z.enum(ticketChannels);
export type TicketChannel = z.infer<typeof ticketChannelSchema>;
export const ticketChannelLabels: Record<TicketChannel, string> = {
  amazon: '亚马逊',
  shopify: 'Shopify',
  email: '邮件',
};

/**
 * 来信的来源（PRD 1.4「来源」、11.1 Message）：发件方类型，由 channel 按来源规则表判定（规格 channel「来源识别」）。
 * 平台通知与营销归档、不建工单；生产厂与其他供应商照常建工单并标注来源，但不是应回复来信，不计工单量与 SLA（D-23、D-24）。
 */
export const messageSources = [
  'customer',
  'platform_notification',
  'producer',
  'other_supplier',
  'marketing',
] as const;
export const messageSourceSchema = z.enum(messageSources);
export type MessageSource = z.infer<typeof messageSourceSchema>;
export const messageSourceLabels: Record<MessageSource, string> = {
  customer: '客户',
  platform_notification: '平台通知',
  producer: '生产厂',
  other_supplier: '其他供应商',
  marketing: '营销',
};

/**
 * 工单的来源（11.1 Ticket「来源（首封来信的来源）」）：只有会建工单的三种，也是 P04 来源筛选的取值
 * （客户 / 生产厂 / 其他供应商，P04「第一阶段」）
 */
export const ticketSources = ['customer', 'producer', 'other_supplier'] as const;
export const ticketSourceSchema = z.enum(ticketSources);
export type TicketSource = z.infer<typeof ticketSourceSchema>;

/** 会建工单的来源（客户、生产厂、其他供应商） */
export function isTicketSource(source: MessageSource): source is TicketSource {
  return (ticketSources as readonly MessageSource[]).includes(source);
}

/** 归档、不建工单的来源（平台通知、营销） */
export function isArchivedSource(source: MessageSource): boolean {
  return !isTicketSource(source);
}

/**
 * 引起状态迁移的事件（6.1 第一阶段迁移表的「事件」列，一次定好；各行随待办补齐）：
 * - inbound：新来信（不论来源）——没有可追加或重开的工单时新建为待回复；待回复的工单追加、状态不变；
 *   等客户、已解决的工单回到待回复（16）
 * - inbound_reopen：已关闭（30 天内）的工单收到同一订单的来信，重开为待回复（14）
 * - reply_detected：识别到我方回复，且该回复之后没有未回复来信（16）
 * - all_marked_no_reply：全部未回复来信都被「标记无需回复」（17）
 * - undo_mark_no_reply：5 秒内撤销「标记无需回复」（17）
 * - idle_14_days：待回复 14 天无新来信（16）
 * - idle_7_days：等客户或已解决 7 天无来信（16）
 */
export const ticketEvents = [
  'inbound',
  'inbound_reopen',
  'reply_detected',
  'all_marked_no_reply',
  'undo_mark_no_reply',
  'idle_14_days',
  'idle_7_days',
] as const;
export const ticketEventSchema = z.enum(ticketEvents);
export type TicketEvent = z.infer<typeof ticketEventSchema>;

/** 迁移的触发方（6.1「触发方」列）：系统，或坐席 / 客服主管 */
export const ticketTriggers = ['system', 'member'] as const;
export const ticketTriggerSchema = z.enum(ticketTriggers);
export type TicketTrigger = z.infer<typeof ticketTriggerSchema>;

/** 自动关闭的原因（6.1、D-24 ①）：三种，工单上另存 */
export const ticketCloseReasons = [
  'customer_no_reply',
  'resolved_no_inbound',
  'reply_not_detected',
] as const;
export const ticketCloseReasonSchema = z.enum(ticketCloseReasons);
export type TicketCloseReason = z.infer<typeof ticketCloseReasonSchema>;
export const ticketCloseReasonLabels: Record<TicketCloseReason, string> = {
  customer_no_reply: '客户未回复',
  resolved_no_inbound: '已解决后无来信',
  reply_not_detected: '未识别到回复',
};

/** 消息的方向：来信 inbound（不论来源）/ 我方发出 outbound（「已发送」，09 入库，16 起按回复识别归到工单） */
export const messageDirections = ['inbound', 'outbound'] as const;
export const messageDirectionSchema = z.enum(messageDirections);
export type MessageDirection = z.infer<typeof messageDirectionSchema>;

/** 工单号 T-日期-4 位当日序号（11.2；日期取首封来信日期，北京时间） */
export const ticketNumberSchema = z.string().regex(/^T-\d{8}-\d{4}$/, '工单号的格式是 T-日期-序号');

/** P04 工单列表的一行（第一阶段；SLA 剩余随 18） */
export const ticketListItemSchema = z.object({
  id: z.uuid(),
  number: ticketNumberSchema,
  subject: z.string(),
  /** 工单的来源：首封来信的来源（11.1 Ticket） */
  source: ticketSourceSchema,
  /**
   * 渠道（R-TK-08）与站点，都取首封来信：亚马逊按发件域；Shopify 店铺关联到订单时按订单收件国家（收件国家不是 US / CA / MX
   * 时取店铺默认站点），没有订单时取店铺默认站点——Shopify 店铺收到的直邮同样如此；亚马逊店铺按发件域，不是亚马逊的域时取店铺默认站点
   * （R-ST-02，待办 14）
   */
  channel: ticketChannelSchema,
  site: siteSchema,
  store: z.object({ id: z.uuid(), name: z.string() }),
  customer: z.object({ name: z.string() }),
  /**
   * 关联的订单号（R-TK-01，待办 14）：亚马逊为订单号（3-7-7），Shopify 为订单名（如 #1063）；没有关联订单为空（P04 写「—」）
   */
  orderNumber: z.string().nullable(),
  status: ticketStatusSchema,
  /** 关闭原因（6.1 三种，按时关闭时写入，16）；没关闭为空 */
  closeReason: ticketCloseReasonSchema.nullable(),
  /** 工单内最近一封来信的到达时间（Gmail internalDate） */
  lastInboundAt: z.iso.datetime({ offset: true }),
});
export type TicketListItem = z.infer<typeof ticketListItemSchema>;

/** GET /api/tickets：店铺范围内的工单 */
export const ticketListSchema = z.object({ tickets: z.array(ticketListItemSchema) });
export type TicketList = z.infer<typeof ticketListSchema>;

/**
 * 一封应回复来信（来源为客户）的 SLA（R-SL-01–R-SL-03、R-SL-08，16）：目标种类（亚马逊为平台 SLA，Shopify 与邮件为内部目标）、
 * 截止（到达 + 24 小时）与结果（达标 / 未达标 / 未到期 / 无需回复）。生产厂、其他供应商的来信与我方发出的消息没有
 */
export const ticketMessageSlaSchema = z.object({
  target: slaTargetSchema,
  dueAt: z.iso.datetime({ offset: true }),
  result: slaResultSchema,
});
export type TicketMessageSla = z.infer<typeof ticketMessageSlaSchema>;

/** 来信被「标记无需回复」（P05「第一阶段」，待办 17）：操作人与时刻；来信卡写「无需回复 · 李婷 · 09:05」 */
export const noReplyMarkSchema = z.object({
  by: z.string(),
  at: z.iso.datetime({ offset: true }),
});
export type NoReplyMark = z.infer<typeof noReplyMarkSchema>;

/** 工单里的一封消息：来信与「已发送」里归到这张工单的我方回复（16；正文与「无需回复」随 17） */
export const ticketMessageSchema = z.object({
  id: z.uuid(),
  direction: messageDirectionSchema,
  /** 收到这封信的店铺邮箱（进线邮箱） */
  mailbox: z.string(),
  /**
   * 发件人：来信为客户渠道身份（R-TK-08）——亚马逊为买家消息中转地址，Shopify 联系表单为表单里的回复邮箱，其余为发件地址；
   * 我方发出的为发件的店铺邮箱（P05「我方 · 发件邮箱」）
   */
  from: z.object({ name: z.string(), address: z.string() }),
  /** 来信的来源（归档的平台通知与营销不会进工单）；我方发出的消息为空 */
  source: ticketSourceSchema.nullable(),
  /** 来信自己的渠道（同一张工单里可能有亚马逊中转来信与直邮；P05 来信卡头写「亚马逊买家消息 / Shopify 联系表单 / 邮件」）；我方发出的为空 */
  channel: ticketChannelSchema.nullable(),
  subject: z.string(),
  /** 到达时间（Gmail internalDate） */
  arrivedAt: z.iso.datetime({ offset: true }),
  /** 同一封邮件（Message-ID 相同）同时发到的其他店铺邮箱（R-TK-07）：只按最早收到（同步入库）的一封归并，其余记在这里 */
  alsoSentTo: z.array(z.string()),
  /**
   * 我方发出的自动回复（带 Auto-Submitted 或自动回复标记，R-SL-08）：不算回复，P05 显示灰色「自动回复 · 不算回复」；来信为 false
   */
  autoReply: z.boolean(),
  /** 自动回复带的标记头（「Auto-Submitted: auto-replied」，灰色卡正文顶部的小字，17）；其余为空 */
  autoReplyHeader: z.string().nullable(),
  /**
   * 来信的首次回复时间：同一工单内它之后的第一封我方回复（不含自动回复）的 internalDate，结束它的计时（R-SL-08，不论来源）；
   * 还没回复与我方发出的消息为空
   */
  firstReplyAt: z.iso.datetime({ offset: true }).nullable(),
  /** 应回复来信（来源为客户）的 SLA；生产厂、其他供应商的来信与我方发出的消息为空（不计 SLA） */
  sla: ticketMessageSlaSchema.nullable(),
  /**
   * 正文（P05 全程记录，17）：纯文本，没有纯文本部分的取 HTML 转成的文字；Shopify 联系表单只取表单里的留言（Body 栏）
   */
  body: z.string(),
  /** 来信被「标记无需回复」（17）；没有标记与我方发出的消息为空 */
  noReply: noReplyMarkSchema.nullable(),
});
export type TicketMessage = z.infer<typeof ticketMessageSchema>;

/**
 * 未回复来信（PRD 1.4、D-24）：来信、还没有首次回复（我方最近一封回复之后到达）、没被标记无需回复，不论来源。
 * 决定工单状态，也是 P05「标记无需回复」的对象
 */
export function isUnrepliedInbound(
  message: Pick<TicketMessage, 'direction' | 'firstReplyAt' | 'noReply'>,
): boolean {
  return message.direction === 'inbound' && message.firstReplyAt === null && !message.noReply;
}

/** 能不能对这封来信「标记无需回复」（P05「第一阶段」）：只对未关闭工单中的未回复来信；能力（坐席、客服主管）另由调用方判断 */
export function canMarkNoReply(
  status: TicketStatus,
  message: Pick<TicketMessage, 'direction' | 'firstReplyAt' | 'noReply'>,
): boolean {
  return status !== 'closed' && isUnrepliedInbound(message);
}
