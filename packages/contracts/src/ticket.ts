import { z } from 'zod';
import { siteSchema } from './channel';

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

/** 消息的方向：来信 inbound（不论来源）/ 我方发出 outbound（「已发送」，09 起） */
export const messageDirections = ['inbound', 'outbound'] as const;
export const messageDirectionSchema = z.enum(messageDirections);
export type MessageDirection = z.infer<typeof messageDirectionSchema>;

/** 工单号 T-日期-4 位当日序号（11.2；日期取首封来信日期，北京时间） */
export const ticketNumberSchema = z.string().regex(/^T-\d{8}-\d{4}$/, '工单号的格式是 T-日期-序号');

/** P04 工单列表的一行（第一阶段；订单号、SLA 剩余随 14、16、18） */
export const ticketListItemSchema = z.object({
  id: z.uuid(),
  number: ticketNumberSchema,
  subject: z.string(),
  /** 工单的来源：首封来信的来源（11.1 Ticket） */
  source: ticketSourceSchema,
  /** 渠道（R-TK-08）与站点（亚马逊按发件域，其余取店铺默认站点；Shopify 按订单收件国家随 14），都取首封来信 */
  channel: ticketChannelSchema,
  site: siteSchema,
  store: z.object({ id: z.uuid(), name: z.string() }),
  customer: z.object({ name: z.string() }),
  status: ticketStatusSchema,
  /** 工单内最近一封来信的到达时间（Gmail internalDate） */
  lastInboundAt: z.iso.datetime({ offset: true }),
});
export type TicketListItem = z.infer<typeof ticketListItemSchema>;

/** GET /api/tickets：店铺范围内的工单 */
export const ticketListSchema = z.object({ tickets: z.array(ticketListItemSchema) });
export type TicketList = z.infer<typeof ticketListSchema>;

/** 工单里的一封消息（待办 08 只有来信；正文、我方回复、SLA 与「无需回复」随 09、16、17） */
export const ticketMessageSchema = z.object({
  id: z.uuid(),
  direction: messageDirectionSchema,
  /** 收到这封信的店铺邮箱（进线邮箱） */
  mailbox: z.string(),
  /**
   * 发件人：客户渠道身份（R-TK-08）——亚马逊为买家消息中转地址，Shopify 联系表单为表单里的回复邮箱，其余为发件地址
   */
  from: z.object({ name: z.string(), address: z.string() }),
  /** 来信的来源（归档的平台通知与营销不会进工单）；我方发出的消息为空（16） */
  source: ticketSourceSchema.nullable(),
  subject: z.string(),
  /** 到达时间（Gmail internalDate） */
  arrivedAt: z.iso.datetime({ offset: true }),
  /** 同一封邮件（Message-ID 相同）同时发到的其他店铺邮箱（R-TK-07）：只按最早收到（同步入库）的一封归并，其余记在这里 */
  alsoSentTo: z.array(z.string()),
});
export type TicketMessage = z.infer<typeof ticketMessageSchema>;

/** GET /api/tickets/{number}：工单与它的消息（P05 第一阶段的全程记录、SLA、状态流转与订单卡随 17） */
export const ticketDetailSchema = z.object({
  ticket: ticketListItemSchema,
  messages: z.array(ticketMessageSchema),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;
