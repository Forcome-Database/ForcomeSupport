// Playwright 用的 api（待办 02）：每次启动先重建 e2e 专用库、执行迁移、灌示例数据，
// 再以开发登录启动正式的 api 入口。环境变量取自 e2e.env（端口 4518、库 forcome_e2e）。
import pg from 'pg';
import { jobDefinitions } from '../src/jobs';
import { runMigrations } from '../src/migrations';
import { createLogger, loadConfig } from '../src/modules/core';
import { seedDemoData } from '../src/seed-data';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'e2e' });

const target = new URL(config.databaseUrl);
const database = decodeURIComponent(target.pathname.slice(1));
// 只重建 e2e 专用库，防止误删开发库
if (!/^[a-z0-9_]+_e2e$/.test(database)) {
  throw new Error(`e2e 只能重建名字以 _e2e 结尾的库，当前是 ${database}`);
}
const maintenance = new URL(target);
maintenance.pathname = '/postgres';
const admin = new pg.Client({ connectionString: maintenance.toString() });
await admin.connect();
try {
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${database}"`);
} finally {
  await admin.end();
}

await runMigrations(config.databaseUrl, jobDefinitions, logger);
const report = await seedDemoData(config.databaseUrl, config.appEnv, logger);
logger.info({ database, steps: report.steps }, 'e2e 库已重建并灌入示例数据');

await import('../src/api');
