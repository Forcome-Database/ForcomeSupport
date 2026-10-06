import {
  roles as allRoles,
  isTeamMember,
  SYSTEM_ACTOR_NAME,
  teamAccessErrors,
  teamFieldPath,
  teamMessages,
  teamRoles,
  type AuditAction,
  type FieldErrors,
  type Role,
  type StoreScopeValue,
  type Team,
  type TeamCandidate,
  type TeamChange,
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
import { memberAuditSnapshot, memberScopeValue } from './members';
import { member } from './schema';
import type { MemberRow } from './session';

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
    roles: [...row.roles],
    stores: memberScopeValue(row),
    status: row.status,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    version: row.version,
    changedBy: row.changedByName,
    changedAt: row.changedAt?.toISOString() ?? null,
  };
}

/** 角色在成员表里按 PRD 10.1 的顺序存 */
const ordered = (memberRoles: readonly Role[]): Role[] =>
  allRoles.filter((role) => memberRoles.includes(role));

/** 角色的先后：成员的几个角色里最靠前的那个（PRD 10.1 的顺序） */
const roleRank = (memberRoles: readonly Role[]) =>
  Math.min(...memberRoles.map((role) => allRoles.indexOf(role)), allRoles.length);

/** 成员表：至少有一个客服系统角色的成员（含已停用的），按角色、同角色按加入先后（原型 P20 的顺序） */
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
    .filter((row) => isTeamMember(row.roles))
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

const sameScope = (a: StoreScopeValue, b: StoreScopeValue) =>
  a.all === b.all && (a.all || b.all || a.storeIds.join(',') === b.storeIds.join(','));

const sameRoles = (a: readonly Role[], b: readonly Role[]) =>
  ordered(a).join(',') === ordered(b).join(',');

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
    else if (row.status !== 'active') errors.memberId = teamMessages.notActive(row.name);
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
    roles: ordered(input.roles),
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
    const roles = ordered([...change.roles, ...keptFactory]);
    const scope = normalizeScope(change.stores, stores);
    return {
      row,
      change,
      roles,
      scope,
      rolesChanged: !sameRoles(roles, row.roles),
      storesChanged: !sameScope(scope, memberScopeValue(row)),
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
