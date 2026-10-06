// 入口：order-backfill（一次性，开发测试与生产都用）。开始订单回补（待办 13）：
//   node dist/order-backfill.mjs [--store <店铺名>]… [--again]
// 给亚马逊与 Shopify 店铺开始近 90 天的订单回补，worker 在后台逐页做；先跑 migrate、先在 P18 登记店铺。命令本身在
// order-backfill-command.ts，这里只组装运行时。部署脚本子命令：node deploy/deploy.mjs <环境> order-backfill [--store <店铺名>]…
import { createLogger, loadConfig, startRuntime } from './modules/core';
import { runOrderBackfillCommand } from './order-backfill-command';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'order-backfill' });

try {
  process.exitCode = await runOrderBackfillCommand(process.argv.slice(2), {
    startRuntime: async () => {
      const { runtime, stop } = await startRuntime(config.databaseUrl, {
        role: 'api',
        logger,
        poolMax: 1,
      });
      return { runtime, stop: () => stop({ graceful: false }) };
    },
    io: {
      stdout: (line) => process.stdout.write(line),
      stderr: (line) => process.stderr.write(line),
    },
  });
} catch (error) {
  logger.error({ err: error }, '开始订单回补失败');
  process.exitCode = 1;
}
