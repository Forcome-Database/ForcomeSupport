import { z } from 'zod';
import { defineJob } from '../core';

/*
 * org 发出的领域事件（ADR 0008：任务表即发件箱，在业务事务里排入；ADR 0005：跨模块联动走事件）。
 */

/**
 * 领域事件「成员已停用」（待办 23）：钉钉离职自动停用（directory.ts）与管理员在 P20 停用（team.ts）都在停用的事务里发。
 * aftersales 据此把他负责、还没改派的进行中售后单标为「待分配」进入改派队列，并按店铺通知客服主管（AC-ST-05）；
 * 管理员停用时已在同一事务里改派（AC-ST-02），这时一般已没有要进队列的单
 */
export const memberDisabledJob = defineJob(
  'org.member_disabled',
  z.object({
    memberId: z.uuid(),
    reason: z.enum(['manual', 'dingtalk_left']),
  }),
  { retryLimit: 5, retryDelay: 10, retryBackoff: true },
);
