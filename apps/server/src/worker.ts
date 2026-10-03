// 入口：worker（后台任务）。消费各模块注册的任务，做 pg-boss 维护与定时（ADR 0008）。
import { jobHandlers } from './jobs';
import { createLogger, loadConfig, startRuntime, startWorker } from './modules/core';
import { onShutdown } from './shutdown';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'worker' });
const { runtime, stop } = await startRuntime(config.databaseUrl, { role: 'worker', logger });

await startWorker(runtime, jobHandlers, { logger });
logger.info({ jobs: jobHandlers.map((h) => h.job.name), appEnv: config.appEnv }, 'worker 已启动');

// 停止时等正在处理的任务结束（最多 30 秒），再关连接
onShutdown(logger, () => stop({ timeoutMs: 30_000 }));
