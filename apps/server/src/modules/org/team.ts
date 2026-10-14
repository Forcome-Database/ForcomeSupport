import {
  roles as allRoles,
  disableBlockedReason,
  handoverError,
  isTeamMember,
  orderedRoles,
  sameRoles,
  sameStoreScope,
  SYSTEM_ACTOR_NAME,
  teamAccessErrors,
  teamFieldPath,
  teamMessages,
  teamRoles,
  type AuditAction,
  type FieldErrors,
  type HandoverAssignment,
  type HandoverCase,
  type Role,
  type StoreScopeValue,
  type Team,
  type TeamCandidate,
  type TeamChange,
  type TeamDisable,
  type TeamHandover,
  type TeamMember,
  type TeamMemberAdd,
  type TeamStore,
} from '@forcome/contracts';
import { and, arrayContains, arrayOverlaps, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  advisoryLock,
  FieldValidationError,
  OptimisticLockError,
  recordAudit,
  updateWithVersion,
  type Actor,
  type DbExecutor,
  type Tx,
} from '../core';
import { dingtalkSyncHealth } from './dingtalk-sync';
import { memberDisabledJob } from './events';
import { listAftersalesOwners, memberAuditSnapshot, memberScopeValue } from './members';
import { member } from './schema';
import { closeMemberSessions, type MemberRow } from './session';

/*
 * P20 团队与权限（PRD P20「第一阶段」、K6、G7，待办 06）：成员表、「从钉钉添加」、修改角色与店铺数据范围。
 * 成员都由钉钉通讯录同步进来（待办 05），这里只改角色与店铺范围；角色与范围每次请求从成员表读，改了下一次请求即生效（ADR 0010）。
 * 写操作都在咨询锁 org.team 下先查后写（「至少一位在职的管理员」要看全表），改了才动版本号并记审计。
 */

/**
 * 授权可选的店铺（全部店铺）：channel 模块的查询，由 app.ts 注入（org 不依赖 channel）。不按管理员自己的数据范围过滤——
 * 给成员授权是管理配置，同 P18 的店铺表（ADR 0010 修订登记的例外）
 */
export type TeamStoreChoices = (db: DbExecutor) => Promise<TeamStore[]>;

const TEAM_LOCK = 'org.team';

function toTeamMember(row: MemberRow): TeamMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    dept: row.dept,
    roles: orderedRoles(row.roles),
    stores: memberScopeValue(row),
    status: row.status,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    version: row.version,
    changedBy: row.changedByName,
    changedAt: row.changedAt?.toISOString() ?? null,
  };
}

/** 角色的先后：成员的几个角色里最靠前的那个（PRD 10.1 的顺序） */
const roleRank = (memberRoles: readonly Role[]) =>
  Math.min(...memberRoles.map((role) => allRoles.indexOf(role)), allRoles.length);

/**
 * 成员表：至少有一个客服系统角色的成员（含已停用的；即 contracts 的 isTeamMember，在 SQL 里按 teamRoles 取），
 * 按角色、同角色按加入先后（原型 P20 的顺序）
 */
