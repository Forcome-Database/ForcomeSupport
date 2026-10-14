import { sql } from 'drizzle-orm';
import type { Database, DbTransaction } from '../core';

/*
 * report 读别的模块的表一律经这里（ADR 0005、0006）：只读事务 + 只读数据库角色，写入会被数据库拒绝。
 * 报表绕过了仓储层的店铺范围编译期保护，每个查询都要显式施加店铺范围与财务字段过滤（规格 report 一节）。
 */

/** 报表只读角色，由迁移创建（apps/server/drizzle） */
export const REPORT_READER_ROLE = 'report_reader';

/** 在只读事务里、以报表只读角色执行查询 */
export async function runReportQuery<T>(
  db: Database,
  query: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(
    async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL ROLE ${REPORT_READER_ROLE}`));
      return query(tx);
    },
    { accessMode: 'read only' },
  );
}
