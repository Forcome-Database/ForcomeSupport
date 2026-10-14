import { handleJob, type AnyJobHandler } from '../core';
import { memberDisabledJob } from '../org';
import { queueOwnedCases } from './reassign';

/**
 * aftersales 的后台任务处理器（由 apps/server/src/jobs.ts 汇总）：
 * - org「成员已停用」→ 钉钉离职的，他负责、还没改派的进行中售后单进入改派队列，按店铺通知客服主管（AC-ST-05，待办 23）
 */
export function createAftersalesJobHandlers(): AnyJobHandler[] {
  return [
    handleJob(memberDisabledJob, (payload, { runtime, logger }) =>
      queueOwnedCases(runtime, payload, logger),
    ),
  ];
}