export async function listTeam(
  db: DbExecutor,
  storeChoices: TeamStoreChoices,
  now: Date,
): Promise<Team> {
  const [rows, stores, sync] = await Promise.all([
    db
      .select()
      .from(member)
      .where(arrayOverlaps(member.roles, [...teamRoles])),
    storeChoices(db),
    dingtalkSyncHealth(db),
  ]);
  const members = rows
    .sort(
      (a, b) =>
        roleRank(a.roles) - roleRank(b.roles) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .map(toTeamMember);
  return {
    members,
    stores,
    syncedAt: sync.lastSuccessAt?.toISOString() ?? null,
    now: now.toISOString(),
  };
}

/** 「从钉钉添加」可选的人：通讯录里在职、还没分配角色的成员，按姓名排序 */
export async function listTeamCandidates(db: DbExecutor): Promise<TeamCandidate[]> {
  const rows = await db
    .select({ id: member.id, name: member.name, dept: member.dept, email: member.email })
    .from(member)
    .where(and(eq(member.status, 'active'), sql`cardinality(${member.roles}) = 0`));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/** 指定店铺按店铺表的顺序存，去掉重复 */
function normalizeScope(scope: StoreScopeValue, stores: readonly TeamStore[]): StoreScopeValue {
  if (scope.all) return scope;
  return {
    all: false,
    storeIds: stores.map((s) => s.id).filter((id) => scope.storeIds.includes(id)),
  };
}

function changedByName(actor: Actor): string {
  return actor.kind === 'member' ? actor.name : SYSTEM_ACTOR_NAME;
}

/**
 * 从钉钉添加成员（AC-ST-06）：给通讯录同步进来、还没有角色的在职成员分配角色与店铺范围（都必填，不能是生产厂对接人）。
 * 选的人刚被别人添加过、或刚停用了，报在「成员」字段上。审计「添加成员」，前值是没有角色与范围的样子
 */
export async function addTeamMember(
  tx: Tx,
  actor: Actor,
  input: TeamMemberAdd,
  storeChoices: TeamStoreChoices,
): Promise<TeamMember> {
  await advisoryLock(tx, TEAM_LOCK);
  const stores = await storeChoices(tx.db);
  const errors: FieldErrors = {};
  let row: MemberRow | undefined;
  if (input.memberId === null) {
    errors.memberId = teamMessages.memberRequired;
  } else {
    [row] = await tx.db.select().from(member).where(eq(member.id, input.memberId)).limit(1);
    if (!row) errors.memberId = teamMessages.memberRequired;
    else if (row.roles.length > 0) errors.memberId = teamMessages.alreadyAdded(row.name);
    // 刚被停用（钉钉离职）的同没选：候选刷新后这个人从下拉里消失
    else if (row.status !== 'active') errors.memberId = teamMessages.memberRequired;
  }
  Object.assign(
    errors,
    teamAccessErrors(
      input,
      stores.map((s) => s.id),
    ),
  );
  if (!row || Object.keys(errors).length > 0) throw new FieldValidationError(errors);

  const scope = normalizeScope(input.stores!, stores);
  const updated = await updateWithVersion(tx, member, row, {
    roles: orderedRoles(input.roles),
    allStores: scope.all,
    storeIds: scope.all ? [] : scope.storeIds,
    changedAt: tx.now,
    changedByName: changedByName(actor),
    updatedAt: tx.now,
  });
  await recordAudit(tx, actor, {
    action: 'member.add',
    objectType: 'member',
    objectId: row.id,
    objectLabel: row.name,
    before: memberAuditSnapshot(row),
    after: memberAuditSnapshot(updated),
  });
  return toTeamMember(updated);
}

/** 按改了什么记哪种审计 */
function changeAction(
  rolesChanged: boolean,
  storesChanged: boolean,
): Extract<AuditAction, `member.change_${string}`> {
  if (rolesChanged && storesChanged) return 'member.change_access';
  return rolesChanged ? 'member.change_roles' : 'member.change_stores';
}

/**
 * 吸底保存栏的「保存」（K6）：这次改过的成员一起保存，要么全部保存、要么都不保存。
 * 先比版本号（有人已被别人改过、或已不在成员表里：409，G7），再一次报全字段错误（键「成员 ID.roles / .stores」）：
 * 角色与范围不能清空、不能分配生产厂对接人、已停用的不能改、改完至少要有一位在职的管理员。
 * 成员原有的生产厂对接人角色（第二期由 P24 维护）原样保留。没有变化的成员不保存、不记审计
 */
export async function saveTeam(
  tx: Tx,
  actor: Actor,
  changes: readonly TeamChange[],
  storeChoices: TeamStoreChoices,
): Promise<void> {
  await advisoryLock(tx, TEAM_LOCK);
  const ids = changes.map((c) => c.id);
  const rows = new Map(
    (await tx.db.select().from(member).where(inArray(member.id, ids))).map((row) => [row.id, row]),
  );
  for (const change of changes) {
    const row = rows.get(change.id);
    if (!row || row.version !== change.version || !isTeamMember(row.roles)) {
      throw new OptimisticLockError('org.member', change.id);
    }
  }

  const stores = await storeChoices(tx.db);
  const errors: FieldErrors = {};
  const planned = changes.map((change) => {
    const row = rows.get(change.id)!;
    const path = (field: 'roles' | 'stores') => teamFieldPath(change.id, field);
    if (row.status !== 'active') {
      errors[path('roles')] = teamMessages.disabledMember;
    } else {
      const access = teamAccessErrors(
        change,
        stores.map((s) => s.id),
      );
      if (access.roles) errors[path('roles')] = access.roles;
      if (access.stores) errors[path('stores')] = access.stores;
    }
    const keptFactory = row.roles.includes('factory_contact') ? (['factory_contact'] as const) : [];
    const roles = orderedRoles([...change.roles, ...keptFactory]);
    const scope = normalizeScope(change.stores, stores);
    return {
      row,
      change,
      roles,
      scope,
      rolesChanged: !sameRoles(roles, row.roles),
      storesChanged: !sameStoreScope(scope, memberScopeValue(row)),
    };
  });

  // 至少要有一位在职的管理员：这次没改的在职管理员，加上改完仍是管理员的
  const losing = planned.filter(
    (p) => p.row.status === 'active' && p.row.roles.includes('admin') && !p.roles.includes('admin'),
  );
  if (losing.length > 0) {
    const keeping = planned.some((p) => p.row.status === 'active' && p.roles.includes('admin'));
    const [others] = await tx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(member)
      .where(
        and(
          eq(member.status, 'active'),
          arrayContains(member.roles, ['admin']),
          notInArray(member.id, ids),
        ),
      );
    if (!keeping && (others?.count ?? 0) === 0) {
      for (const p of losing) errors[teamFieldPath(p.row.id, 'roles')] ??= teamMessages.lastAdmin;
    }
  }
  if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);

  for (const p of planned) {
    if (!p.rolesChanged && !p.storesChanged) continue;
    const updated = await updateWithVersion(tx, member, p.row, {
      roles: p.roles,
      allStores: p.scope.all,
      storeIds: p.scope.all ? [] : p.scope.storeIds,
      changedAt: tx.now,
      changedByName: changedByName(actor),
      updatedAt: tx.now,
    });
    await recordAudit(tx, actor, {
      action: changeAction(p.rolesChanged, p.storesChanged),
      objectType: 'member',
      objectId: p.row.id,
      objectLabel: p.row.name,
      before: memberAuditSnapshot(p.row),
      after: memberAuditSnapshot(updated),
    });
  }
}

// ---------------------------------------------------------------- 停用成员（K10 第一阶段，待办 23）

/**
 * 停用成员时他负责的售后单：aftersales 的查询与改派，由 app.ts 注入（org 不依赖 aftersales，也不读写售后单表，ADR 0005）。
 * 改派要与停用在同一事务（AC-ST-02），所以是注入的同步调用；之后仍发「成员已停用」事件，漏掉的单（并发新登记的）由它进改派队列
 */
export interface MemberHandover {
  /** 他负责的进行中售后单（按单号），带店铺名与版本 */
  openCases(db: DbExecutor, memberId: string): Promise<HandoverCase[]>;
  /** 在停用的事务里把这些单改派给选好的接手人（版本对不上抛 OptimisticLockError），每张记审计「改派负责人」 */
  reassign(
    tx: Tx,
    actor: Actor,
    cases: readonly HandoverCase[],
    assignments: readonly HandoverAssignment[],
  ): Promise<void>;
}

/** 在职的售后负责人（不含 memberId 这个人）：停用弹窗的接手人候选 */
async function otherOwners(db: DbExecutor, memberId: string) {
  return (await listAftersalesOwners(db)).filter((owner) => owner.id !== memberId);
}

function handoverMemberOf(row: MemberRow): TeamHandover['member'] {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    aftersalesOwner: row.roles.includes('aftersales_owner'),
  };
}

