import { z } from 'zod';
import { defineJob, handleJob, type AnyJobHandler } from '../core';

/**
 * 领域事件「店铺已变更」（待办 07 发出）：新增或编辑店铺后，在同一事务里排入。
 * addedMailboxes 是这次新登记的进线邮箱（新增店铺时为全部），待办 15 据此让未归属队列中收件地址匹配的来信
 * 按 R-ST-02 重新识别并归位（E-13、AC-P1-16）。
 */
export const storeChangedJob = defineJob(
  'channel.store_changed',
  z.object({ storeId: z.uuid(), addedMailboxes: z.array(z.string()) }),
);

/** channel 的后台任务处理器（由 apps/server/src/jobs.ts 汇总） */
export function createChannelJobHandlers(): AnyJobHandler[] {
  return [
    // 未归属店铺的来信队列随 08、15 号待办；在那之前没有要归位的来信，只记日志
    handleJob(storeChangedJob, (payload, { logger }) => {
      logger.info(payload, '店铺已变更：暂无未归属来信需要归位');
      return Promise.resolve();
    }),
  ];
}
