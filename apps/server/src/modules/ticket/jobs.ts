import { inboundReceivedJob } from '../channel';
import { handleJob, type AnyJobHandler } from '../core';
import type { IntegrationClients } from '../integration';
import { mergeInbound } from './merge';

/**
 * ticket 的后台任务处理器（由 apps/server/src/jobs.ts 汇总）：channel「来信已接收」→ 归并成工单。
 * 按订单归并要在订单镜像里查不到时去平台补拉（order 的 findOrder），外部客户端由组装根给出（测试里是 Fake）
 */
export function createTicketJobHandlers(deps: { clients: IntegrationClients }): AnyJobHandler[] {
  return [
    handleJob(inboundReceivedJob, (payload, context) =>
      mergeInbound(deps.clients, payload, context),
    ),
  ];
}
