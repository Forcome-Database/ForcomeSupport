// 入口：sp-api-token（一次性，开发测试与生产都用）。录入某卖家的 SP-API 授权刷新令牌（待办 12）：
//   node dist/sp-api-token.mjs --seller <卖家 ID> < <放刷新令牌的文件>
// 令牌从标准输入读，用主密钥加密存给平台标识为该卖家 ID 的亚马逊店铺；先跑 migrate、先在 P18 登记店铺。命令本身在
// sp-api-token-command.ts，这里只组装运行时。部署脚本子命令：node deploy/deploy.mjs <环境> sp-api-token --seller <卖家 ID>。
import { text } from 'node:stream/consumers';
import { createLogger, loadConfig, startRuntime } from './modules/core';
import { runSpApiTokenCommand } from './sp-api-token-command';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'sp-api-token' });

try {
  process.exitCode = await runSpApiTokenCommand(process.argv.slice(2), await text(process.stdin), {
    masterKey: config.credentialMasterKey,
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
  logger.error({ err: error }, '录入卖家授权失败');
  process.exitCode = 1;
}
