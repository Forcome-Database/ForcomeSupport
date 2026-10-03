import { and, eq, getTableName, sql } from 'drizzle-orm';
import type { PgColumn, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Tx } from './runtime';

/**
 * 乐观锁冲突（规格「数据约定」）：带 version 的更新没有命中行，说明别人先保存了。
 * 接口统一返回 409，前端按 G7「乐观锁冲突」提示（保留输入，「查看最新」或「覆盖保存」）。
 */
export class OptimisticLockError extends Error {
  override name = 'OptimisticLockError';
  readonly objectType: string;
  readonly objectId: string;

  constructor(objectType: string, objectId: string) {
    super(`${objectType} ${objectId} 已被他人修改`);
    this.objectType = objectType;
    this.objectId = objectId;
  }
}

/** 带 UUIDv7 主键 id 与 version 列的主表（见 columns.ts） */
type VersionedTable = PgTable & { id: PgColumn; version: PgColumn };

/**
 * 带乐观锁的更新：只在 version 等于调用方读到的版本时更新，并把 version 加 1，返回更新后的行；
 * 没命中抛 OptimisticLockError。数据不做物理删除（作废、取消用状态），所以没命中就是版本冲突。
 */
export async function updateWithVersion<T extends VersionedTable>(
  tx: Tx,
  table: T,
  target: { id: string; version: number },
  values: PgUpdateSetSource<T>,
): Promise<T['$inferSelect']> {
  const rows = (await tx.db
    .update(table)
    .set({ ...values, version: sql`${table.version} + 1` })
    .where(and(eq(table.id, target.id), eq(table.version, target.version)))
    .returning()) as T['$inferSelect'][];
  const [row] = rows;
  if (!row) {
    throw new OptimisticLockError(getTableName(table), target.id);
  }
  return row;
}
