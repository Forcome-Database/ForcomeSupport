// 后台任务处理器的总表（ADR 0008）：各模块在自己的待办里把处理器加到这里，worker 据此订阅，
// migrate 据此建队列。
import type { AnyJobDefinition, AnyJobHandler } from './modules/core';

export const jobHandlers: readonly AnyJobHandler[] = [];

export const jobDefinitions: readonly AnyJobDefinition[] = jobHandlers.map((h) => h.job);
