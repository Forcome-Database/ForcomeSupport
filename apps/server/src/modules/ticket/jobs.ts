import { inboundReceivedJob } from '../channel';
import { handleJob, type AnyJobHandler } from '../core';
import { mergeInbound } from './merge';

/** ticket 的后台任务处理器（由 apps/server/src/jobs.ts 汇总）：channel「来信已接收」→ 归并成工单 */
export function createTicketJobHandlers(): AnyJobHandler[] {
  return [handleJob(inboundReceivedJob, mergeInbound)];
}
