import { desc, sql } from 'drizzle-orm';
import { index, inet, integer, jsonb, pgSchema, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import type { AuditObjectType, Role } from '@forcome/contracts';
import { primaryId, timestamptz } from './columns';

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