/** 成员表里的人（有客服系统角色的成员）；不是的为 null */
async function teamMemberRow(db: DbExecutor, id: string): Promise<MemberRow | null> {
  const [row] = await db.select().from(member).where(eq(member.id, id)).limit(1);
  return row && isTeamMember(row.roles) ? row : null;
}

/** 在职管理员的人数（「至少要有一位在职的管理员」） */
async function activeAdminCount(db: DbExecutor): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(member)
    .where(and(eq(member.status, 'active'), arrayContains(member.roles, ['admin'])));
  return row?.count ?? 0;
}

/**
 * 停用弹窗的内容（K10 第一阶段）：成员与版本、他负责的进行中售后单、其他在职售后负责人与店铺范围；不在成员表里为 null。
 * 怎么选接手人、能不能停用由 contracts 的 handoverPlan 判断（前后端同一个）
 */
export async function teamHandover(
  db: DbExecutor,
  handover: MemberHandover,
  memberId: string,
): Promise<TeamHandover | null> {
  const row = await teamMemberRow(db, memberId);
  if (!row) return null;
  const [cases, owners] = await Promise.all([
    handover.openCases(db, row.id),
    otherOwners(db, row.id),
  ]);
  return { member: handoverMemberOf(row), cases, owners };
}

/**
 * 「改派并停用」（AC-ST-02、K10 第一阶段）：同一事务里改派他负责的进行中售后单并停用（原因「管理员停用」，通讯录同步不会恢复）、
 * 删掉他的会话、审计「停用成员」，发「成员已停用」事件。先比版本号（G7，409），再看能不能停用（已停用、自己、最后一位在职管理员：
 * 报在 member 上）与接手人（没人可接手、没选、选的人不能接：报在 handover 上，400）。不在成员表里为 null
 */
