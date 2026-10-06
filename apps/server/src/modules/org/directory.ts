import type { AuditSnapshot } from '@forcome/contracts';
import { and, eq, isNotNull, isNull, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { advisoryLock, recordAudit, systemActor, type DbExecutor, type Tx } from '../core';
import type { DingtalkDepartment, DingtalkDirectory, DingtalkUser } from '../integration';
import { department, member } from './schema';
import { closeMemberSessions, type MemberRow } from './session';

/*
 * 钉钉通讯录 → 成员与部门（规格 org「钉钉 Stream 通讯录事件 + 每小时全量对账，同步成员与部门（只读）」，PRD D-16、11.1，待办 05）：
 * - 新出现的人建成员（没有角色、没有店铺范围，管理员在 P20 分配后才能进入，G12「未分配角色」）；
 * - 姓名、部门、邮箱随钉钉；
 * - 不在通讯录里了（离职）：停用（原因「钉钉离职」）、立即删掉他的会话，审计「钉钉离职停用」（AC-ST-05；负责的售后单进改派队列随待办 23）；
 * - 钉钉离职停用的又出现在通讯录里：恢复在职，但角色与店铺范围清空，等管理员重新分配（审计「钉钉恢复在职」）；
 *   管理员停用的不随通讯录变化。
 * 全量对账与事件都在同一把咨询锁下写；对账先取快照、后写库，取快照之后由事件更新过的行不用旧快照覆盖或停用。
 */

/** 通讯录写入的咨询锁（全量对账、事件、扫码登录时补建成员共用） */
export async function lockDirectory(tx: Tx): Promise<void> {
  await advisoryLock(tx, 'org.dingtalk_directory:all');
}

/** 部门：钉钉部门 ID → 名称与上级 */
export type DepartmentTree = ReadonlyMap<
  string,
  { readonly name: string; readonly parentId: string | null }
>;

export function departmentTreeOf(departments: readonly DingtalkDepartment[]): DepartmentTree {
  return new Map(departments.map((d) => [d.id, { name: d.name, parentId: d.parentId }]));
}

/** 部门表现在的样子 */
export async function loadDepartmentTree(db: DbExecutor): Promise<DepartmentTree> {
  const rows = await db.select().from(department);
  return new Map(
    rows.map((row) => [row.dingtalkId, { name: row.name, parentId: row.parentDingtalkId }]),
  );
}

/**
 * 成员的「钉钉部门」显示：主部门（第一个）从组织下第一级起的路径，例「FSH / 客服部」（P20、头像菜单、开发登录）。
 * 直接挂在组织（根部门）下的写组织名；部门表里缺了上级时写出能认出的部分；一个部门都认不出时为空。
 */
export function departmentPath(tree: DepartmentTree, departmentIds: readonly string[]): string {
  const [primary] = departmentIds;
  if (primary === undefined) return '';
  const names: string[] = [];
  const seen = new Set<string>();
  let id: string | null = primary;
  while (id !== null && !seen.has(id)) {
    seen.add(id);
    const current = tree.get(id);
    if (!current) break;
    if (current.parentId === null) {
      if (names.length === 0) names.push(current.name);
      break;
    }
    names.unshift(current.name);
    id = current.parentId;
  }
  return names.join(' / ');
}

/** 同步改了什么（写日志用） */
export interface DirectoryChanges {
  created: number;
  updated: number;
  left: number;
  rejoined: number;
}

const emptyChanges = (): DirectoryChanges => ({ created: 0, updated: 0, left: 0, rejoined: 0 });

function memberSnapshot(
  row: Pick<MemberRow, 'name' | 'dept' | 'status' | 'roles'>,
): AuditSnapshot<'member.dingtalk_left'> {
  return { name: row.name, dept: row.dept, status: row.status, roles: [...row.roles] };
}

async function upsertDepartment(
  tx: Tx,
  item: DingtalkDepartment,
  onlyIfSyncedBy: Date | null,
): Promise<void> {
  await tx.db
    .insert(department)
    .values({
      dingtalkId: item.id,
      name: item.name,
      parentDingtalkId: item.parentId,
      syncedAt: tx.now,
    })
    .onConflictDoUpdate({
      target: department.dingtalkId,
      set: { name: item.name, parentDingtalkId: item.parentId, syncedAt: tx.now },
      ...(onlyIfSyncedBy ? { setWhere: lte(department.syncedAt, onlyIfSyncedBy) } : {}),
    });
}

async function createFromDirectory(tx: Tx, user: DingtalkUser, dept: string): Promise<boolean> {
  const inserted = await tx.db
    .insert(member)
    .values({
      dingtalkUserId: user.userId,
      name: user.name,
      dept,
      dingtalkDepartmentIds: [...user.departmentIds],
      email: user.email,
      // 通讯录里来的新成员：没有角色、没有店铺范围，管理员在 P20 分配（必填）后才能进入
      roles: [],
      allStores: false,
      storeIds: [],
      dingtalkSyncedAt: tx.now,
      createdAt: tx.now,
      updatedAt: tx.now,
    })
    .onConflictDoNothing({ target: member.dingtalkUserId })
    .returning({ id: member.id });
  return inserted.length > 0;
}

/** 按通讯录里的样子更新一位已有的成员；钉钉离职停用的恢复在职。返回改了什么 */
async function refreshFromDirectory(
  tx: Tx,
  row: MemberRow,
  user: DingtalkUser,
  dept: string,
): Promise<'unchanged' | 'updated' | 'rejoined'> {
  const rejoin = row.status === 'disabled' && row.disabledReason === 'dingtalk_left';
  const changed =
    row.name !== user.name ||
    row.dept !== dept ||
    row.email !== user.email ||
    row.dingtalkDepartmentIds.join(',') !== user.departmentIds.join(',');
  if (!rejoin && !changed) return 'unchanged';
  const profile = {
    name: user.name,
    dept,
    dingtalkDepartmentIds: [...user.departmentIds],
    email: user.email,
    dingtalkSyncedAt: tx.now,
    updatedAt: tx.now,
  };
  if (!rejoin) {
    // 只是通讯录资料：不动版本号（不与管理员在 P20 改角色、店铺范围互相冲突）
    await tx.db.update(member).set(profile).where(eq(member.id, row.id));
    return 'updated';
  }
  await tx.db
    .update(member)
    .set({
      ...profile,
      status: 'active',
      disabledReason: null,
      disabledAt: null,
      roles: [],
      allStores: false,
      storeIds: [],
      version: sql`${member.version} + 1`,
    })
    .where(eq(member.id, row.id));
  await recordAudit(tx, systemActor, {
    action: 'member.dingtalk_rejoined',
    objectType: 'member',
    objectId: row.id,
    objectLabel: user.name,
    before: memberSnapshot(row),
    after: memberSnapshot({ name: user.name, dept, status: 'active', roles: [] }),
  });
  return 'rejoined';
}

/**
 * 钉钉离职：停用、立即删掉他的会话（不能再登录，现有会话立即失效，AC-ST-05），审计「钉钉离职停用」。
 * 待办 23 在这里（同一事务）发「成员已停用」事件，让 aftersales 把他负责的进行中售后单放进改派队列。
 */
async function leaveFromDirectory(tx: Tx, row: MemberRow): Promise<void> {
  await tx.db
    .update(member)
    .set({
      status: 'disabled',
      disabledReason: 'dingtalk_left',
      disabledAt: tx.now,
      dingtalkSyncedAt: tx.now,
      updatedAt: tx.now,
      version: sql`${member.version} + 1`,
    })
    .where(eq(member.id, row.id));
  await closeMemberSessions(tx.db, row.id);
  await recordAudit(tx, systemActor, {
    action: 'member.dingtalk_left',
    objectType: 'member',
    objectId: row.id,
    objectLabel: row.name,
    before: memberSnapshot(row),
    after: memberSnapshot({ ...row, status: 'disabled' }),
  });
}

/** 没被事件在快照之后更新过的行（对账用旧快照只改这些） */
function syncedBy(at: Date): SQL | undefined {
  return or(isNull(member.dingtalkSyncedAt), lte(member.dingtalkSyncedAt, at));
}

/**
 * 全量对账：把通讯录快照写进部门与成员（调用方已加锁）。startedAt 是开始取快照的时刻：之后由事件改过的部门与成员保持原样。
 * 成员一个都没有的快照不该走到这里（调用方先拦下，免得把所有人停用）。
 */
export async function applyDirectory(
  tx: Tx,
  snapshot: DingtalkDirectory,
  startedAt: Date,
): Promise<DirectoryChanges> {
  const changes = emptyChanges();
  for (const item of snapshot.departments) await upsertDepartment(tx, item, startedAt);
  const departmentIds = snapshot.departments.map((d) => d.id);
  await tx.db
    .delete(department)
    .where(
      and(
        departmentIds.length > 0 ? notInArray(department.dingtalkId, departmentIds) : undefined,
        lte(department.syncedAt, startedAt),
      ),
    );

  const tree = departmentTreeOf(snapshot.departments);
  const rows = await tx.db
    .select()
    .from(member)
    .where(and(isNotNull(member.dingtalkUserId), syncedBy(startedAt)));
  const byUserId = new Map(rows.map((row) => [row.dingtalkUserId, row]));
  const present = new Set<string>();
  for (const user of snapshot.users) {
    present.add(user.userId);
    const dept = departmentPath(tree, user.departmentIds);
    const row = byUserId.get(user.userId);
    if (!row) {
      // 不在 rows 里：新人，或快照之后被事件更新过的（建不进去，onConflictDoNothing）
      if (await createFromDirectory(tx, user, dept)) changes.created += 1;
      continue;
    }
    const result = await refreshFromDirectory(tx, row, user, dept);
    if (result === 'updated') changes.updated += 1;
    if (result === 'rejoined') changes.rejoined += 1;
  }
  for (const row of rows) {
    if (row.status !== 'active' || !row.dingtalkUserId || present.has(row.dingtalkUserId)) continue;
    await leaveFromDirectory(tx, row);
    changes.left += 1;
  }
  return changes;
}

/** 一位成员的事件（调用方已加锁）：通讯录里取到了就新建或更新，取不到（已离职）就停用 */
export async function applyUserChange(
  tx: Tx,
  userId: string,
  user: DingtalkUser | null,
  departments: readonly DingtalkDepartment[],
): Promise<DirectoryChanges> {
  const changes = emptyChanges();
  for (const item of departments) await upsertDepartment(tx, item, null);
  const [row] = await tx.db.select().from(member).where(eq(member.dingtalkUserId, userId)).limit(1);
  if (!user) {
    if (row?.status === 'active') {
      await leaveFromDirectory(tx, row);
      changes.left += 1;
    }
    return changes;
  }
  const dept = departmentPath(await loadDepartmentTree(tx.db), user.departmentIds);
  if (!row) {
    if (await createFromDirectory(tx, user, dept)) changes.created += 1;
    return changes;
  }
  const result = await refreshFromDirectory(tx, row, user, dept);
  if (result === 'updated') changes.updated += 1;
  if (result === 'rejoined') changes.rejoined += 1;
  return changes;
}

/**
 * 部门的事件（调用方已加锁）：新建或改名、调整上级的写进部门表，删掉的从部门表删；再按新的部门表重算成员的「钉钉部门」显示。
 * 返回显示变了的成员数
 */
export async function applyDepartmentChanges(
  tx: Tx,
  upserts: readonly DingtalkDepartment[],
  removedIds: readonly string[],
): Promise<number> {
  for (const item of upserts) await upsertDepartment(tx, item, null);
  for (const id of removedIds) await tx.db.delete(department).where(eq(department.dingtalkId, id));
  const tree = await loadDepartmentTree(tx.db);
  const rows = await tx.db
    .select({ id: member.id, dept: member.dept, departmentIds: member.dingtalkDepartmentIds })
    .from(member)
    .where(isNotNull(member.dingtalkUserId));
  let changed = 0;
  for (const row of rows) {
    const dept = departmentPath(tree, row.departmentIds);
    if (dept === row.dept || dept === '') continue;
    await tx.db
      .update(member)
      .set({ dept, dingtalkSyncedAt: tx.now, updatedAt: tx.now })
      .where(eq(member.id, row.id));
    changed += 1;
  }
  return changed;
}
