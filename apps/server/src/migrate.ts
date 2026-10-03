// 入口：migrate（一次性）。部署时先于 api 与 worker 运行，只向前执行迁移（ADR 0013）。
import { jobDefinitions } from './jobs';
import { runMigrations } from './migrations';
import { createLogger, loadConfig } from './modules/core';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'migrate' });

try {
  await runMigrations(config.databaseUrl, jobDefinitions, logger);
  logger.info('迁移完成');
} catch (error) {
  logger.error({ err: error }, '迁移失败');
  process.exitCode = 1;
}
