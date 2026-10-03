import { SYSTEM_ACTOR_NAME, type AuditObjectType } from '@forcome/contracts';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { DbExecutor } from './db';
import type { Tx } from './runtime';
import { auditLog } from './schema';

/**
 * 操作人（ADR 0010）：成员操作带角色与来源 IP；系统操作（定时任务、同步、自动推进）记为「系统」。
 * 角色在 04 号待办由 contracts 的角色枚举收紧类型，这里先存字符串快照。
 */
export type Actor =
  | {
      readonly kind: 'member';
      readonly memberId: string;
      readonly name: string;
      readonly roles: readonly string[];
      readonly ip: string | null;
    }
  | { readonly kind: 'system' };

export const systemActor: Actor = { kind: 'system' };

export interface AuditEntry {
  /** `对象.动词`，如 store.create、member.disable、auth.login */
  readonly action: string;
  readonly objectType: AuditObjectType;
  readonly objectId: string;
  /** 对象编号或名称，P27 显示用 */
  readonly objectLabel?: string | null;
  /** 对象所属店铺；成员、设置、登录等没有店铺属性的对象不填（PRD 10.2） */
  readonly storeId?: string | null;
  /** 完整前值（新建不填） */
  readonly before?: unknown;
  /** 完整后值 */
  readonly after?: unknown;
}

/** 在业务事务内写一条审计；时间取事务的「当前时间」（ADR 0006：应用层同事务写入，不用触发器） */
export async function recordAudit(tx: Tx, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.db.insert(auditLog).values({
    occurredAt: tx.now,
    actorType: actor.kind,
    actorId: actor.kind === 'member' ? actor.memberId : null,
    actorName: actor.kind === 'member' ? actor.name : SYSTEM_ACTOR_NAME,
    actorRoles: actor.kind === 'member' ? [...actor.roles] : [],
    ip: actor.kind === 'member' ? actor.ip : null,
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
 * 按对象或动作取审计记录，按时间先后排序。不做可见范围与财务字段过滤，
 * 只供服务内部与测试核对；P27 的查询（PRD 10.2 过滤）由 30 号待办提供。
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
