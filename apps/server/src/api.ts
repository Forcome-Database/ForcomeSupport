// 入口：api（HTTP 服务）。只插入后台任务，不消费（ADR 0005、0008）。
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createLogger, loadConfig, startingAt, startRuntime } from './modules/core';
import {
  createIntegrationClients,
  databaseCallRecorder,
  databaseCredentialVault,
} from './modules/integration';
import { onShutdown } from './shutdown';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'api' });
const { runtime, stop } = await startRuntime(config.databaseUrl, {
  role: 'api',
  logger,
  // 非生产环境可设起始时刻（CLOCK_START），截图与演示对上原型的演示时刻
  clock: config.clockStart ? startingAt(config.clockStart) : undefined,
});

// 真实现的每次外部调用写一条调用记录（待办 09）；动态凭据（Shopify 访问令牌）用主密钥加密存库（待办 11）
const clients = createIntegrationClients(config, {
  callRecorder: databaseCallRecorder(runtime, logger),
  credentialVault: databaseCredentialVault(runtime, config.credentialMasterKey),
  clock: runtime.clock,
});
const app = createApp({ runtime, logger, config, clients });
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info(
    {
      port: info.port,
      appEnv: config.appEnv,
      devLogin: config.devLoginEnabled,
      mailSendAllowlistOnly: config.mailSend.allowlistOnly,
    },
    'api 已启动',
  );
});

onShutdown(logger, async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await stop();
});
