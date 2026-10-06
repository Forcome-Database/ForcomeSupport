import { densities, memberDisabledReasons, memberStatuses, roles } from '@forcome/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz, version } from '../core';

/** org 模块的数据库 schema（一个模块一个 schema，ADR 0006）；表随各期待办加入 */
export const orgSchema = pgSchema('org');

/**
 * 成员（PRD 11.1 Member，ADR 0010）：钉钉通讯录里的人都同步进来（Stream 事件 + 每小时全量对账，待办 05），
 * 姓名、部门、邮箱与在职状态随钉钉；本系统只维护角色、店铺数据范围与所属生产厂（PRD 10.1）。新同步进来的成员没有角色，
 * 管理员在 P20 分配后才能进入（G11 说明、G12「未分配角色」）。不做物理删除，离职与停用用状态表示。
 * 角色与店铺范围在每次请求时实时读取，P20 改了下一次请求即生效（06 号待办）。
 */
export const member = orgSchema.table(
  'member',
  {
    id: primaryId(),
    /** 钉钉用户 ID（userid）；只有测试工具直接建的成员没有 */
    dingtalkUserId: text('dingtalk_user_id').unique(),
    /** 钉钉的 unionid（同一个人不变）：离职后用 userid 找不到人，扫码登录按它认出是谁（G12「账号已停用」） */
    dingtalkUnionId: text('dingtalk_union_id').unique(),
    name: text('name').notNull(),
    /** 钉钉部门的显示（主部门从组织下第一级起的路径，例「FSH / 客服部」）；同步时按部门表算好 */
    dept: text('dept').notNull(),
    /** 所在的钉钉部门 ID，第一个是主部门 */
    dingtalkDepartmentIds: text('dingtalk_department_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** 企业邮箱，没有取个人邮箱（P20 成员列「姓名 + 邮箱」） */
    email: text('email'),
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
    status: text('status', { enum: memberStatuses }).notNull().default('active'),
    /** 停用的原因（钉钉离职 / 管理员停用）与时间；在职时为空 */
    disabledReason: text('disabled_reason', { enum: memberDisabledReasons }),
    disabledAt: timestamptz('disabled_at'),
    /**
     * 最近一次按钉钉通讯录更新这一行的时间（事件或对账）。全量对账先取快照、再写库，写库时只改快照之前更新过的行：
     * 取快照期间由事件改过的（新入职、刚改名）不会被旧快照盖掉或误停用
     */
    dingtalkSyncedAt: timestamptz('dingtalk_synced_at'),
    /** 界面密度偏好（G9），按成员保存 */
    density: text('density', { enum: densities }).notNull().default('comfortable'),
    /** 最近一次登录（开发登录、钉钉扫码登录换出会话的时刻；P20「最近登录」，待办 06） */
    lastLoginAt: timestamptz('last_login_at'),
    /**
     * 最近一次改角色、店铺范围或在职状态（动版本号的修改）的时刻与操作人姓名（系统写「系统」）：
     * P20 保存冲突时 G7 横幅写「刚被谁修改」（待办 06）。只改通讯录资料不算
     */
    changedAt: timestamptz('changed_at'),
    changedByName: text('changed_by_name'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: version(),
  },
  (t) => [
    index('member_status_idx').on(t.status),
    check(
      'member_disabled_reason_check',
      sql`${t.disabledReason} IS NULL OR ${t.status} = 'disabled'`,
    ),
  ],
);

/**
 * 部门（PRD 11.1 Department：钉钉部门 ID、名称、上级部门；同步，只读）。成员的「钉钉部门」显示按它算出；
 * 钉钉里删掉的部门在对账时删掉（成员只存部门 ID，不设外键）。
 */
export const department = orgSchema.table('department', {
  id: primaryId(),
  dingtalkId: text('dingtalk_id').notNull().unique(),
  name: text('name').notNull(),
  /** 上级部门的钉钉 ID；根部门（组织本身）为空 */
  parentDingtalkId: text('parent_dingtalk_id'),
  /** 最近一次按钉钉通讯录更新的时间（同成员） */
  syncedAt: timestamptz('synced_at').notNull(),
});

/**
 * 钉钉通讯录同步的状态（一行）：最近一次全量对账成功的时间、连续失败次数与最近的错误。
 * P18 钉钉卡的连接状态按它算（PRD 6.9：超过 2 小时没成功为同步延迟、连续 3 次失败为连接异常，E-32）。
 */
export const dingtalkSync = orgSchema.table(
  'dingtalk_sync',
  {
    /** 固定为 directory（只有一行） */
    id: text('id').primaryKey(),
    lastSuccessAt: timestamptz('last_success_at'),
    lastAttemptAt: timestamptz('last_attempt_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    check('dingtalk_sync_singleton_check', sql`${t.id} = 'directory'`),
    check('dingtalk_sync_failures_check', sql`${t.consecutiveFailures} >= 0`),
  ],
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
