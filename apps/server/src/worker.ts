// 入口：worker（后台任务）。消费各模块注册的任务、运行常驻拉取（Gmail 推送等），做 pg-boss 维护与定时（ADR 0008）。
import type { ServerDeps } from './deps';
import { createFeeds, createJobHandlers } from './jobs';
import { createLogger, loadConfig, startFeeds, startRuntime, startWorker } from './modules/core';
import { createIntegrationClients } from './modules/integration';
import { onShutdown } from './shutdown';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'worker' });
const { runtime, stop } = await startRuntime(config.databaseUrl, { role: 'worker', logger });

const deps: ServerDeps = { runtime, logger, config, clients: createIntegrationClients(config) };
const handlers = createJobHandlers(deps);
await startWorker(runtime, handlers, { logger });
const feeds = createFeeds(deps);
const runningFeeds = startFeeds(runtime, feeds, { logger });
logger.info(
  {
    jobs: handlers.map((h) => h.job.name),
    feeds: feeds.map((f) => f.name),
    appEnv: config.appEnv,
    mailSendAllowlistOnly: config.mailSend.allowlistOnly,
  },
  'worker 已启动',
);

// 停止时先停常驻拉取，再等正在处理的任务结束（最多 30 秒），最后关连接
onShutdown(logger, async () => {
  await runningFeeds.stop();
  await stop({ timeoutMs: 30_000 });
});
