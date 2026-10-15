// 后台任务的总表（ADR 0008）：各模块在自己的待办里把任务定义加到 jobDefinitions（migrate 据此建队列；定时任务带 schedule，
// worker 启动时登记），
// 把处理器加到 createJobHandlers（worker 据此订阅，测试据此「跑完任务」）。两边必须一一对应，
// test/jobs.test.ts 核对。处理器要用外部客户端时从 deps 取，测试里拿到的就是 Fake。
// 常驻拉取（Gmail 推送等）加到 createFeeds：worker 为每个起一个循环，测试的「跑完任务」每轮先拉一次。
import { getDemoFixture } from '@forcome/fixtures';
import type { ServerDeps } from './deps';
import { createAftersalesJobHandlers } from './modules/aftersales';
import {
  channelSelfCheckProbe,
  createChannelFeeds,
  createChannelJobHandlers,
  gmailPollJob,
  gmailRenewWatchJob,
  gmailSyncJob,
  imapPollJob,
  imapSyncJob,
  inboundReceivedJob,
  listOrderStores,
  outboundSyncedJob,
  placeUnassignedJob,
  reportAcceptanceJob,
  storeChangedJob,
  storeNamesById,
} from './modules/channel';
import {
  createCoreJobHandlers,
  DEFAULT_ALERT_SETTINGS,
  selfCheckJob,
  sendWorkNotificationsJob,
  syncExchangeRatesJob,
  type AnyJobDefinition,
  type AnyJobHandler,
  type Feed,
} from './modules/core';
import {
  dingtalkClient,
  dingtalkRobotClient,
  exchangeRateClient,
  fixtureNoReplyMarks,
  integrationSelfCheckProbe,
} from './modules/integration';
import {
  createOrgFeeds,
  createOrgJobHandlers,
  dingtalkEventJob,
  dingtalkReconcileJob,
  memberDisabledJob,
  orgSelfCheckProbe,
} from './modules/org';
import {
  amazonOrderChangedJob,
  amazonPollJob,
  amazonSyncJob,
  createOrderFeeds,
  createOrderJobHandlers,
  createOrderSelfCheckProbes,
  orderReconcileJob,
  orderSweepPageJob,
  orderSweepResumeJob,
  shopifyPollJob,
  shopifySyncJob,
} from './modules/order';
import { attributeReplyJob, createTicketJobHandlers, ticketTimeLimitsJob } from './modules/ticket';

export const jobDefinitions: readonly AnyJobDefinition[] = [
  syncExchangeRatesJob,
  sendWorkNotificationsJob,
  selfCheckJob,
  dingtalkReconcileJob,
  dingtalkEventJob,
  memberDisabledJob,
  storeChangedJob,
  placeUnassignedJob,
  reportAcceptanceJob,
  gmailSyncJob,
  gmailPollJob,
  gmailRenewWatchJob,
  imapSyncJob,
  imapPollJob,
  inboundReceivedJob,
  outboundSyncedJob,
  attributeReplyJob,
  ticketTimeLimitsJob,
  shopifyPollJob,
  shopifySyncJob,
  amazonPollJob,
  amazonSyncJob,
  amazonOrderChangedJob,
  orderSweepPageJob,
  orderSweepResumeJob,
  orderReconcileJob,
];

export function createJobHandlers(deps: ServerDeps): readonly AnyJobHandler[] {
  return [
    // 汇率的两个来源（欧洲央行、Frankfurter）与发工作通知的钉钉都是全局外部客户端，按 CLIENT_MODE_<系统> 给真实现或 Fake
    ...createCoreJobHandlers({
      exchangeRates: () => deps.clients.global(exchangeRateClient),
      workNotifications: () => deps.clients.global(dingtalkClient),
      // 每分钟自检（待办 28）：各模块的自检项在这里组装，告警经运维群的钉钉机器人发出
      selfCheck: {
        alerts: () => deps.clients.global(dingtalkRobotClient),
        probes: [
          channelSelfCheckProbe,
          ...createOrderSelfCheckProbes({ storeNames: storeNamesById }),
          orgSelfCheckProbe,
          integrationSelfCheckProbe,
        ],
        appEnv: deps.config.appEnv,
        settings: deps.config.alerts ?? DEFAULT_ALERT_SETTINGS,
      },
    }),
    ...createOrgJobHandlers({ dingtalk: () => deps.clients.global(dingtalkClient) }),
    ...createChannelJobHandlers(deps),
    // 「成员已停用」→ 售后单进入改派队列（待办 23）
    ...createAftersalesJobHandlers(),
    // 订单同步要的店铺来自 channel 的店铺配置（order 不依赖 channel）
    ...createOrderJobHandlers({ clients: deps.clients, stores: listOrderStores }),
    // 按订单归并：镜像没有时经 order 去平台补拉，用同一组外部客户端；非生产环境的示例回放另按示例数据标记无需回复（待办 17）
    ...createTicketJobHandlers({
      appEnv: deps.config.appEnv,
      clients: deps.clients,
      fixtureMarks:
        deps.config.appEnv === 'production' ? [] : fixtureNoReplyMarks(getDemoFixture()),
    }),
  ];
}

export function createFeeds(deps: ServerDeps): readonly Feed[] {
  return [
    ...createChannelFeeds(deps),
    ...createOrgFeeds({ dingtalk: () => deps.clients.global(dingtalkClient) }),
    // 亚马逊订单变化通知（SQS）：要的店铺同样来自 channel 的店铺配置
    ...createOrderFeeds({ clients: deps.clients, stores: listOrderStores }),
  ];
}

/**
 * 历史邮件回放的流水线（待办 26）：回放每推进一封邮件，就在回放的运行时里把这几个队列跑到空闲——来信归并、我方发信与等着的回复
 * 识别。其余队列（订单同步、钉钉、汇率等）留给 worker，回放不碰
 */
export const mailReplayPipelineJobs: readonly string[] = [
  inboundReceivedJob.name,
  outboundSyncedJob.name,
  attributeReplyJob.name,
];
