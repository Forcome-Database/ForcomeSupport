import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  closeDatabase,
  createDatabase,
  createJobQueue,
  ensureQueues,
  type AnyJobDefinition,
  type Logger,
} from './modules/core';

/** drizzle-kit 生成并提交进仓库的迁移（src 与打包后的 dist 都在它的下一级） */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * 只向前执行迁移（ADR 0013）：先跑 drizzle-kit 生成的 SQL，再安装或升级 pg-boss 自己的表，
 * 最后确保各任务的队列存在。重复执行是空操作。
 */
export async function runMigrations(
  databaseUrl: string,
  jobs: readonly AnyJobDefinition[],
  logger: Logger,
): Promise<void> {
  const db = createDatabase(databaseUrl, { max: 1, applicationName: 'forcome-migrate' });
  try {
    await migrate(db, {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    });
  } finally {
    await closeDatabase(db);
  }
  const boss = createJobQueue(databaseUrl, { role: 'migrate', logger });
  await boss.start();
  try {
    await ensureQueues(boss, jobs);
  } finally {
    await boss.stop({ graceful: false, close: true });
  }
}