export async function disableTeamMember(
  tx: Tx,
  actor: Actor,
  memberId: string,
  input: TeamDisable,
  handover: MemberHandover,
): Promise<TeamMember | null> {
  await advisoryLock(tx, TEAM_LOCK);
  const row = await teamMemberRow(tx.db, memberId);
  if (!row) return null;
  if (row.version !== input.version) throw new OptimisticLockError('org.member', row.id);

  const selfId = actor.kind === 'member' ? actor.memberId : '';
  const blocked = disableBlockedReason(toTeamMember(row), selfId, await activeAdminCount(tx.db));
  if (blocked) throw new FieldValidationError({ member: blocked });
  const cases = await handover.openCases(tx.db, row.id);
  const owners = await otherOwners(tx.db, row.id);
  const error = handoverError({ member: handoverMemberOf(row), cases, owners }, input.assignments);
  if (error) throw new FieldValidationError({ handover: error });

  const updated = await updateWithVersion(tx, member, row, {
    status: 'disabled',
    disabledReason: 'manual',
    disabledAt: tx.now,
    changedAt: tx.now,
    changedByName: changedByName(actor),
    updatedAt: tx.now,
  });
  await closeMemberSessions(tx.db, row.id);
  await recordAudit(tx, actor, {
    action: 'member.disable',
    objectType: 'member',
    objectId: row.id,
    objectLabel: row.name,
    before: memberAuditSnapshot(row),
    after: memberAuditSnapshot(updated),
  });
  if (cases.length > 0) await handover.reassign(tx, actor, cases, input.assignments);
  await tx.enqueue(memberDisabledJob, { memberId: row.id, reason: 'manual' });
  return toTeamMember(updated);
}
