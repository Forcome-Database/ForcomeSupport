import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { jobDefinitions } from '../src/jobs';
import { runMigrations } from '../src/migrations';
import { silentLogger } from '../src/modules/core';
import { databaseUrl, TEST_ADMIN_URL } from './database-url';

/*
 * 集成测试的数据库准备：每次运行先建一个模板库并跑完全部迁移，
 * 各测试文件再从模板复制出自己的库（CREATE DATABASE … TEMPLATE，很快），互不干扰、可以并行。
 * 本机连 docker-compose.dev.yml 的 PostgreSQL 18；CI 用服务容器，地址经 TEST_DATABASE_URL 传入。
 */
export default async function setup(project: TestProject) {
  const template = `forcome_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: TEST_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${template}"`);
    await runMigrations(databaseUrl(template), jobDefinitions, silentLogger);
  } catch (error) {
    await admin.query(`DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`);
    await admin.end();
    throw error;
  }
  project.provide('testTemplateDatabase', template);

  return async () => {
    // 删掉模板与它复制出的、测试没来得及删的库
    const { rows } = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE $1`,
      [`${template}%`],
    );
    for (const { datname } of rows) {
      await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
    await admin.end();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    testTemplateDatabase: string;
  }
}
