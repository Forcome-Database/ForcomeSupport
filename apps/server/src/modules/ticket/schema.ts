import {
  messageDirections,
  noReplyActions,
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
 * 报表（24）按这几列算首响与达标率。我方回复（「已发送」，回复识别归到工单）记是否自动回复。来信被「标记无需回复」时记操作人与时刻（17）。
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
    /**
     * 来信被「标记无需回复」（17）：操作的成员、姓名快照与时刻；撤销时清空。被标记的来信不是未回复来信，应回复来信的 SLA 结果为无需回复。
     * 标记与撤销的经过另记在 no_reply_event（全程记录的事件行）
     */
    noReplyById: uuid('no_reply_by_id'),
    noReplyByName: text('no_reply_by_name'),
    noReplyAt: timestamptz('no_reply_at'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('ticket_message_channel_message_key').on(t.channelMessageId),
    index('ticket_message_ticket_idx').on(t.ticketId, t.receivedAt),
    // 报表与 P04 下钻按到达时间取客户来信（customer_letter、customer_trigger_event 视图，24）
    index('ticket_message_customer_received_idx')
      .on(t.receivedAt)
      .where(sql`${t.direction} = 'inbound' AND ${t.source} = 'customer'`),
    // 每分钟扫描：过了截止仍未到期的改为未达标
    index('ticket_message_sla_pending_idx')
      .on(t.slaDueAt)
      .where(sql`${t.slaResult} = 'pending'`),
    check('ticket_message_sla_pair', sql`(${t.slaDueAt} IS NULL) = (${t.slaResult} IS NULL)`),
    // 标记的三列同时有或同时没有，只有来信能被标记
    check(
      'ticket_message_no_reply',
      sql`(${t.noReplyById} IS NULL AND ${t.noReplyByName} IS NULL AND ${t.noReplyAt} IS NULL)
        OR (${t.noReplyById} IS NOT NULL AND ${t.noReplyByName} IS NOT NULL AND ${t.noReplyAt} IS NOT NULL
          AND ${t.direction} = 'inbound')`,
    ),
  ],
);

/**
 * 「标记无需回复」的经过（17，P05 全程记录的事件行）：每次标记、撤销一行，撤销不删原来那行（协调者 2026-10-07 决定）。
 * 引起了状态变化（全部未回复来信都被标记 → 已解决，撤销 → 待回复）的记下目标状态；那次迁移另有状态变更记录（状态流转），
 * 事件行只按这里写一行。
 */
export const noReplyEvent = ticketSchema.table(
  'no_reply_event',
  {
    id: primaryId(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => ticket.id),
    /** 被标记的来信（channel.message 的 id） */
    channelMessageId: uuid('channel_message_id').notNull(),
    action: text('action', { enum: noReplyActions }).notNull(),
    actorId: uuid('actor_id').notNull(),
    actorName: text('actor_name').notNull(),
    /** 引起的状态变化的目标状态；没有引起状态变化为空 */
    toStatus: text('to_status', { enum: ticketStatuses }),
    occurredAt: timestamptz('occurred_at').notNull(),
  },
  (t) => [index('no_reply_event_ticket_idx').on(t.ticketId, t.occurredAt)],
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
    /**
     * 按时关闭所用的到期时刻（关闭时最近一封来信 + 7 / 14 天，待办 33）：P05 状态流转里这一步的业务时刻，不在读取时重算
     * （补拉进来的、早于关闭时刻的来信会把重算的结果推到关闭之后）。按时关闭必有、不晚于发生时刻，其余迁移为空。
     * 迁移 0034 加列，0035 把之前的关闭按当时已归并的最近来信回填（回填不出的取发生时刻），0036 加约束
     */
    dueAt: timestamptz('due_at'),
  },
  (t) => [
    check(
      'status_change_due_at',
      sql`(${t.event} IN ('idle_7_days', 'idle_14_days')) = (${t.dueAt} IS NOT NULL) AND ${t.dueAt} <= ${t.occurredAt}`,
    ),
    index('status_change_ticket_idx').on(t.ticketId, t.occurredAt),
    // 新建与重开按触发的来信找（customer_trigger_event 视图，24）
    index('status_change_trigger_message_idx')
      .on(t.channelMessageId)
      .where(
        sql`${t.event} = 'inbound_reopen' OR (${t.event} = 'inbound' AND ${t.fromStatus} IS NULL)`,
      ),
  ],
);

