import {
  messageDirections,
  sites,
  slaResults,
  ticketChannels,
  ticketCloseReasons,
  ticketSources,
  ticketEvents,
  ticketStatuses,
  ticketTriggers,
} from '@forcome/contracts';
import { desc, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgSchema,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamptz, version } from '../core';

/** ticket 模块的数据库 schema（一个模块一个 schema，ADR 0006）；表随各期待办加入 */
export const ticketSchema = pgSchema('ticket');

/**
 * 客户（PRD 11.1 Customer 的最小形态）：一个客户有若干渠道身份；第一期不做身份合并（P06 随第二期），
 * 所以一个身份就是一个客户。客户名取首封来信的发件人显示名，没写时用地址。
 */
export const customer = ticketSchema.table('customer', {
  id: primaryId(),
  name: text('name').notNull(),
  createdAt: timestamptz('created_at').notNull(),
});

/** 客户渠道身份：邮箱或亚马逊买家消息的中转地址（小写，全表唯一）；R-TK-02 按它归并无订单的来信 */
export const customerIdentity = ticketSchema.table(
  'customer_identity',
  {
    id: primaryId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    address: text('address').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    unique('customer_identity_address_key').on(t.address),
    index('customer_identity_customer_idx').on(t.customerId),
  ],
);

/**
 * 工单（PRD 11.1 Ticket，第一期用到的字段）：编号 T-首封来信日期-当日序号；店铺、渠道、站点、来源取首封来信的识别结果；
 * 状态只能经迁移表改变（lifecycle.ts → ticket-status.ts 的 createTicket / applyTransition，同一事务写 status_change），
 * 数据库约束保证状态等于最近一条状态变更记录的目标状态（迁移 0007）。
 * 订单号在归并时关联（14）；SLA 按来信记在 ticket_message（16）；负责人第一期为空，不建列。
 */
export const ticket = ticketSchema.table(
  'ticket',
  {
    id: primaryId(),
    number: text('number').notNull(),
    storeId: uuid('store_id').notNull(),
    channel: text('channel', { enum: ticketChannels }).notNull(),
    site: text('site', { enum: sites }).notNull(),
    /** 来源：首封来信的来源（客户 / 生产厂 / 其他供应商；平台通知与营销不建工单） */
    source: text('source', { enum: ticketSources }).notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    /** 首封来信的主题 */
    subject: text('subject').notNull(),
    /**
     * 关联的订单（R-TK-01，归并时抽取并在该店铺的订单镜像中校验，待办 14）：亚马逊为订单号，Shopify 为订单名（如 #1063）；
     * 为空即「无订单工单」（R-TK-02）
     */
    orderNumber: text('order_number'),
    status: text('status', { enum: ticketStatuses }).notNull(),
    /** 关闭原因（迁移到已关闭时写入，6.1 三种） */
    closeReason: text('close_reason', { enum: ticketCloseReasons }),
    /** 首封来信的到达时间（编号日期取它） */
    firstInboundAt: timestamptz('first_inbound_at').notNull(),
    /** 最近一封来信的到达时间（P04「最近来信」；7 天、14 天自动关闭从它起算，16） */
    lastInboundAt: timestamptz('last_inbound_at').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: version(),
  },
  (t) => [
    unique('ticket_number_key').on(t.number),
    // R-TK-01：同店铺同订单的工单（追加、重开或新建，待办 14）
    index('ticket_store_order_idx')
      .on(t.storeId, t.orderNumber)
      .where(sql`${t.orderNumber} IS NOT NULL`),
    // R-TK-02：同店铺同客户的未关闭无订单工单
    index('ticket_open_without_order_idx')
      .on(t.storeId, t.customerId)
      .where(sql`${t.orderNumber} IS NULL AND ${t.status} <> 'closed'`),
    index('ticket_store_last_inbound_idx').on(t.storeId, desc(t.lastInboundAt)),
    // 每分钟的时限扫描：未关闭的工单按最近来信找 7 天、14 天到期的（16）
    index('ticket_open_last_inbound_idx')
      .on(t.status, t.lastInboundAt)
      .where(sql`${t.status} <> 'closed'`),
  ],
);

/**
 * 工单里的消息（PRD 11.1 Message 的工单部分）：哪封邮件属于哪张工单；邮件本身（头字段、正文、去重）在 channel。
 * 一封邮件只归并一次（channel_message_id 唯一），归并任务与回复识别重跑不会重复追加。
 * 来信记来源、渠道与首次回复（16）；应回复来信（来源为客户）另记 SLA 截止与结果，其余两列为空——R-SL-08 的统计对象，
 * 报表（24）按这几列算首响与达标率。我方回复（「已发送」，回复识别归到工单）记是否自动回复。无需回复标记随 17。
 */
