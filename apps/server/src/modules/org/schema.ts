import { sql } from 'drizzle-orm';
import { index, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from '../core';

/** org 模块的数据库 schema（一个模块一个 schema，ADR 0006）；表随各期待办加入 */
export const orgSchema = pgSchema('org');

/**
 * 服务端会话（ADR 0010）：浏览器只持有 httpOnly Cookie 里的随机令牌，库里只存它的 SHA-256，
 * 库泄露也拿不到可用的令牌。开发登录与钉钉扫码登录（05）换出的是同一种会话。
 * 第一版（待办 02）先存登录时成员的姓名与角色快照；04 号待办引入成员表后改为引用成员、实时读取角色，
 * 并加上无操作 7 天过期与续期（last_active_at）。
 */
export const session = orgSchema.table(
  'session',
  {
    id: primaryId(),
    tokenHash: text('token_hash').notNull().unique(),
    memberId: uuid('member_id').notNull(),
    memberName: text('member_name').notNull(),
    memberRoles: text('member_roles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamptz('created_at').notNull(),
    /** 最后一次有操作的时间；无操作过期与续期随 04 号待办 */
    lastActiveAt: timestamptz('last_active_at').notNull(),
  },
  (t) => [index('session_member_idx').on(t.memberId)],
);
