import { SYSTEM_ACTOR_NAME } from '@forcome/contracts';
import { and, eq, isNotNull, isNull, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { advisoryLock, recordAudit, systemActor, type DbExecutor, type Tx } from '../core';
import type { DingtalkDepartment, DingtalkDirectory, DingtalkUser } from '../integration';
import { memberDisabledJob } from './events';
import { department, member } from './schema';
import { closeMemberSessions, type MemberRow } from './session';
import { memberAuditSnapshot } from './members';

/*
 * 钉钉通讯录 → 成员与部门（规格 org「钉钉 Stream 通讯录事件 + 每小时全量对账，同步成员与部门（只读）」，PRD D-16、11.1，待办 05）：
 * - 新出现的人建成员（没有角色、没有店铺范围，管理员在 P20 分配后才能进入，G12「未分配角色」）；
 * - 姓名、部门、邮箱随钉钉；
 * - 不在通讯录里了（离职）：停用（原因「钉钉离职」）、立即删掉他的会话，审计「钉钉离职停用」，发「成员已停用」事件
 *   （AC-ST-05：aftersales 把他负责的进行中售后单放进改派队列，待办 23）；
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

/** 写一个部门；已有的只在 onlyIfSyncedBy（取数据的时刻）之前同步过时才改 */
async function upsertDepartment(
  tx: Tx,
  item: DingtalkDepartment,
  onlyIfSyncedBy: Date,
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
      setWhere: lte(department.syncedAt, onlyIfSyncedBy),
    });
}

/** 一位成员按通讯录写入的结果 */
type MemberSyncResult = 'created' | 'updated' | 'rejoined' | 'unchanged';

function count(changes: DirectoryChanges, result: MemberSyncResult): void {
  if (result === 'created') changes.created += 1;
  if (result === 'updated') changes.updated += 1;
  if (result === 'rejoined') changes.rejoined += 1;
}

/**
 * 按通讯录里的一个人写成员（调用方已加锁）。syncedBy 是取这份数据之前的时刻：成员行在那之后已被别的事件或对账更新过，
 * 这份数据就是旧的，不写。认人按用户 ID，再按 unionid（同一个人在各组织里不变）：
 * - 用户 ID 对得上、unionid 也对得上（或有一边没有）：同一个人，更新资料（钉钉离职停用的恢复在职）；
 * - 用户 ID 对得上、unionid 不同：这个用户 ID 已给了另一个人——旧成员解绑用户 ID，在职的按钉钉离职停用；新人另建；
 * - 用户 ID 对不上、unionid 对得上：同一个人离职后重新入职、钉钉给了新的用户 ID——换上新的用户 ID；旧的还在职（离职没同步到）
 *   的先按钉钉离职停用，再按回到通讯录恢复在职（角色与店铺范围清空），与离职后又回来同一个口径；
 * - 都对不上：新人，建成员（没有角色、没有店铺范围）。
 */
async function syncMember(
  tx: Tx,
  user: DingtalkUser,
  dept: string,
  syncedBy: Date,
): Promise<MemberSyncResult> {
  // 本事务里刚写过的（同一轮对账里先停用、后又以新的用户 ID 碰到同一个人）不算更新过
  const newerThanData = (row: MemberRow) =>
    row.dingtalkSyncedAt !== null &&
    row.dingtalkSyncedAt > syncedBy &&
    row.dingtalkSyncedAt.getTime() !== tx.now.getTime();
  const [byUserId] = await tx.db
    .select()
    .from(member)
    .where(eq(member.dingtalkUserId, user.userId))
    .limit(1);
  if (byUserId) {
    if (newerThanData(byUserId)) return 'unchanged';
    const reused =
      byUserId.dingtalkUnionId !== null &&
      user.unionId !== null &&
      byUserId.dingtalkUnionId !== user.unionId;
    if (!reused) return refreshFromDirectory(tx, byUserId, user, dept);
    await tx.db.update(member).set({ dingtalkUserId: null }).where(eq(member.id, byUserId.id));
    if (byUserId.status === 'active') await leaveFromDirectory(tx, byUserId);
  }
  if (user.unionId) {
    const [same] = await tx.db
      .select()
      .from(member)
      .where(eq(member.dingtalkUnionId, user.unionId))
      .limit(1);
    if (same) {
      if (newerThanData(same)) return 'unchanged';
      if (same.status === 'active') await leaveFromDirectory(tx, same);
      await tx.db.update(member).set({ dingtalkUserId: user.userId }).where(eq(member.id, same.id));
      const left = same.status === 'active';
      return refreshFromDirectory(
        tx,
        {
          ...same,
          dingtalkUserId: user.userId,
          status: left ? 'disabled' : same.status,
          disabledReason: left ? 'dingtalk_left' : same.disabledReason,
        },
        user,
        dept,
      );
    }
  }
  return (await createFromDirectory(tx, user, dept)) ? 'created' : 'unchanged';
}