export const ticketMessage = ticketSchema.table(
  'ticket_message',
  {
    id: primaryId(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => ticket.id),
    /** channel.message 的 id（跨模块不设外键） */
    channelMessageId: uuid('channel_message_id').notNull(),
    direction: text('direction', { enum: messageDirections }).notNull(),
    /** 到达时间（Gmail internalDate）；我方回复为发出时间，首次回复时长按它算 */
    receivedAt: timestamptz('received_at').notNull(),
    /** 来信的来源（客户 / 生产厂 / 其他供应商）；我方回复为空。工单量只计客户来信触发的新建与重开（24） */
    source: text('source', { enum: ticketSources }),
    /** 来信自己的渠道（同一工单里可能有亚马逊中转来信与直邮）：SLA 目标按它（亚马逊为平台 SLA，其余为内部目标）；我方回复为空 */
    channel: text('channel', { enum: ticketChannels }),
    /** 来信的首次回复时间：工单内它之后第一封我方回复（不含自动回复）的 internalDate（不论来源，决定是不是未回复来信） */
    firstReplyAt: timestamptz('first_reply_at'),
    /** 应回复来信的 SLA 截止（到达 + 24 小时，R-SL-02）；其余为空 */
    slaDueAt: timestamptz('sla_due_at'),
    /** 应回复来信的 SLA 结果：达标 / 未达标 / 未到期 / 无需回复；其余为空 */
    slaResult: text('sla_result', { enum: slaResults }),
    /** 我方回复是否自动回复（Auto-Submitted 等，不算回复，R-SL-08）；来信为 false */
    autoReply: boolean('auto_reply').notNull().default(false),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('ticket_message_channel_message_key').on(t.channelMessageId),
    index('ticket_message_ticket_idx').on(t.ticketId, t.receivedAt),
    // 每分钟扫描：过了截止仍未到期的改为未达标
    index('ticket_message_sla_pending_idx')
      .on(t.slaDueAt)
      .where(sql`${t.slaResult} = 'pending'`),
    check('ticket_message_sla_pair', sql`(${t.slaDueAt} IS NULL) = (${t.slaResult} IS NULL)`),
  ],
);

/**
 * 状态变更记录（6.1「每次迁移记录时间、事件与触发方」，P05 状态流转逐步显示）：新建也是一条（从「无」到待回复）。
 * 只由 ticket-status.ts 的 createTicket / applyTransition 写入（lint 限制引用，见 eslint-boundaries.js）。
 */
export const statusChange = ticketSchema.table(
  'status_change',
  {
    id: primaryId(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => ticket.id),
    /** 迁移前的状态；新建为空 */
    fromStatus: text('from_status', { enum: ticketStatuses }),
    toStatus: text('to_status', { enum: ticketStatuses }).notNull(),
    event: text('event', { enum: ticketEvents }).notNull(),
    trigger: text('trigger', { enum: ticketTriggers }).notNull(),
    /** 触发的成员（坐席 / 客服主管）；系统触发为空 */
    actorId: uuid('actor_id'),
    /** 触发方姓名快照；系统为「系统」 */
    actorName: text('actor_name').notNull(),
    closeReason: text('close_reason', { enum: ticketCloseReasons }),
    /**
     * 引起这次迁移的消息（channel.message 的 id）：新建、追加与重开为触发的来信，识别到回复为那封我方回复；按时关闭为空。
     * 工单量只计由客户来信触发的新建与重开（D-24）：按它关联 ticket_message 取来信的来源（24）
     */
    channelMessageId: uuid('channel_message_id'),
    occurredAt: timestamptz('occurred_at').notNull(),
  },
  (t) => [index('status_change_ticket_idx').on(t.ticketId, t.occurredAt)],
);

/**
 * 还没找到工单的我方回复（R-SL-08 乱序：回复先于它所回复的来信入库，16）：回复识别按 In-Reply-To、References、Gmail 线程
 * 都找不到工单时记在这里，等对应的来信归并（归并时按它的 Message-ID 与线程找到这里的回复，重新识别）；
 * 最多等 24 小时，每分钟的扫描把满 24 小时的删掉（不再等，记日志）。找到工单后删掉这一行。
 */
export const pendingReply = ticketSchema.table(
  'pending_reply',
  {
    id: primaryId(),
    /** 我方回复（channel.message 的 id，跨模块不设外键） */
    channelMessageId: uuid('channel_message_id').notNull(),
    /** 发出它的店铺邮箱与 Gmail 线程：同一线程里的来信归并后再找 */
    mailbox: text('mailbox').notNull(),
    gmailThreadId: text('gmail_thread_id').notNull(),
    /** 它回复的 Message-ID（In-Reply-To 与 References）：这些来信归并后再找 */
    replyTo: text('reply_to')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** 开始等的时刻（回复识别第一次没找到工单时）；满 24 小时不再等 */
    waitingSince: timestamptz('waiting_since').notNull(),
  },
  (t) => [
    uniqueIndex('pending_reply_channel_message_key').on(t.channelMessageId),
    index('pending_reply_thread_idx').on(t.mailbox, t.gmailThreadId),
  ],
);
