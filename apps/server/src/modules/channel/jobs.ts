import { z } from 'zod';
import { defineJob, handleJob, type AnyJobHandler, type Feed } from '../core';
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
import { placeMatchingMail } from './unassigned';

/**
 * 领域事件「店铺已变更」（待办 07 发出）：新增或编辑店铺后，在同一事务里排入。
 * addedMailboxes 是这次新登记的进线邮箱（新增店铺时为全部）：有新登记的地址时，未归属队列中收件地址已登记的来信
 * 按 R-ST-02 重新识别并归位（E-13、AC-P1-16，unassigned.ts 的 placeMatchingMail，待办 15）。新登记的邮箱由收信的常驻拉取
 * 自动开始监听（gmail-sync.ts）。
 */
export const storeChangedJob = defineJob(
  'channel.store_changed',
  z.object({ storeId: z.uuid(), addedMailboxes: z.array(z.string()) }),
);

/** channel 的后台任务处理器（由 apps/server/src/jobs.ts 汇总）；「来信已接收」由 ticket 处理 */
export function createChannelJobHandlers(deps: { clients: IntegrationClients }): AnyJobHandler[] {
  return [
    // 有新登记的进线邮箱时，未归属队列里收件地址匹配的来信自动归位（待办 15）
    handleJob(storeChangedJob, async (payload, { runtime, logger }) => {
      if (payload.addedMailboxes.length === 0) return;
      const placed = await placeMatchingMail(runtime, logger);
      logger.info({ ...payload, placed }, '店铺已变更：未归属来信自动归位');
    }),
    handleJob(gmailSyncJob, (payload, context) => syncMailbox(deps.clients, payload, context)),
    handleJob(gmailPollJob, (_payload, { runtime, logger }) => pollMailboxes(runtime, logger)),
    handleJob(gmailRenewWatchJob, (_payload, context) => renewWatches(deps.clients, context)),
  ];
}

/** channel 的常驻拉取（由 apps/server/src/jobs.ts 汇总）：Gmail 推送 */
export function createChannelFeeds(deps: { clients: IntegrationClients }): Feed[] {
  return [createGmailPushFeed(deps.clients)];
}
