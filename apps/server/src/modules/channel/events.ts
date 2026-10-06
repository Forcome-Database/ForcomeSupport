import { z } from 'zod';
import { defineJob } from '../core';

/*
 * channel 发出的领域事件（ADR 0008：任务表即发件箱，在业务事务里排入）。单独成文件：收信（gmail-sync.ts）与未归属店铺来信的
 * 指定、自动归位（unassigned.ts）都发「来信已接收」，两边都只依赖这里，不互相引用。
 */

/**
 * 领域事件「来信已接收」：一封来信入库并识别出店铺（不是别的邮箱已收过的同一封信，来源也不是归档的平台通知与营销），
 * 或未归属店铺的来信被指定店铺、自动归位（待办 15），ticket 据此归并成工单。autoPlaced：自动归位的（带命中的进线邮箱），
 * 归并成工单后通知客服主管「客户 · 该地址 已归入 店铺」
 */
export const inboundReceivedJob = defineJob(
  'channel.inbound_received',
  z.object({
    messageId: z.uuid(),
    autoPlaced: z.object({ address: z.string() }).optional(),
  }),
  { retryLimit: 5, retryDelay: 10, retryBackoff: true },
);

/**
 * 领域事件「我方发信已同步」：店铺邮箱「已发送」里的一封我方邮件入库（不是别的邮箱已收过的同一封），
 * ticket 据此按 In-Reply-To、References、Gmail 线程把它归到工单（回复识别，R-SL-08，待办 16）
 */
export const outboundSyncedJob = defineJob(
  'channel.outbound_synced',
  z.object({ messageId: z.uuid() }),
  { retryLimit: 5, retryDelay: 10, retryBackoff: true },
);