/**
 * 客户来信触发的新建与重开（工单量的事件，PRD P17「指标口径」、D-24）：每个事件一行——新建（从「无」迁出的 inbound）与重开
 * （inbound_reopen）的状态变更记录，按触发的来信（channel_message_id）关联工单消息，只取来源为客户的；归期取触发那封来信的到达时间
 * （业务时刻，ADR 0008「待办 18 落地」），渠道是那封来信自己的渠道，店铺与站点取工单的。
 * P04 按事件下钻（ticket-status.ts 的 customerTriggerEvents）与报表的工单量、「每日工单量」的柱（report，待办 24）都从这一个视图数，
 * 两处的条数因此一致（AC-P1-14）。读它的查询都要显式施加店铺范围（store_id；ADR 0010，报表绕过了仓储层的编译期保护）
 */
export const customerTriggerEvent = ticketSchema
  .view('customer_trigger_event', {
    statusChangeId: uuid('status_change_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    storeId: uuid('store_id').notNull(),
    site: text('site', { enum: sites }).notNull(),
    receivedAt: timestamptz('received_at').notNull(),
    channel: text('channel', { enum: ticketChannels }).notNull(),
  })
  .as(
    sql`SELECT ${statusChange.id} AS status_change_id, ${statusChange.ticketId} AS ticket_id,
  ${ticket.storeId} AS store_id, ${ticket.site} AS site,
  ${ticketMessage.receivedAt} AS received_at, ${ticketMessage.channel} AS channel
FROM ${statusChange}
JOIN ${ticketMessage} ON ${ticketMessage.channelMessageId} = ${statusChange.channelMessageId}
JOIN ${ticket} ON ${ticket.id} = ${statusChange.ticketId}
WHERE (${statusChange.event} = 'inbound_reopen' OR (${statusChange.event} = 'inbound' AND ${statusChange.fromStatus} IS NULL))
  AND ${ticketMessage.direction} = 'inbound' AND ${ticketMessage.source} = 'customer'`,
  );

/**
 * 客户来信（首响中位数、SLA 达标率按封计，PRD P17「指标口径」、R-SL-08）：工单里来源为客户的每封来信一行，按到达时间归期；
 * 已回复 = 有首次回复，SLA 结果 达标 / 未达标 / 未到期 / 无需回复；渠道是来信自己的渠道，店铺与站点取工单的。
 * P04 按封下钻（queries.ts）与报表的首响中位数、SLA 达标率（report，待办 24）都从这一个视图数。还没归并的未归属店铺来信不在这里
 * （在 channel.message，报表的「全部店铺」口径另计，协调者 2026-10-14 决定 Q4）。读它的查询都要显式施加店铺范围
 */
export const customerLetter = ticketSchema
  .view('customer_letter', {
    ticketMessageId: uuid('ticket_message_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    storeId: uuid('store_id').notNull(),
    site: text('site', { enum: sites }).notNull(),
    receivedAt: timestamptz('received_at').notNull(),
    channel: text('channel', { enum: ticketChannels }),
    firstReplyAt: timestamptz('first_reply_at'),
    slaResult: text('sla_result', { enum: slaResults }),
  })
  .as(
    sql`SELECT ${ticketMessage.id} AS ticket_message_id, ${ticketMessage.ticketId} AS ticket_id,
  ${ticket.storeId} AS store_id, ${ticket.site} AS site, ${ticketMessage.receivedAt} AS received_at,
  ${ticketMessage.channel} AS channel, ${ticketMessage.firstReplyAt} AS first_reply_at, ${ticketMessage.slaResult} AS sla_result
FROM ${ticketMessage}
JOIN ${ticket} ON ${ticket.id} = ${ticketMessage.ticketId}
WHERE ${ticketMessage.direction} = 'inbound' AND ${ticketMessage.source} = 'customer'`,
  );

/**
 * 还没找到工单的我方回复（R-SL-08 乱序：回复先于它所回复的来信入库，16）：回复识别按 In-Reply-To、References、线程（Gmail）
 * 都找不到工单时记在这里，等对应的来信归并（归并时按它的 Message-ID 与线程找到这里的回复，重新识别）；
 * 最多等 24 小时，每分钟的扫描把满 24 小时的删掉（不再等，记日志）。找到工单后删掉这一行。
 */
export const pendingReply = ticketSchema.table(
  'pending_reply',
  {
    id: primaryId(),
    /** 我方回复（channel.message 的 id，跨模块不设外键） */
    channelMessageId: uuid('channel_message_id').notNull(),
    /** 发出它的店铺邮箱与线程（Gmail 线程；163 企业邮箱没有线程）：同一线程里的来信归并后再找 */
    mailbox: text('mailbox').notNull(),
    /** 线程（同 channel.message.thread_id；163 企业邮箱没有线程，为空）；迁移 0037–0039 从 gmail_thread_id 改过来 */
    threadId: text('thread_id'),
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
    index('pending_reply_thread_idx').on(t.mailbox, t.threadId),
  ],
);
