import {
  sites,
  ticketChannels,
  ticketCloseReasons,
  ticketEvents,
  ticketStatuses,
  ticketTriggers,
} from '@forcome/contracts';
import { desc, sql } from 'drizzle-orm';
import { index, pgSchema, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
 * 工单（PRD 11.1 Ticket，第一期用到的字段）：编号 T-首封来信日期-当日序号；店铺、渠道、站点取首封来信的识别结果；
 * 状态只能经迁移表改变（lifecycle.ts → tickets.ts 的 applyTransition，同一事务写 status_change），
 * 数据库约束保证状态等于最近一条状态变更记录的目标状态（迁移 0007）。
 * 来源（10）、订单号的取值（14）、SLA（16）随后续待办；负责人第一期为空，不建列。
 */
export const ticket = ticketSchema.table(
  'ticket',
  {
    id: primaryId(),
    number: text('number').notNull(),
    storeId: uuid('store_id').notNull(),
    channel: text('channel', { enum: ticketChannels }).notNull(),
    site: text('site', { enum: sites }).notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    /** 首封来信的主题 */
    subject: text('subject').notNull(),
    /** 关联的平台订单号（R-TK-01，14 号待办抽取并校验）；为空即「无订单工单」（R-TK-02） */
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
    // R-TK-02：同店铺同客户的未关闭无订单工单
    index('ticket_open_without_order_idx')
      .on(t.storeId, t.customerId)
      .where(sql`${t.orderNumber} IS NULL AND ${t.status} <> 'closed'`),
    index('ticket_store_last_inbound_idx').on(t.storeId, desc(t.lastInboundAt)),
  ],
);

/**
 * 工单里的消息（PRD 11.1 Message 的工单部分）：哪封邮件属于哪张工单；邮件本身（头字段、正文、去重）在 channel。
 * 一封邮件只归并一次（channel_message_id 唯一），归并任务重跑不会重复追加。SLA、无需回复标记随 16、17 加列。
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
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    /** 到达时间（Gmail internalDate） */
    receivedAt: timestamptz('received_at').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('ticket_message_channel_message_key').on(t.channelMessageId),
    index('ticket_message_ticket_idx').on(t.ticketId, t.receivedAt),
  ],
);

/**
 * 状态变更记录（6.1「每次迁移记录时间、事件与触发方」，P05 状态流转逐步显示）：新建也是一条（从「无」到待回复）。
 * 只由 tickets.ts 的 applyTransition 写入（lint 限制引用，见 eslint-boundaries.js）。
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
    occurredAt: timestamptz('occurred_at').notNull(),
  },
  (t) => [index('status_change_ticket_idx').on(t.ticketId, t.occurredAt)],
);
