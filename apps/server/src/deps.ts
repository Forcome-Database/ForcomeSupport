import type { IntegrationClients } from './modules/integration';
import type { AppConfig, Logger, Runtime } from './modules/core';

/**
 * 接口与后台任务共用的进程级依赖（组装根）。入口（api.ts、worker.ts）按运行配置组装；
 * 测试（test/harness.ts）换成测试库、手动时钟与 Fake，被测代码拿到的就是这些替身。
 */
export interface ServerDeps {
  readonly runtime: Runtime;
  readonly logger: Logger;
  /** 自检的阈值（alerts）只有 worker 用；不给时用默认值（测试、api） */
  readonly config: Pick<AppConfig, 'appEnv' | 'devLoginEnabled'> &
    Partial<Pick<AppConfig, 'alerts'>>;
  /** 外部客户端（真实现或 Fake，ADR 0009 修订） */
  readonly clients: IntegrationClients;
}
