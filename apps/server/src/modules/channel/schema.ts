import {
  adapterModes,
  mailProviders,
  messageDirections,
  messageSources,
  platforms,
  sites,
  ticketChannels,
} from '@forcome/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamptz, version } from '../core';
import { ruleSources, senderRuleKinds } from './recognition';

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
 * 服务商（D-28，待办 35）：Gmail 或 163 企业邮箱；163 企业邮箱另有 IMAP 服务器与端口（Gmail 为空，第二期再加 SMTP 的），
 * 客户端授权码按地址加密存在 integration.mailbox_credential（只写不读，ADR 0015）。
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
    /** 服务商：gmail / qiye163（迁移 0037 加列、0038 给已有的行补 gmail、0039 改为必填） */
    provider: text('provider', { enum: mailProviders }).notNull(),
    /** 163 企业邮箱的 IMAP 服务器（小写）与端口；Gmail 为空 */
    imapHost: text('imap_host'),
    imapPort: integer('imap_port'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    unique('store_mailbox_address_key').on(t.address),
    index('store_mailbox_store_idx').on(t.storeId),
    // 163 企业邮箱要有服务器与 1–65535 的端口，Gmail 没有
    check(
      'store_mailbox_imap_server_check',
      sql`(${t.provider} = 'gmail' AND ${t.imapHost} IS NULL AND ${t.imapPort} IS NULL)
        OR (${t.provider} = 'qiye163' AND ${t.imapHost} IS NOT NULL AND ${t.imapPort} BETWEEN 1 AND 65535)`,
    ),
  ],
);

/**
 * IMAP 的增量游标（163 企业邮箱，ADR 0015）：收件箱与「已发送」各一组 UIDVALIDITY 与已入库的最大 UID（「开始监听」时为 UIDNEXT − 1），
 * 与找到的「已发送」文件夹名。找不到「已发送」时 sent 为空（收件箱照收，之后找到了再从那时起收）
 */
export interface ImapCursor {
  readonly inbox: ImapFolderCursor;
  readonly sent: ImapFolderCursor | null;
  readonly sentFolder: string | null;
}

export interface ImapFolderCursor {
  readonly uidValidity: string;
  readonly uid: number;
}

/**
 * 邮箱的同步状态（规格 channel「Gmail 客户端」、PRD 6.9）：每个进线邮箱一行，watch 建立后有增量游标 historyId，
 * 每次同步把这之后新到的消息入库，全部入库成功后才推进游标（水位只在持久化成功后推进）。
 * 按地址关联进线邮箱、不设外键：编辑店铺时进线邮箱整行替换，游标要留着。
 * 同步记录（待办 09）：最近一次同步成功的时间与连续失败的次数，连接状态按它算（contracts 的 syncConnectionStatus）；
 * 游标过期时记下补拉的区间起点与补拉开始时的新游标，补拉完成前最近同步成功的时间不前移。
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
    /**
     * 第一次 watch 成功（游标建立）的时刻：之后到达的信都在 history 里。历史邮件回放的 T0 不能早于它（待办 26：
     * T0 到它之间的信既不回放、也不在增量里）；之前已有游标的邮箱由迁移按 created_at 补
     */
    watchedAt: timestamptz('watched_at'),
    /** 最近一次同步成功（取完游标之后的全部消息并入库）的时间；从没成功过为空 */
    lastSuccessAt: timestamptz('last_success_at'),
    /**
     * 最近一次同步成功取清单（history.list，或区间补拉的 messages.list）的时刻：那之前到达的信都已入库，入库期间新到的不在这次清单里。
     * 按时关闭据此判断邮箱同步到了哪里（待办 33）；P18 的连接状态仍按最近同步成功。迁移 0034 之前没有，下一次同步成功时写上
     */
    syncedThrough: timestamptz('synced_through'),
    /** 连续失败的次数（watch 与同步的外部调用失败都算）；成功一次清零，满 3 次为连接异常 */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** 这一串连续失败的第 1 次的时间（K7「10:05 起连续 3 次」、G4「10:05 起未收取」）；没在失败为空 */
    failingSince: timestamptz('failing_since'),
    /** 最近一次失败的原因（排错用） */
    lastError: text('last_error'),
    /** 游标过期（history.list 404）后按 internalDate 区间补拉：区间起点；没在补拉为空 */
    backfillFrom: timestamptz('backfill_from'),
    /** 补拉开始时取的新游标（users.getProfile 的 historyId），补拉完成后换上 */
    backfillHistoryId: text('backfill_history_id'),
    /**
     * 163 企业邮箱的增量游标（ADR 0015，待办 35）：第一次记下两个文件夹的位置即「开始监听」（同 Gmail 的 watch，写 watched_at）；
     * Gmail 邮箱为空。「已开始监听」= 有 Gmail 游标（history_id）或 IMAP 游标
     */
    imapCursor: jsonb('imap_cursor').$type<ImapCursor>(),
    /** UIDVALIDITY 变了按到达时间区间补拉（起点同 backfill_from）：补拉开始时记下的新游标，补拉完成后换上 */
    imapBackfillCursor: jsonb('imap_backfill_cursor').$type<ImapCursor>(),
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
 * 方向：来信 inbound；「已发送」里我方发出的 outbound（待办 09 入库，归到工单与回复识别随 16）。
 * Message-ID 判重按方向分开：店铺邮箱之间互相发信时，发出的一份与收到的一份各自为准。附件随用到它的待办。
 */
