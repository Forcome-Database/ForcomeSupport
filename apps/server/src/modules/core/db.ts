import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';

/** 应用的数据库句柄（连接池之上的 drizzle） */
export type Database = NodePgDatabase & { $client: pg.Pool };

/** 事务内的 drizzle 句柄 */
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** 只读查询既可以在事务内也可以在事务外执行 */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT>;

export interface DatabaseOptions {
  /** 连接池上限，默认 10 */
  max?: number;
  /** 连接名，出现在 pg_stat_activity 里，便于排查 */
  applicationName?: string;
}

export function createDatabase(databaseUrl: string, options: DatabaseOptions = {}): Database {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    // 连不上时尽快失败，不让请求或健康检查一直挂着
    connectionTimeoutMillis: 5_000,
    application_name: options.applicationName ?? 'forcome',
  });
  return drizzle({ client: pool });
}

/** 关闭数据库连接池（进程退出前调用） */
export async function closeDatabase(db: Database): Promise<void> {
  await db.$client.end();
}
