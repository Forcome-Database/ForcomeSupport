import { inboundReceivedJob, outboundSyncedJob } from '../channel';
import { handleJob, type AnyJobHandler } from '../core';
import type { IntegrationClients } from '../integration';
import { mergeInbound } from './merge';
import { attributeReply, attributeReplyJob } from './replies';
import { scanTimeLimits, ticketTimeLimitsJob } from './time-limits';

/**
 * ticket 的后台任务处理器（由 apps/server/src/jobs.ts 汇总）：
 * - channel「来信已接收」→ 归并成工单。按订单归并要在订单镜像里查不到时去平台补拉（order 的 findOrder），
 *   外部客户端由组装根给出（测试里是 Fake）；
 * - channel「我方发信已同步」与等着的回复重新识别 → 回复识别（16）；
 * - 每分钟的时限扫描：SLA 到期、按时关闭、不再等的回复（16），「当前时间」取运行时的时钟。
 */
export function createTicketJobHandlers(deps: { clients: IntegrationClients }): AnyJobHandler[] {
  return [
    handleJob(inboundReceivedJob, (payload, context) =>
      mergeInbound(deps.clients, payload, context),
    ),
    handleJob(outboundSyncedJob, attributeReply),
    handleJob(attributeReplyJob, attributeReply),
    handleJob(ticketTimeLimitsJob, async (_payload, { runtime, logger }) => {
      await scanTimeLimits(runtime, runtime.clock.now(), logger);
    }),
  ];
}
