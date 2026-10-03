// 入口：worker（后台任务）。消费各模块注册的任务，做 pg-boss 维护与定时（ADR 0008）。
import { jobHandlers } from './jobs';
import {
  closeDatabase,
  createDatabase,
  createJobQueue,
  createLogger,
  loadConfig,
  startWorker,
  systemClock,
} from './modules/core';
import { onShutdown } from './shutdown';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'worker' });
const db = createDatabase(config.databaseUrl, { applicationName: 'forcome-worker' });
const boss = createJobQueue(config.databaseUrl, { role: 'worker', logger });
await boss.start();

await startWorker({ db, boss, clock: systemClock }, jobHandlers, { logger });
logger.info({ jobs: jobHandlers.map((h) => h.job.name), appEnv: config.appEnv }, 'worker 已启动');

onShutdown(logger, async () => {
  // 等正在处理的任务结束（最多 30 秒），再关连接
  await boss.stop({ graceful: true, close: true, timeout: 30_000 });
  await closeDatabase(db);
});