export const message = channelSchema.table(
  'message',
  {
    id: primaryId(),
    /** 收到这封信的邮箱（小写）：同步的 Gmail 邮箱 */
    mailbox: text('mailbox').notNull(),
    /**
     * 服务商的消息标识（ADR 0015）：Gmail 消息 ID；163 企业邮箱为「文件夹角色 : UIDVALIDITY : UID」（例 inbox:1700000001:4521）。
     * 「邮箱 + 它」唯一（R-TK-07、E-15）。迁移 0037 加列、0038 从 gmail_message_id 回填、0039 改为必填并删旧列
     */
    providerMessageId: text('provider_message_id').notNull(),
    /** 线程（Gmail 线程 ID，回复识别的第三顺位）；163 企业邮箱没有线程，为空 */
    threadId: text('thread_id'),
    /** 方向：来信 inbound / 我方发出 outbound（Gmail 标签含 SENT） */
    direction: text('direction', { enum: messageDirections }).notNull(),
    /** RFC Message-ID（带尖括号）；邮件没写时为空 */
    rfcMessageId: text('rfc_message_id'),
    inReplyTo: text('in_reply_to'),
    /** References 头里的 Message-ID，按出现顺序 */
    references: text('references')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** 发件地址（From 头，小写）；Shopify 联系表单通知是 mailer@shopify.com，客户身份另见 sender_address */
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
    /** Reply-To 等全部头字段（小写名 + 原值，按出现顺序）：来源规则、自动回复标记、Delivered-To 等识别用（10、15、16） */
    headers: jsonb('headers').$type<{ key: string; value: string }[]>().notNull(),
    /** 到达时间（Gmail internalDate） */
    receivedAt: timestamptz('received_at').notNull(),
    /** 识别出的店铺；识别不出（未归属店铺，15）为空 */
    storeId: uuid('store_id').references(() => store.id),
    /** 渠道（R-TK-08）；同一封邮件的其余副本不识别，为空（下面几个识别结果同此） */
    channel: text('channel', { enum: ticketChannels }),
    /** 站点：亚马逊按发件域，其余取店铺默认站点（R-ST-02） */
    site: text('site', { enum: sites }),
    /** 来源（PRD 1.4，按来源规则表判定）：平台通知与营销归档、不建工单 */
    source: text('source', { enum: messageSources }),
    /** 客户渠道身份（小写）：亚马逊中转地址、Shopify 联系表单的回复邮箱，其余同发件地址；ticket 按它建客户与归并 */
    senderAddress: text('sender_address'),
    /** 客户渠道身份的显示名（联系表单取表单里的姓名）；没写时为空串 */
    senderName: text('sender_name'),
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
    unique('message_mailbox_provider_id_key').on(t.mailbox, t.providerMessageId),
    // 163 企业邮箱的 UIDVALIDITY 变了以后同一封信的标识也变了：入库前按「同一邮箱 + 方向 + Message-ID」认出已收过的（ADR 0015）
    index('message_mailbox_rfc_message_id_idx').on(t.mailbox, t.direction, t.rfcMessageId),
    uniqueIndex('message_rfc_message_id_key')
      .on(t.direction, t.rfcMessageId)
      .where(sql`${t.duplicateOfId} IS NULL AND ${t.rfcMessageId} IS NOT NULL`),
    index('message_store_received_idx').on(t.storeId, t.receivedAt),
  ],
);

