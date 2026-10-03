import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { ensureQueues, startRuntime, type AnyJobDefinition, type Logger } from './modules/core';

/** drizzle-kit 生成并提交进仓库的迁移（src 与打包后的 dist 都在它的下一级） */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * 只向前执行迁移（ADR 0013），依次：启动 migrate 角色的 pg-boss，同时安装或升级它自己的表；
 * 执行 drizzle-kit 生成的 SQL（执行记录在 drizzle-kit 的默认位置 drizzle.__drizzle_migrations）；
 * 确保各任务的队列存在。两类表互不依赖；重复执行是空操作。
 */
export async function runMigrations(
  databaseUrl: string,
  jobs: readonly AnyJobDefinition[],
  logger: Logger,
): Promise<void> {
  const { runtime, stop } = await startRuntime(databaseUrl, {
    role: 'migrate',
    logger,
    poolMax: 1,
  });
  try {
    await migrate(runtime.db, { migrationsFolder: MIGRATIONS_FOLDER });
    await ensureQueues(runtime.boss, jobs);
  } finally {
    await stop({ graceful: false });
  }
}
