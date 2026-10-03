// 入口：seed（一次性，只用于非生产环境）。把示例数据夹具灌进 DATABASE_URL 指向的库（待办 02），
// 供本机与开发测试环境使用；先跑 migrate。生产环境拒绝。
import { createLogger, loadConfig } from './modules/core';
import { seedDemoData } from './seed-data';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'seed' });

try {
  const report = await seedDemoData(config.databaseUrl, config.appEnv, logger);
  logger.info({ steps: report.steps }, '示例数据已灌入');
} catch (error) {
  logger.error({ err: error }, '灌示例数据失败');
  process.exitCode = 1;
}
