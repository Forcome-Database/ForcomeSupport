// 后台任务的总表（ADR 0008）：各模块在自己的待办里把任务定义加到 jobDefinitions（migrate 据此建队列；定时任务带 schedule，
// worker 启动时登记），
// 把处理器加到 createJobHandlers（worker 据此订阅，测试据此「跑完任务」）。两边必须一一对应，
// test/jobs.test.ts 核对。处理器要用外部客户端时从 deps 取，测试里拿到的就是 Fake。
// 常驻拉取（Gmail 推送等）加到 createFeeds：worker 为每个起一个循环，测试的「跑完任务」每轮先拉一次。
import type { ServerDeps } from './deps';
import {
  createChannelFeeds,
  createChannelJobHandlers,
  gmailSyncJob,
  inboundReceivedJob,
  storeChangedJob,
} from './modules/channel';
import {
  createCoreJobHandlers,
  syncExchangeRatesJob,
  type AnyJobDefinition,
  type AnyJobHandler,
  type Feed,
} from './modules/core';
import { exchangeRateClient } from './modules/integration';
import { createTicketJobHandlers } from './modules/ticket';

export const jobDefinitions: readonly AnyJobDefinition[] = [
  syncExchangeRatesJob,
  storeChangedJob,
  gmailSyncJob,
  inboundReceivedJob,
];

export function createJobHandlers(deps: ServerDeps): readonly AnyJobHandler[] {
  return [
    // 汇率的两个来源（欧洲央行、Frankfurter）是全局外部客户端，按 CLIENT_MODE_EXCHANGE_RATE 给真实现或 Fake
    ...createCoreJobHandlers({ exchangeRates: () => deps.clients.global(exchangeRateClient) }),
    ...createChannelJobHandlers(deps),
    ...createTicketJobHandlers(),
  ];
}

export function createFeeds(deps: ServerDeps): readonly Feed[] {
  return [...createChannelFeeds(deps)];
}
