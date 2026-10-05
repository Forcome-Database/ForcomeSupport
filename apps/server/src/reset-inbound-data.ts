import { clearInboundMail, gmailSyncJob, inboundReceivedJob } from './modules/channel';
import { resetBusinessNumbers, transaction, type AppEnv, type Runtime } from './modules/core';
import { clearTickets } from './modules/ticket';

/** 生产环境执行「重放来信」时的报错（入口、组合函数与测试共用） */
export const RESET_INBOUND_REFUSED = '生产环境不能清空收信与工单';

export interface InboundResetReport {
  readonly messages: number;
  readonly mailboxes: number;
  readonly tickets: number;
  readonly customers: number;
}

/**
 * 「重放来信」（只用于非生产环境，docs/部署说明.md；待办 10 起，协调者 10-05 要求做成可重复的步骤）：
 * 识别或归并的口径变了，已入库的示例来信不会回头重新识别——清掉收取的邮件、各邮箱的增量游标、工单与客户，
 * 并把工单编号从 0001 重新发号；worker 重启后重新 watch 各邮箱，Fake Gmail 按新口径重新回放示例来信。
 * 成员、店铺、进线邮箱、来源规则、会话与审计都不动。执行前先停 worker（部署脚本的 reset-inbound 会停、清、再起）。
 * 生产环境拒绝。
 */
export async function resetInboundData(
  runtime: Runtime,
  appEnv: AppEnv,
): Promise<InboundResetReport> {
  if (appEnv === 'production') {
    throw new Error(RESET_INBOUND_REFUSED);
  }
  // 还没跑的同步与归并任务指向马上要清掉的邮件，先丢掉
  for (const job of [gmailSyncJob, inboundReceivedJob]) {
    await runtime.boss.deleteAllJobs(job.name);
  }
  return transaction(runtime, async (tx) => {
    const mail = await clearInboundMail(tx);
    const tickets = await clearTickets(tx);
    await resetBusinessNumbers(tx, 'ticket');
    return { ...mail, ...tickets };
  });
}
