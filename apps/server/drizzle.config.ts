import { defineConfig } from 'drizzle-kit';

// 表结构写在各模块的 schema.ts（ADR 0006）；drizzle-kit generate 生成 SQL 迁移并提交进仓库。
// 生成不需要数据库；DATABASE_URL 只给 drizzle-kit 的其他命令（studio 等）用。
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/*/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://forcome:forcome@127.0.0.1:4520/forcome',
  },
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
  strict: true,
  verbose: true,
});
