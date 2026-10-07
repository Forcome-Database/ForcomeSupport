import { eq } from 'drizzle-orm';
import { findInboundMessage } from '../channel';
import { SYSTEM_STORE_SCOPE, type JobContext, type Runtime } from '../core';
import type { ReplayNoReplyMark } from '../integration';
import { markNoReply, NoReplyRefusedError } from './no-reply';
import { customer, ticket, ticketMessage } from './schema';

/*
 * 示例回放里的「标记无需回复」（待办 17；ADR 0009 修订）：示例数据里已解决的两张工单（Oliver Grant 的致谢来信、Valeria Ríos）
 * 是坐席标记无需回复的结果。标记不是邮件，Fake Gmail 回放不了：这封来信归并后，ticket 以标记人的身份、在标记时刻（来信到达时刻
 * 加上示例里的间隔，回放整天平移时跟着平移）走与 P05 相同的标记（迁移表、事件行、审计）。只在非生产环境由组装根注入，
 * 生产环境为空、不做任何事。任务重跑时已标记的跳过。
 */

export async function applyFixtureMark(
  marks: readonly ReplayNoReplyMark[],
  messageId: string,
  { runtime, logger }: Pick<JobContext, 'runtime' | 'logger'>,
): Promise<void> {
  if (marks.length === 0) return;
  const mail = await findInboundMessage(runtime.db, SYSTEM_STORE_SCOPE, messageId);
  const mark = mail && marks.find((m) => m.messageId === mail.rfcMessageId);
  if (!mail || !mark) return;
  const [merged] = await runtime.db
    .select({
      id: ticket.id,
      number: ticket.number,
      storeId: ticket.storeId,
      customerName: customer.name,
      markedAt: ticketMessage.noReplyAt,
    })
    .from(ticketMessage)
    .innerJoin(ticket, eq(ticket.id, ticketMessage.ticketId))
    .innerJoin(customer, eq(customer.id, ticket.customerId))
    .where(eq(ticketMessage.channelMessageId, messageId))
    .limit(1);
  if (!merged || merged.markedAt) return;
  const at = new Date(mail.receivedAt.getTime() + mark.afterMs);
  const clocked: Runtime = { ...runtime, clock: { now: () => at } };
  const actor = {
    kind: 'member' as const,
    memberId: mark.member.id,
    name: mark.member.name,
    roles: mark.member.roles,
    ip: null,
  };
  try {
    await markNoReply(clocked, actor, merged, messageId);
    logger.info({ ticket: merged.number, messageId }, '示例回放：来信已按示例数据标记无需回复');
  } catch (error) {
    // 示例数据与回放顺序对不上（例如这封信已被回复）：记日志，不让归并任务失败
    if (!(error instanceof NoReplyRefusedError)) throw error;
    logger.warn(
      { ticket: merged.number, messageId, reason: error.message },
      '示例回放：标记无需回复被拒',
    );
  }
}
