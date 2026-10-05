import {
  adapterModes,
  messageDirections,
  platforms,
  sites,
  ticketChannels,
} from '@forcome/contracts';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamptz, version } from '../core';

/** channel 模块的数据库 schema（一个模块一个 schema，ADR 0006）；表随各期待办加入 */
export const channelSchema = pgSchema('channel');

/**
 * 店铺（PRD 11.1 Store、P18、K8）：来信按进线邮箱识别店铺，订单在店铺内匹配，成员按店铺授权数据范围。
 * 第一期没有签名与覆盖配置（第二阶段起再加列）。店铺名不分大小写唯一。不做物理删除。
 */
export const store = channelSchema.table(
  'store',
  {
    id: primaryId(),
    name: text('name').notNull(),
    platform: text('platform', { enum: platforms }).notNull(),
    /** 站点（多选，按 US · CA · MX 排序） */
    sites: text('sites', { enum: sites }).array().notNull(),
    /** 默认站点：无订单的来信按它归站点（D-23），是 sites 之一 */
    defaultSite: text('default_site', { enum: sites }).notNull(),
    /** 平台标识：亚马逊卖家 ID / Shopify 店铺域名 */
    platformId: text('platform_id').notNull(),
    /** 数据来源：真实接口 / 模拟数据（Fake，只在非生产环境可设，ADR 0009 修订）；店铺级客户端按它选择 */
    adapterMode: text('adapter_mode', { enum: adapterModes }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    /** 最近一次保存的人（姓名快照，G7「这条记录刚被某人修改」用）；示例数据等系统写入为空 */
    updatedByName: text('updated_by_name'),
    version: version(),
  },
  (t) => [uniqueIndex('store_name_key').on(sql`lower(${t.name})`)],
);

/**
 * 店铺的进线邮箱（可多个，含别名，D-26）：寄到这些地址的来信归到该店铺。地址存小写，全表唯一——
 * 一个地址只能属于一个店铺（P18「校验」）。编辑店铺时按新的列表整体替换。
 */
export const storeMailbox = channelSchema.table(
  'store_mailbox',
  {
    id: primaryId(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => store.id),
    address: text('address').notNull(),
    /** 在店铺里的显示顺序，从 0 开始 */
    position: integer('position').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    unique('store_mailbox_address_key').on(t.address),
    index('store_mailbox_store_idx').on(t.storeId),
  ],
);

/**
 * 邮箱的同步状态（规格 channel「Gmail 客户端」）：每个进线邮箱一行，watch 建立后有增量游标 historyId，
 * 每次同步把这之后新到的消息入库，全部入库成功后才推进游标（水位只在持久化成功后推进）。
 * 按地址关联进线邮箱、不设外键：编辑店铺时进线邮箱整行替换，游标要留着。
 * 续订 watch、游标过期补拉、最近同步成功时间与连接状态随 09 号待办。
 */
export const mailboxSync = channelSchema.table(
  'mailbox_sync',
  {
    id: primaryId(),
    /** 邮箱地址（小写） */
    address: text('address').notNull(),
    /** 增量游标（Gmail historyId，不透明的递增数字串）；watch 之前为空 */
    historyId: text('history_id'),
    /** 推送（watch）的到期时间 */
    watchExpiresAt: timestamptz('watch_expires_at'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [unique('mailbox_sync_address_key').on(t.address)],
);

/**
 * 收取的邮件（PRD 11.1 Message 的接入部分；规格 channel「去重」「店铺与站点识别」）：一封 Gmail 消息一行，
 * 解析后的头字段与正文、店铺与渠道识别的结果。工单里的消息（归属、SLA、无需回复）在 ticket 模块，按 id 引用这里。
 * - 去重（R-TK-07、E-15）：「邮箱 + Gmail 消息 ID」唯一，重复投递只入库一次；
 * - 同一封邮件（Message-ID 相同）发到几个店铺邮箱：最早入库的一封为准（duplicate_of 为空，Message-ID 在这些行里唯一），
 *   其余记 duplicate_of 指向它、不再识别与归并，它们的邮箱记在准的那封的 also_sent_to（「同时发送到」）。
 * 待办 08 只收来信（方向 inbound）；「已发送」随 09。附件随用到它的待办。
 */
export const message = channelSchema.table(
  'message',
  {
    id: primaryId(),
    /** 收到这封信的邮箱（小写）：同步的 Gmail 邮箱 */
    mailbox: text('mailbox').notNull(),
    gmailMessageId: text('gmail_message_id').notNull(),
    gmailThreadId: text('gmail_thread_id').notNull(),
    /** 方向：来信 inbound / 我方发出 outbound（09） */
    direction: text('direction', { enum: messageDirections }).notNull(),
    /** RFC Message-ID（带尖括号）；邮件没写时为空 */
    rfcMessageId: text('rfc_message_id'),
    inReplyTo: text('in_reply_to'),
    /** References 头里的 Message-ID，按出现顺序 */
    references: text('references')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    fromAddress: text('from_address').notNull(),
    /** 发件人显示名；没写时为空串 */
    fromName: text('from_name').notNull(),
    toAddresses: text('to_addresses')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    subject: text('subject').notNull(),
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    /** 全部头字段（小写名 + 原值，按出现顺序）：来源规则、自动回复标记、Delivered-To 等识别用（10、15、16） */
    headers: jsonb('headers').$type<{ key: string; value: string }[]>().notNull(),
    /** 到达时间（Gmail internalDate） */
    receivedAt: timestamptz('received_at').notNull(),
    /** 识别出的店铺；识别不出（未归属店铺，15）为空 */
    storeId: uuid('store_id').references(() => store.id),
    /** 渠道（R-TK-08，10）；同一封邮件的其余副本不识别，为空 */
    channel: text('channel', { enum: ticketChannels }),
    site: text('site', { enum: sites }),
    /** 同一封邮件已在别的邮箱入库时，指向准的那封 */
    duplicateOfId: uuid('duplicate_of_id').references((): AnyPgColumn => message.id),
    /** 同一封邮件同时发到的其他店铺邮箱（R-TK-07「同时发送到」） */
    alsoSentTo: text('also_sent_to')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    unique('message_mailbox_gmail_id_key').on(t.mailbox, t.gmailMessageId),
    uniqueIndex('message_rfc_message_id_key')
      .on(t.rfcMessageId)
      .where(sql`${t.duplicateOfId} IS NULL AND ${t.rfcMessageId} IS NOT NULL`),
    index('message_store_received_idx').on(t.storeId, t.receivedAt),
  ],
);
