// 入口：api（HTTP 服务）。只插入后台任务，不消费（ADR 0005、0008）。
import { serve } from '@hono/node-server';
import { createApp } from './app';
import {
  closeDatabase,
  createDatabase,
  createJobQueue,
  createLogger,
  loadConfig,
  systemClock,
} from './modules/core';
import { onShutdown } from './shutdown';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'api' });
const db = createDatabase(config.databaseUrl, { applicationName: 'forcome-api' });
const boss = createJobQueue(config.databaseUrl, { role: 'api', logger });
await boss.start();

const app = createApp({ runtime: { db, boss, clock: systemClock }, logger });
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info({ port: info.port, appEnv: config.appEnv }, 'api 已启动');
});

onShutdown(logger, async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await boss.stop({ graceful: true, close: true });
  await closeDatabase(db);
});
