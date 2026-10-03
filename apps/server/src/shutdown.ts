import type { Logger } from './modules/core';

/** 收到 SIGTERM / SIGINT（docker stop、Ctrl+C）时按顺序收尾后退出；收尾失败以非零码退出 */
export function onShutdown(logger: Logger, cleanup: () => Promise<void>): void {
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, '正在停止');
    cleanup().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, '停止时出错');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
