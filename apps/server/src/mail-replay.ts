// 入口：mail-replay（一次性，上线切换用，生产与开发测试环境都可用）。历史邮件回放与 T0 切换（待办 26）：
//   node dist/mail-replay.mjs [--t0 <带时区的时刻>] [--confirm]
// 不加 --confirm 只看计划；加了才执行：各进线邮箱 watch → 定 T0 → 近 90 天邮件按到达时间升序单线程回放 → 开启实时处理。
// 执行时 worker 必须停着（命令检查）。命令本身在 mail-replay-command.ts，这里只组装运行时与外部客户端（同 worker）。
// 部署脚本子命令：node deploy/deploy.mjs <环境> mail-replay [--t0 <时刻>] [--confirm]（docs/部署说明.md 第 16 节）
import type { ServerDeps } from './deps';
import { createJobHandlers, mailReplayPipelineJobs } from './jobs';
import { runMailReplayCommand } from './mail-replay-command';
import { createLogger, loadConfig, startingAt, startRuntime } from './modules/core';
import {
  createIntegrationClients,
  databaseCallRecorder,
  databaseCredentialVault,
} from './modules/integration';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'mail-replay' });

try {
  process.exitCode = await runMailReplayCommand(process.argv.slice(2), {
    startRuntime: async () => {
      const { runtime, stop } = await startRuntime(config.databaseUrl, {
        role: 'api',
        logger,
        // 会话级咨询锁占一条，回放的查询与写入用其余的
        poolMax: 3,
        clock: config.clockStart ? startingAt(config.clockStart) : undefined,
      });
      const clients = createIntegrationClients(config, {
        callRecorder: databaseCallRecorder(runtime, logger),
        credentialVault: databaseCredentialVault(runtime, config.credentialMasterKey),
        clock: runtime.clock,
      });
      const deps: ServerDeps = { runtime, logger, config, clients };
      return {
        runtime,
        clients,
        handlers: createJobHandlers(deps),
        logger,
        stop: () => stop({ graceful: false }),
      };
    },
    io: {
      stdout: (line) => process.stdout.write(line),
      stderr: (line) => process.stderr.write(line),
    },
    pipelineJobs: mailReplayPipelineJobs,
  });
} catch (error) {
  logger.error({ err: error }, '历史邮件回放失败');
  process.exitCode = 1;
}