async function createFromDirectory(tx: Tx, user: DingtalkUser, dept: string): Promise<boolean> {
  const inserted = await tx.db
    .insert(member)
    .values({
      dingtalkUserId: user.userId,
      dingtalkUnionId: user.unionId,
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
): Promise<MemberSyncResult> {
  const rejoin = row.status === 'disabled' && row.disabledReason === 'dingtalk_left';
  const changed =
    row.name !== user.name ||
    row.dept !== dept ||
    row.email !== user.email ||
    (user.unionId !== null && row.dingtalkUnionId !== user.unionId) ||
    row.dingtalkDepartmentIds.join(',') !== user.departmentIds.join(',');
  if (!rejoin && !changed) return 'unchanged';
  const profile = {
    name: user.name,
    dept,
    dingtalkDepartmentIds: [...user.departmentIds],
    email: user.email,
    // 钉钉没给 unionid 时保留已有的
    ...(user.unionId === null ? {} : { dingtalkUnionId: user.unionId }),
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
      changedAt: tx.now,
      changedByName: SYSTEM_ACTOR_NAME,
      version: sql`${member.version} + 1`,
    })
    .where(eq(member.id, row.id));
  await recordAudit(tx, systemActor, {
    action: 'member.dingtalk_rejoined',
    objectType: 'member',
    objectId: row.id,
    objectLabel: user.name,
    before: memberAuditSnapshot(row),
    after: memberAuditSnapshot({
      name: user.name,
      dept,
      status: 'active',
      roles: [],
      allStores: false,
      storeIds: [],
    }),
  });
  return 'rejoined';
}

/**
 * 钉钉离职：停用、立即删掉他的会话（不能再登录，现有会话立即失效，AC-ST-05），审计「钉钉离职停用」，
 * 同一事务里发「成员已停用」事件，让 aftersales 把他负责的进行中售后单放进改派队列（org 不读写售后单，ADR 0005）。
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
      changedAt: tx.now,
      changedByName: SYSTEM_ACTOR_NAME,
      version: sql`${member.version} + 1`,
    })
    .where(eq(member.id, row.id));
  await closeMemberSessions(tx.db, row.id);
  await recordAudit(tx, systemActor, {
    action: 'member.dingtalk_left',
    objectType: 'member',
    objectId: row.id,
    objectLabel: row.name,
    before: memberAuditSnapshot(row),
    after: memberAuditSnapshot({ ...row, status: 'disabled' }),
  });
  await tx.enqueue(memberDisabledJob, { memberId: row.id, reason: 'dingtalk_left' });
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

  // 部门显示按写完之后的部门表算：快照之后由部门事件改过的名字保留在部门表里，不被旧快照改回去
  const tree = await loadDepartmentTree(tx.db);
  for (const user of snapshot.users) {
    count(changes, await syncMember(tx, user, departmentPath(tree, user.departmentIds), startedAt));
  }
  // 通讯录里没有了的在职成员：离职（快照之后由事件更新过的不算；换了用户 ID 的同一个人上面已认出）
  const present = new Set(snapshot.users.map((u) => u.userId));
  const presentUnionIds = new Set(snapshot.users.flatMap((u) => (u.unionId ? [u.unionId] : [])));
  const active = await tx.db
    .select()
    .from(member)
    .where(and(eq(member.status, 'active'), isNotNull(member.dingtalkUserId), syncedBy(startedAt)));
  for (const row of active) {
    if (row.dingtalkUserId && present.has(row.dingtalkUserId)) continue;
    if (row.dingtalkUnionId && presentUnionIds.has(row.dingtalkUnionId)) continue;
    await leaveFromDirectory(tx, row);
    changes.left += 1;
  }
  return changes;
}

/**
 * 一位成员的事件（调用方已加锁）：通讯录里取到了就新建或更新，取不到（已离职）就停用。fetchedAt 是向钉钉取这个人之前的时刻：
 * 这之后这一行已被别的事件或对账更新过（同一个人的几个事件并发处理时），这次取到的就是旧的，不写
 */
export async function applyUserChange(
  tx: Tx,
  userId: string,
  user: DingtalkUser | null,
  departments: readonly DingtalkDepartment[],
  fetchedAt: Date,
): Promise<DirectoryChanges> {
  const changes = emptyChanges();
  for (const item of departments) await upsertDepartment(tx, item, fetchedAt);
  if (!user) {
    const [row] = await tx.db
      .select()
      .from(member)
      .where(eq(member.dingtalkUserId, userId))
      .limit(1);
    const newer = row?.dingtalkSyncedAt && row.dingtalkSyncedAt > fetchedAt;
    if (row?.status === 'active' && !newer) {
      await leaveFromDirectory(tx, row);
      changes.left += 1;
    }
    return changes;
  }
  const dept = departmentPath(await loadDepartmentTree(tx.db), user.departmentIds);
  count(changes, await syncMember(tx, user, dept, fetchedAt));
  return changes;
}

/**
 * 部门的事件（调用方已加锁）：新建或改名、调整上级的写进部门表，删掉的从部门表删；再按新的部门表重算成员的「钉钉部门」显示。
 * fetchedAt 同 applyUserChange：取部门之后被更新过的部门不写。返回显示变了的成员数
 */
export async function applyDepartmentChanges(
  tx: Tx,
  upserts: readonly DingtalkDepartment[],
  removedIds: readonly string[],
  fetchedAt: Date,
): Promise<number> {
  for (const item of upserts) await upsertDepartment(tx, item, fetchedAt);
  for (const id of removedIds) {
    await tx.db
      .delete(department)
      .where(and(eq(department.dingtalkId, id), lte(department.syncedAt, fetchedAt)));
  }
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
      // 只改显示，不动 dingtalk_synced_at（它只记成员资料按钉钉更新的时刻，过时保护靠它）
      .set({ dept, updatedAt: tx.now })
      .where(eq(member.id, row.id));
    changed += 1;
  }
  return changed;
}
