// 入口：reset-inbound（一次性，只用于非生产环境）。「重放来信」：清掉收取的邮件、邮箱游标、工单与客户，
// worker 重启后 Fake Gmail 按当前的识别与归并口径重新回放示例来信（reset-inbound-data.ts，docs/部署说明.md）。
// 先停 worker 再执行；生产环境拒绝（连数据库之前就拒绝，组合函数里另有一道）。
import { createLogger, loadConfig, startRuntime } from './modules/core';
import { RESET_INBOUND_REFUSED, resetInboundData } from './reset-inbound-data';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'reset-inbound' });

async function main(): Promise<void> {
  if (config.appEnv === 'production') {
    throw new Error(RESET_INBOUND_REFUSED);
  }
  const { runtime, stop } = await startRuntime(config.databaseUrl, {
    role: 'api',
    logger,
    poolMax: 1,
  });
  try {
    const report = await resetInboundData(runtime, config.appEnv);
    logger.info(report, '已清空收信与工单；重启 worker 后按当前口径重新回放示例来信');
  } finally {
    await stop({ graceful: false });
  }
}

try {
  await main();
} catch (error) {
  logger.error({ err: error }, '清空收信与工单失败');
  process.exitCode = 1;
}
