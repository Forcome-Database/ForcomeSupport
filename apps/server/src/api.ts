// 入口：api（HTTP 服务）。只插入后台任务，不消费（ADR 0005、0008）。
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createLogger, loadConfig, startRuntime } from './modules/core';
import { onShutdown } from './shutdown';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'api' });
const { runtime, stop } = await startRuntime(config.databaseUrl, { role: 'api', logger });

const app = createApp({ runtime, logger });
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info({ port: info.port, appEnv: config.appEnv }, 'api 已启动');
});

onShutdown(logger, async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await stop();
});
