import {
  roles as allRoles,
  type AuditSnapshot,
  type Density,
  type MemberStatus,
  type OwnerOption,
  type Role,
  type StoreScopeValue,
} from '@forcome/contracts';
import { and, arrayContains, eq, inArray } from 'drizzle-orm';
import type { DbExecutor, Tx } from '../core';
import { member } from './schema';
import type { MemberRow } from './session';

/** 新建成员的内容（示例数据夹具、测试工具；钉钉通讯录同步建的成员见 directory.ts） */
export interface NewMember {
  /** 不填由数据库生成 UUIDv7；示例数据用夹具里确定的 id */
  readonly id?: string;
  /** 钉钉用户 ID：示例成员与 Fake 钉钉的通讯录对得上（夹具的 key）；测试里建的成员可以不给 */
  readonly dingtalkUserId?: string | null;
  readonly name: string;
  readonly dept: string;
  readonly email?: string | null;
  readonly roles: readonly Role[];
  /** 全部店铺（含以后新增的）；为 false 时只限 storeIds */
  readonly allStores: boolean;
  readonly storeIds?: readonly string[];
  readonly factoryCode?: string | null;
  readonly status?: MemberStatus;
  /** 加入的时刻（P20 同角色按加入先后排），不填为事务的当前时间 */
  readonly createdAt?: Date;
}

/** 新建成员；id 已存在时跳过（示例数据重复加载不报错），返回成员 id */
export async function createMember(tx: Tx, input: NewMember): Promise<string> {
  const [row] = await tx.db
    .insert(member)
    .values({
      id: input.id,
      dingtalkUserId: input.dingtalkUserId ?? null,
      name: input.name,
      dept: input.dept,
      email: input.email ?? null,
      roles: [...input.roles],
      allStores: input.allStores,
      storeIds: [...(input.storeIds ?? [])],
      factoryCode: input.factoryCode ?? null,
      status: input.status ?? 'active',
      createdAt: input.createdAt ?? tx.now,
      updatedAt: tx.now,
    })
    .onConflictDoNothing({ target: member.id })
    .returning({ id: member.id });
  const id = row?.id ?? input.id;
  if (!id) throw new Error('成员创建失败');
  return id;
}

/** 成员的店铺范围（接口与审计的写法）：全部店铺，或指定的几个店铺 */
export function memberScopeValue(row: Pick<MemberRow, 'allStores' | 'storeIds'>): StoreScopeValue {
  return row.allStores ? { all: true } : { all: false, storeIds: [...row.storeIds] };
}

/** 审计里成员的前后值：姓名、钉钉部门、状态、角色、店铺范围（钉钉同步与 P20 共用） */
export function memberAuditSnapshot(
  row: Pick<MemberRow, 'name' | 'dept' | 'status' | 'roles' | 'allStores' | 'storeIds'>,
): AuditSnapshot<'member.add'> {
  return {
    name: row.name,
    dept: row.dept,
    status: row.status,
    roles: [...row.roles],
    stores: memberScopeValue(row),
  };
}

export async function findMember(db: DbExecutor, id: string): Promise<MemberRow | null> {
  const [row] = await db.select().from(member).where(eq(member.id, id)).limit(1);
  return row ?? null;
}

/** 按钉钉的 unionid 找成员（扫码登录：已离职的人在本组织里没有用户 ID 了） */
export async function findMemberByDingtalkUnionId(
  db: DbExecutor,
  unionId: string,
): Promise<MemberRow | null> {
  const [row] = await db.select().from(member).where(eq(member.dingtalkUnionId, unionId)).limit(1);
  return row ?? null;
}

/** 按钉钉用户 ID 找成员（扫码登录） */
export async function findMemberByDingtalkUserId(
  db: DbExecutor,
  dingtalkUserId: string,
): Promise<MemberRow | null> {
  const [row] = await db
    .select()
    .from(member)
    .where(eq(member.dingtalkUserId, dingtalkUserId))
    .limit(1);
  return row ?? null;
}

/**
 * 成员姓名（含已停用的）：售后单的登记人、负责人等只存成员 ID，显示时按它取姓名。成员不属于店铺，不带店铺范围
 */
export async function memberNamesById(
  db: DbExecutor,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(inArray(member.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** 按角色（PRD 10.1 的顺序）再按姓名排序；没有角色的排最后 */
function byRoleThenName(rows: MemberRow[]): MemberRow[] {
  const rank = (row: MemberRow) =>
    Math.min(...row.roles.map((role) => allRoles.indexOf(role)), allRoles.length);
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/** 在职成员，按角色（PRD 10.1 的顺序）再按姓名排序 */
export async function listActiveMembers(db: DbExecutor): Promise<MemberRow[]> {
  return byRoleThenName(await db.select().from(member).where(eq(member.status, 'active')));
}

/** 全部成员（含已停用的：他们的操作记录仍在，P27 的操作人筛选要列出），排序同上 */
export async function listMembers(db: DbExecutor): Promise<MemberRow[]> {
  return byRoleThenName(await db.select().from(member));
}

/** 在职的管理员（G2、G12 写「请联系管理员刘洋」） */
export async function listAdmins(db: DbExecutor): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(and(eq(member.status, 'active'), arrayContains(member.roles, ['admin'])));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/**
 * 在职的售后负责人与各自的店铺数据范围（售后单负责人的候选，D-24：只能选有该店铺数据范围的售后负责人），按姓名排序。
 * 成员与角色不属于店铺，不带店铺范围；哪些人能负责哪个店铺的单由调用方按范围筛（contracts 的 ownersForStore）。
 */
export async function listAftersalesOwners(db: DbExecutor): Promise<OwnerOption[]> {
  const rows = await db
    .select({
      id: member.id,
      name: member.name,
      allStores: member.allStores,
      storeIds: member.storeIds,
    })
    .from(member)
    .where(and(eq(member.status, 'active'), arrayContains(member.roles, ['aftersales_owner'])));
  return rows
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .map((row) => ({
      id: row.id,
      name: row.name,
      stores: row.allStores ? { all: true } : { all: false, storeIds: [...row.storeIds] },
    }));
}

/**
 * 给这些成员的行加共享锁（FOR SHARE，按 id 排序防死锁），之后在同一事务里读到的在职状态与角色不会被并发的停用改掉
 * （协调者 2026-10-14 决定 R2）：新建登记、编辑登记改负责人、改派与停用弹窗的接手人在校验负责人之前调用。停用成员持行锁
 * （FOR UPDATE）、钉钉离职停用改成员行，都与它串行——停用先提交则校验时他已不在职，登记先提交则停用重查时会发现新单
 */
export async function lockMembersForShare(db: DbExecutor, ids: readonly string[]): Promise<void> {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return;
  await db
    .select({ id: member.id })
    .from(member)
    .where(inArray(member.id, unique))
    .orderBy(member.id)
    .for('share');
}

/**
 * 保存密度偏好。只是个人的界面偏好：不加版本号（不与管理员在 P20 改角色、店铺范围互相冲突），
 * 也不记审计（不是业务数据）。
 */
export async function saveDensity(tx: Tx, memberId: string, density: Density): Promise<void> {
  await tx.db.update(member).set({ density }).where(eq(member.id, memberId));
}
