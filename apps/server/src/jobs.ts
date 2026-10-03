// 后台任务的总表（ADR 0008）：各模块在自己的待办里把任务定义加到 jobDefinitions（migrate 据此建队列），
// 把处理器加到 createJobHandlers（worker 据此订阅，测试据此「跑完任务」）。两边必须一一对应，
// test/jobs.test.ts 核对。处理器要用外部客户端时从 deps 取，测试里拿到的就是 Fake。
import type { ServerDeps } from './deps';
import type { AnyJobDefinition, AnyJobHandler } from './modules/core';

export const jobDefinitions: readonly AnyJobDefinition[] = [];

export function createJobHandlers(_deps: ServerDeps): readonly AnyJobHandler[] {
  return [];
}
