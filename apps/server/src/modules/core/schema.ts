import { desc, sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  foreignCurrencies,
  notificationObjectTypes,
  notificationTypes,
  publishedRateSources,
  type AuditObjectType,
  type Role,
} from '@forcome/contracts';
import { primaryId, rate, timestamptz } from './columns';

export const coreSchema = pgSchema('core');

/**
 * 审计日志（PRD 11.1 AuditLog、10.2）：服务层在写事务内记录（ADR 0006、0010）。
 * 操作人与角色在写入时快照，成员改名或改角色不影响历史记录。
 */
export const auditLog = coreSchema.table(
  'audit_log',
  {
    id: primaryId(),
    occurredAt: timestamptz('occurred_at').notNull(),
    actorType: text('actor_type', { enum: ['member', 'system'] }).notNull(),
    /** 成员 ID（org 模块）；系统操作为空 */
    actorId: uuid('actor_id'),
    /** 操作人姓名快照；系统操作为「系统」 */
    actorName: text('actor_name').notNull(),
    /** 操作时的角色快照（可多角色，contracts 的角色标识） */
    actorRoles: text('actor_roles')
      .array()
      .$type<Role[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** 来源 IP；系统操作为空 */
    ip: inet('ip'),
    objectType: text('object_type').$type<AuditObjectType>().notNull(),
    objectId: text('object_id').notNull(),
    /** 对象编号或名称（P27「对象」列显示用），如 T-20260911-0038 */
    objectLabel: text('object_label'),
    /** 对象所属店铺；没有店铺属性的对象（成员、设置、登录）为空（PRD 10.2、D-27） */
    storeId: uuid('store_id'),
    /** 动作，`对象.动词` 形式，如 store.create、member.disable、auth.login */
    action: text('action').notNull(),
    /** 完整前值；新建为空 */
    before: jsonb('before'),
    /** 完整后值；删除类为空 */
    after: jsonb('after'),
  },
  (t) => [
    index('audit_log_occurred_at_idx').on(desc(t.occurredAt)),
    index('audit_log_actor_idx').on(t.actorId, desc(t.occurredAt)),
    index('audit_log_object_idx').on(t.objectType, t.objectId),
    index('audit_log_store_idx').on(t.storeId, desc(t.occurredAt)),
  ],
);

/**
 * 业务编号计数器：每种编号、每个计数周期一行，在业务事务内加 1（行锁保证并发不重号，
 * 事务回滚则号不被占用）。工单按北京时间当日计数，售后单全局计数。
 */
export const businessNumberCounter = coreSchema.table(
  'business_number_counter',
  {
    kind: text('kind').notNull(),
    /** 计数周期：工单为 YYYYMMDD，全局计数为 'all' */
    period: text('period').notNull(),
    lastValue: integer('last_value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.period] })],
);

/**
 * 汇率（PRD 11.1 ExchangeRate、R-FL-06）：每个工作日、每个币种一行，1 USD = rate 原币，由欧洲央行的
 * 1 EUR 兑 USD、MXN、CAD 交叉计算；每日任务写入（exchange-rates.ts），只增不改。
 */
export const exchangeRate = coreSchema.table(
  'exchange_rate',
  {
    id: primaryId(),
    /** 汇率所属的日期（欧洲央行参考汇率的日期） */
    date: date('date', { mode: 'string' }).notNull(),
    currency: text('currency', { enum: foreignCurrencies }).notNull(),
    rate: rate('rate').notNull(),
    /** 欧洲央行（主源）或 Frankfurter（备用源） */
    source: text('source', { enum: publishedRateSources }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    unique('exchange_rate_date_currency_key').on(t.date, t.currency),
    check('exchange_rate_rate_check', sql`${t.rate} > 0`),
    check('exchange_rate_source_check', sql`${t.source} IN ('ecb', 'frankfurter')`),
  ],
);

/**
 * 站内通知（PRD 11.1 Notification、11.4、G10，待办 31）：每个接收人一行。其他模块只经 core 的写入（sendNotification，
 * 或 org 按 11.4 取接收人的 notifyMembers）写这张表，不直接写。接收人只存成员 ID（org 的成员，跨模块不设外键）；
 * 通知是给人看的提醒，不是业务数据：不加版本号、不记审计，标记已读只改 read_at。
 */
export const notification = coreSchema.table(
  'notification',
  {
    id: primaryId(),
    /** 接收人（成员 ID） */
    recipientId: uuid('recipient_id').notNull(),
    type: text('type', { enum: notificationTypes }).notNull(),
    /** 标题（原型「Gmail 连接异常」） */
    title: text('title').notNull(),
    /** 说明（原型「support@forcome.mx 连续 3 次失败，来信暂存」） */
    body: text('body').notNull(),
    /** 关联对象：类型、ID 与显示的编号或页面（原型「P18 · Gmail」） */
    objectType: text('object_type', { enum: notificationObjectTypes }).notNull(),
    objectId: text('object_id').notNull(),
    objectLabel: text('object_label').notNull(),
    /** 关联对象所属店铺；没有店铺属性的为空。查询时按接收人当前的店铺范围过滤（R-ST-06） */
    storeId: uuid('store_id'),
    createdAt: timestamptz('created_at').notNull(),
    /** 已读时间；未读为空 */
    readAt: timestamptz('read_at'),
  },
  (t) => [
    index('notification_recipient_idx').on(t.recipientId, desc(t.createdAt)),
    // 铃铛的未读数与「未读」页签
    index('notification_unread_idx')
      .on(t.recipientId, desc(t.createdAt))
      .where(sql`${t.readAt} IS NULL`),
  ],
);

/**
 * 钉钉工作通知的待发与已发（规格 core「钉钉工作通知发送」、ADR 0010「钉钉通知」，待办 05）：每个接收人一行。
 * 写入只经 core 的 queueWorkNotifications（11.4 渠道里有钉钉的通知类型由 org 的 notifyMembers 一并排入）；
 * 每分钟的发送任务把同一人最早一条已等满 5 分钟的全部待发合成一条发出（同一人 5 分钟内合并）。
 * 接收人存成员 ID 与当时的钉钉用户 ID（org 的成员，跨模块不设外键）。
 */
export const workNotification = coreSchema.table(
  'work_notification',
  {
    id: primaryId(),
    /** 接收人（成员 ID） */
    recipientId: uuid('recipient_id').notNull(),
    /** 接收人的钉钉用户 ID（排入时的）：按它合并、发送 */
    dingtalkUserId: text('dingtalk_user_id').notNull(),
    type: text('type', { enum: notificationTypes }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** 关联对象（通知里写对象编号与时间，避免钉钉「同一内容一天一条」吞掉通知） */
    objectType: text('object_type', { enum: notificationObjectTypes }).notNull(),
    objectId: text('object_id').notNull(),
    objectLabel: text('object_label').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    /** 发出时间；待发为空 */
    sentAt: timestamptz('sent_at'),
    /** 钉钉返回的任务 ID（查发送结果、统计调用量用） */
    taskId: text('task_id'),
    /** 发送失败的次数；到上限后不再重试（failed_at 记放弃的时间） */
    attempts: integer('attempts').notNull().default(0),
    failedAt: timestamptz('failed_at'),
  },
  (t) => [
    // 每分钟找待发的：同一人最早一条的时间
    index('work_notification_pending_idx')
      .on(t.dingtalkUserId, t.createdAt)
      .where(sql`${t.sentAt} IS NULL AND ${t.failedAt} IS NULL`),
    check('work_notification_attempts_check', sql`${t.attempts} >= 0`),
  ],
);
