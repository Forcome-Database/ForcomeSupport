import { z } from 'zod';
import { defineJob, handleJob, type AnyJobHandler, type AppEnv, type Feed } from '../core';
import type { IntegrationClients } from '../integration';
import {
  createGmailPushFeed,
  gmailPollJob,
  gmailRenewWatchJob,
  gmailSyncJob,
  pollMailboxes,
  renewWatches,
  syncMailbox,
} from './gmail-sync';
import { deliverReportAcceptance, reportAcceptanceJob } from './dev-acceptance';
import {
  createImapIdleFeed,
  imapPollJob,
  imapSyncJob,
  pollImapMailboxes,
  syncImapMailbox,
} from './imap-sync';
import { placeMatchingMail } from './unassigned';

/**
 * 未归属店铺来信的兜底归位（待办 15）：每 5 分钟（worker 启动时也一次）再扫一次队列，收件地址已登记的归位。
 * 「店铺已变更」时已立即归位过；这里补上收信与登记邮箱同时进行、信在新邮箱生效前入队的那几封
 */
export const placeUnassignedJob = defineJob(
  'channel.place_unassigned',
  z.object({}),
  { policy: 'stately', retryLimit: 0 },
  { cron: '*/5 * * * *', tz: 'Asia/Shanghai', runAtStartup: true },
);

/**
 * 领域事件「店铺已变更」（待办 07 发出）：新增或编辑店铺后，在同一事务里排入。
 * addedMailboxes 是这次新登记的进线邮箱（新增店铺时为全部）：有新登记的地址时，未归属队列中收件地址已登记的来信
 * 按 R-ST-02 重新识别并归位（E-13、AC-P1-16，unassigned.ts 的 placeMatchingMail，待办 15）。新登记的邮箱由收信的常驻拉取
 * 自动开始监听（Gmail 为 gmail-sync.ts，163 企业邮箱为 imap-sync.ts；后者改了服务器、端口或授权码也由常驻拉取立即重连）。
 */
export const storeChangedJob = defineJob(
  'channel.store_changed',
  z.object({ storeId: z.uuid(), addedMailboxes: z.array(z.string()) }),
);

/**
 * channel 的后台任务处理器（由 apps/server/src/jobs.ts 汇总）；「来信已接收」由 ticket 处理。
 * 运行环境决定没有切换记录时实时收信开不开（生产环境待切换，待办 26 的 mail-cutover.ts）
 */
export function createChannelJobHandlers(deps: {
  clients: IntegrationClients;
  config: { appEnv: AppEnv };
}): AnyJobHandler[] {
  return [
    // 有新登记的进线邮箱时，未归属队列里收件地址匹配的来信自动归位（待办 15）
    handleJob(storeChangedJob, async (payload, { runtime, logger }) => {
      if (payload.addedMailboxes.length === 0) return;
      const placed = await placeMatchingMail(runtime, logger);
      logger.info({ ...payload, placed }, '店铺已变更：未归属来信自动归位');
    }),
    handleJob(placeUnassignedJob, async (_payload, { runtime, logger }) => {
      const placed = await placeMatchingMail(runtime, logger);
      if (placed > 0) logger.info({ placed }, '兜底扫描：未归属来信自动归位');
    }),
    handleJob(gmailSyncJob, (payload, context) =>
      syncMailbox(deps.clients, deps.config.appEnv, payload, context),
    ),
    handleJob(gmailPollJob, (_payload, { runtime, logger }) => pollMailboxes(runtime, logger)),
    handleJob(gmailRenewWatchJob, (_payload, context) => renewWatches(deps.clients, context)),
    // 163 企业邮箱（待办 35，ADR 0015）
    handleJob(imapSyncJob, (payload, context) =>
      syncImapMailbox(deps.clients, deps.config.appEnv, payload, context),
    ),
    handleJob(imapPollJob, (_payload, { runtime, logger }) => pollImapMailboxes(runtime, logger)),
    // AC-P1-14 的验收夹具（只在非生产环境由开发接口排入，待办 24）
    handleJob(reportAcceptanceJob, (_payload, context) =>
      deliverReportAcceptance(deps.clients, context),
    ),
  ];
}

/** channel 的常驻拉取（由 apps/server/src/jobs.ts 汇总）：Gmail 推送、163 企业邮箱的 IDLE 常驻连接 */
export function createChannelFeeds(deps: {
  clients: IntegrationClients;
  config: { appEnv: AppEnv };
}): Feed[] {
  return [createGmailPushFeed(deps.clients), createImapIdleFeed(deps.clients, deps.config.appEnv)];
}
