import { densities, roles } from '@forcome/contracts';
import { sql } from 'drizzle-orm';
import { boolean, index, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz, version } from '../core';

/** org 模块的数据库 schema（一个模块一个 schema，ADR 0006）；表随各期待办加入 */
export const orgSchema = pgSchema('org');

/**
 * 成员（PRD 11.1 Member，ADR 0010）：姓名与部门来自钉钉通讯录（05 号待办同步，在那之前由示例数据夹具灌入）；
 * 本系统只维护角色、店铺数据范围与所属生产厂（PRD 10.1）。不做物理删除，离职与停用用状态表示。
 * 角色与店铺范围在每次请求时实时读取，P20 改了下一次请求即生效（06 号待办）。
 */
export const member = orgSchema.table(
  'member',
  {
    id: primaryId(),
    name: text('name').notNull(),
    /** 钉钉部门（例「FSH / 客服部」）；部门表随 05 号待办 */
    dept: text('dept').notNull(),
    /** 角色（可多个，权限取并集）；contracts 的角色标识 */
    roles: text('roles', { enum: roles })
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** 店铺数据范围：全部店铺（含以后新增的）为 true；否则只限 store_ids（R-ST-06） */
    allStores: boolean('all_stores').notNull().default(true),
    /** 授权店铺（channel 模块的店铺 ID；跨模块不建外键） */
    storeIds: uuid('store_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** 所属生产厂（生产厂对接人，例 FQD） */
    factoryCode: text('factory_code'),
    /** 在职 active；钉钉离职或管理员停用为 disabled（05、23 号待办） */
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    /** 界面密度偏好（G9），按成员保存 */
    density: text('density', { enum: densities }).notNull().default('comfortable'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: version(),
  },
  (t) => [index('member_status_idx').on(t.status)],
);

/**
 * 服务端会话（ADR 0010）：浏览器只持有 httpOnly Cookie 里的随机令牌，库里只存它的 SHA-256，
 * 库泄露也拿不到可用的令牌。开发登录与钉钉扫码登录（05）换出的是同一种会话。
 * 会话只引用成员，角色与店铺范围每次请求从成员表读取；无操作 7 天过期，有操作自动续期（last_active_at）。
 */
export const session = orgSchema.table(
  'session',
  {
    id: primaryId(),
    tokenHash: text('token_hash').notNull().unique(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull(),
    /** 最后一次有操作的时间：超过 7 天未更新即过期 */
    lastActiveAt: timestamptz('last_active_at').notNull(),
  },
  (t) => [index('session_member_idx').on(t.memberId)],
);