/**
 * 来源规则表（规格 channel「来源识别」，待办 10）：按客户渠道身份与头字段判定来信的来源，没有命中为客户
 * （匹配与优先级见 recognition.ts）。第一期没有维护页面（随第二期）：平台通知与营销的种子由迁移 0009 写入所有环境；
 * 已登记生产厂邮箱在非生产环境随示例数据灌入（加载步骤 channel.sender_rules），生产环境的真实名单与其他供应商
 * 由业务提供后用迁移补（协调者 10-05 决定，待办 32 跟踪）。
 */
export const senderRule = channelSchema.table(
  'sender_rule',
  {
    id: primaryId(),
    /** 匹配方式：精确地址 · 发件域（精确等于，不含子域）· 头字段 */
    kind: text('kind', { enum: senderRuleKinds }).notNull(),
    /** 地址、发件域或头字段名（小写） */
    pattern: text('pattern').notNull(),
    /** 只用于头字段：头的值（小写）；为空时有这个头就算命中 */
    headerValue: text('header_value'),
    source: text('source', { enum: ruleSources }).notNull(),
    /** 说明（给维护的人看，例如「亚马逊平台通知」「FQD 生产厂」） */
    label: text('label').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('sender_rule_match_key').on(t.kind, t.pattern, sql`coalesce(${t.headerValue}, '')`),
  ],
);

/**
 * 上线切换（规格「历史导入与切换」，待办 26；协调者 2026-10-14 决定 Q1–Q4）：整个环境一行，由历史邮件回放命令写入。
 * - 没有这一行：生产环境为「待切换」——worker 照常给进线邮箱 watch（T0 前启动 watch），但不同步入库、不建工单；
 *   非生产环境视为已切换，照常实时收信；
 * - 有这一行、completed_at 为空：正在回放（T0 已定），实时收信暂停（回放期间 worker 必须停，命令检查）；
 * - completed_at 有值：已切换，实时收信从各邮箱 watch 的游标接着收，交界处按「邮箱 + Gmail 消息 ID」去重。
 * 健康判断与 worker 自检（待办 28）读它：待切换、回放中不算同步故障。
 */
export const mailCutover = channelSchema.table(
  'mail_cutover',
  {
    /** 只有一行：固定为 1 */
    id: integer('id').primaryKey().default(1),
    /** 切换时刻：internalDate 早于它的邮件回放，不早于它的交给实时收信 */
    t0: timestamptz('t0').notNull(),
    /** 回放区间的起点：T0 − 90 × 24 小时 */
    replayFrom: timestamptz('replay_from').notNull(),
    /** 各进线邮箱要回放的邮件都已列进回放清单（mail_replay_item）的时刻；还没列完为空，续跑时重新列 */
    listedAt: timestamptz('listed_at'),
    /** 回放完成、开启实时处理的时刻 */
    completedAt: timestamptz('completed_at'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [check('mail_cutover_single_row_check', sql`${t.id} = 1`)],
);

/**
 * 回放清单（待办 26）：要回放的每封邮件（进线邮箱 + Gmail 消息 ID + 到达时间），按到达时间升序单线程回放；
 * 回放完一封（入库、归并与回复识别都跑完）记下 replayed_at，中断后从第一封没记的接着回放（断点续跑）。
 * 同一封再列一次不重复（主键），已入库的按 message 的「邮箱 + Gmail 消息 ID」去重（重跑幂等）。
 */
export const mailReplayItem = channelSchema.table(
  'mail_replay_item',
  {
    mailbox: text('mailbox').notNull(),
    /** 服务商的消息标识（同 message.provider_message_id）；迁移 0037–0039 从 gmail_message_id 改过来 */
    providerMessageId: text('provider_message_id').notNull(),
    /** 到达时间（Gmail internalDate）：回放的顺序与注入的「当前时间」 */
    internalDate: timestamptz('internal_date').notNull(),
    /** 回放完的时刻（处理时刻）；还没回放为空 */
    replayedAt: timestamptz('replayed_at'),
  },
  (t) => [
    primaryKey({ columns: [t.mailbox, t.providerMessageId] }),
    index('mail_replay_item_pending_idx')
      .on(t.internalDate, t.mailbox, t.providerMessageId)
      .where(sql`${t.replayedAt} IS NULL`),
  ],
);
