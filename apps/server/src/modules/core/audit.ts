import {
  ACCESS_DENIED_ACTION,
  SYSTEM_ACTOR_NAME,
  type AuditAction,
  type AuditActionObjectType,
  type AuditObjectType,
  type AuditSnapshot,
  type Role,
} from '@forcome/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { DbExecutor } from './db';
import type { Tx } from './runtime';
import { auditLog } from './schema';
import { storeScopeCondition, type StoreScope } from './store-scope';

/**
 * 操作人（ADR 0010）：成员操作带角色与来源 IP；系统操作（定时任务、同步、自动推进）记为「系统」。
 * 角色存 contracts 的角色标识（如 supervisor）作快照，P27 显示时换成中文名。
 */
export type Actor =
  | {
      readonly kind: 'member';
      readonly memberId: string;
      readonly name: string;
      readonly roles: readonly Role[];
      readonly ip: string | null;
    }
  | { readonly kind: 'system' };

export const systemActor: Actor = { kind: 'system' };

interface AuditEntryOf<A extends AuditAction> {
  /** `对象.动词`，如 store.create、aftersales.complete、auth.login；只能用 contracts 的 auditActions 登记过的 */
  readonly action: A;
  /** 登记了对象类型的动作只能写那一种（越权访问可以是任何对象） */
  readonly objectType: AuditActionObjectType<A>;
  readonly objectId: string;
  /** 对象编号或名称，P27 显示用 */
  readonly objectLabel?: string | null;
  /** 对象所属店铺；成员、设置、登录等没有店铺属性的对象不填（PRD 10.2） */
  readonly storeId?: string | null;
  /** 完整前值（新建不填），形状按该动作登记的快照结构 */
  readonly before?: AuditSnapshot<A>;
  /** 完整后值 */
  readonly after?: AuditSnapshot<A>;
}

/**
 * 一条审计（ADR 0010）。动作与前后值的形状在 contracts 的 auditActions / auditSnapshotSchemas 登记：
 * 没登记的动作、对不上快照结构的前后值编译不过，P27 才能按结构写成中文并过滤财务字段（K18）
 */
export type AuditEntry = { [A in AuditAction]: AuditEntryOf<A> }[AuditAction];

/** 在业务事务内写一条审计；时间取事务的「当前时间」（ADR 0006：应用层同事务写入，不用触发器） */
export async function recordAudit(tx: Tx, actor: Actor, entry: AuditEntry): Promise<void> {
  const operator =
    actor.kind === 'member'
      ? {
          actorId: actor.memberId,
          actorName: actor.name,
          actorRoles: [...actor.roles],
          ip: actor.ip,
        }
      : { actorId: null, actorName: SYSTEM_ACTOR_NAME, actorRoles: [], ip: null };
  await tx.db.insert(auditLog).values({
    occurredAt: tx.now,
    actorType: actor.kind,
    ...operator,
    action: entry.action,
    objectType: entry.objectType,
    objectId: entry.objectId,
    objectLabel: entry.objectLabel ?? null,
    storeId: entry.storeId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

export type AuditRecord = typeof auditLog.$inferSelect;

export interface AuditQuery {
  objectType?: AuditObjectType;
  objectId?: string;
  action?: string;
}

/**
 * 按对象或动作取审计记录，按时间先后排序。不带店铺范围与财务字段过滤（ADR 0010），
 * 所以不从 index.ts 导出，只供 core 内部与测试核对；P27 的查询是下面的 queryAuditLog（PRD 10.2 过滤）。
 */
export async function findAuditRecords(
  db: DbExecutor,
  query: AuditQuery = {},
): Promise<AuditRecord[]> {
  const conditions: SQL[] = [];
  if (query.objectType) conditions.push(eq(auditLog.objectType, query.objectType));
  if (query.objectId) conditions.push(eq(auditLog.objectId, query.objectId));
  if (query.action) conditions.push(eq(auditLog.action, query.action));
  return db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(asc(auditLog.occurredAt), asc(auditLog.id));
}

// ---------------------------------------------------------------- P27 的查询（PRD 10.2）

/** 谁在看：P27 按 10.2 过滤（org 按访问上下文算好） */
export interface AuditVisibility {
  /** 查看者的店铺范围：只列授权店铺的对象记录与没有店铺属性的记录（成员、设置、登录等，D-27） */
  readonly stores: StoreScope;
  /** 只能看自己的操作记录时为本人的成员 ID（客服主管、管理员以外的角色）；看全部为 null */
  readonly ownActorId: string | null;
}

/** P27 的筛选条件（时间按 [from, until) 的时刻区间） */
export interface AuditLogConditions {
  readonly from: Date;
  readonly until: Date;
  /** 操作人：系统，或某位成员 */
  readonly actor?: { readonly kind: 'system' } | { readonly kind: 'member'; readonly id: string };
  readonly objectType?: AuditObjectType;
  /** 动作（「动作」筛选的一项可以是几种动作）；给了空列表时什么都不列 */
  readonly actions?: readonly AuditAction[];
  /** 对象编号搜索：对象编号或名称包含它（不分大小写） */
  readonly objectLabel?: string;
}

/** 一页（不给时列出全部，导出用） */
export interface AuditLogPage {
  readonly offset: number;
  readonly limit: number;
}

/** 查看范围：授权店铺的对象记录与没有店铺属性的记录；只能看自己的再加操作人是本人 */
function visibleCondition(visibility: AuditVisibility): SQL | undefined {
  const inScope = storeScopeCondition(visibility.stores, auditLog.storeId);
  return and(
    inScope === undefined ? undefined : or(isNull(auditLog.storeId), inScope),
    visibility.ownActorId === null ? undefined : eq(auditLog.actorId, visibility.ownActorId),
  );
}

/** LIKE 的通配符按字面匹配 */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function filterCondition(conditions: AuditLogConditions): SQL | undefined {
  const { actor, objectType, actions, objectLabel } = conditions;
  return and(
    gte(auditLog.occurredAt, conditions.from),
    lt(auditLog.occurredAt, conditions.until),
    actor === undefined
      ? undefined
      : actor.kind === 'system'
        ? eq(auditLog.actorType, 'system')
        : eq(auditLog.actorId, actor.id),
    objectType ? eq(auditLog.objectType, objectType) : undefined,
    actions === undefined
      ? undefined
      : actions.length === 0
        ? sql`false`
        : inArray(auditLog.action, [...actions]),
    objectLabel ? ilike(auditLog.objectLabel, likePattern(objectLabel)) : undefined,
  );
}

/**
 * P27 的列表（PRD P27、10.2）：按查看范围与筛选条件取记录，时间倒序；另给总条数与其中越权访问被拒的条数（E-24）。
 * 只读查询本身不记审计。财务字段的过滤在写成 P27 的行时做（contracts 的 describeAuditRecord）。
 */
export async function queryAuditLog(
  db: DbExecutor,
  visibility: AuditVisibility,
  conditions: AuditLogConditions,
  page: AuditLogPage | null,
): Promise<{ records: AuditRecord[]; total: number; denied: number }> {
  const where = and(visibleCondition(visibility), filterCondition(conditions));
  const [totals] = await db
    .select({
      total: count(),
      denied: count(sql`case when ${auditLog.action} = ${ACCESS_DENIED_ACTION} then 1 end`),
    })
    .from(auditLog)
    .where(where);
  const query = db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id));
  const records = page ? await query.limit(page.limit).offset(page.offset) : await query;
  return { records, total: totals?.total ?? 0, denied: totals?.denied ?? 0 };
}
