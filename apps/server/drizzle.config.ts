import { defineConfig } from 'drizzle-kit';

// 表结构写在各模块的 schema.ts（ADR 0006）；drizzle-kit generate 生成 SQL 迁移并提交进仓库，
// 不需要连数据库。迁移由 migrate 入口执行（src/migrations.ts），执行记录用 drizzle-kit 的默认位置。
// 只有 studio 等需要连库的命令才读 DATABASE_URL。
const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/*/schema.ts',
  out: './drizzle',
  ...(url ? { dbCredentials: { url } } : {}),
  strict: true,
  verbose: true,
});
