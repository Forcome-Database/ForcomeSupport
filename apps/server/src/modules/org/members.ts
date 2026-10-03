import { roles as allRoles, type Density, type MemberStatus, type Role } from '@forcome/contracts';
import { and, arrayContains, eq } from 'drizzle-orm';
import type { DbExecutor, Tx } from '../core';
import { member } from './schema';
import type { MemberRow } from './session';

/** 新建成员的内容（示例数据夹具、测试工具；钉钉同步与 P20 随 05、06 号待办） */
export interface NewMember {
  /** 不填由数据库生成 UUIDv7；示例数据用夹具里确定的 id */
  readonly id?: string;
  readonly name: string;
  readonly dept: string;
  readonly roles: readonly Role[];
  /** 全部店铺（含以后新增的）；为 false 时只限 storeIds */
  readonly allStores: boolean;
  readonly storeIds?: readonly string[];
  readonly factoryCode?: string | null;
  readonly status?: MemberStatus;
}

/** 新建成员；id 已存在时跳过（示例数据重复加载不报错），返回成员 id */
export async function createMember(tx: Tx, input: NewMember): Promise<string> {
  const [row] = await tx.db
    .insert(member)
    .values({
      id: input.id,
      name: input.name,
      dept: input.dept,
      roles: [...input.roles],
      allStores: input.allStores,
      storeIds: [...(input.storeIds ?? [])],
      factoryCode: input.factoryCode ?? null,
      status: input.status ?? 'active',
      createdAt: tx.now,
      updatedAt: tx.now,
    })
    .onConflictDoNothing({ target: member.id })
    .returning({ id: member.id });
  const id = row?.id ?? input.id;
  if (!id) throw new Error('成员创建失败');
  return id;
}

export async function findMember(db: DbExecutor, id: string): Promise<MemberRow | null> {
  const [row] = await db.select().from(member).where(eq(member.id, id)).limit(1);
  return row ?? null;
}

/** 在职成员，按角色（PRD 10.1 的顺序）再按姓名排序 */
export async function listActiveMembers(db: DbExecutor): Promise<MemberRow[]> {
  const rows = await db.select().from(member).where(eq(member.status, 'active'));
  const rank = (row: MemberRow) => Math.min(...row.roles.map((role) => allRoles.indexOf(role)));
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
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
 * 保存密度偏好。只是个人的界面偏好：不加版本号（不与管理员在 P20 改角色、店铺范围互相冲突），
 * 也不记审计（不是业务数据）。
 */
export async function saveDensity(tx: Tx, memberId: string, density: Density): Promise<void> {
  await tx.db.update(member).set({ density }).where(eq(member.id, memberId));
}
