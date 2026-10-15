import { announceChange, type Tx } from '../core';
import { mailboxSync, mailCutover, mailReplayItem, message } from './schema';

/**
 * 清掉收取的邮件与各邮箱的增量游标（「重放来信」，只用于非生产环境，见 apps/server/src/reset-inbound-data.ts）：
 * 识别口径变了以后，让 Fake Gmail 与 Fake IMAP 按新口径重新回放示例来信——游标清掉后 worker 重新开始监听，回放的信在开始监听后送达。
 * 历史回放的切换记录与回放清单（待办 26）一并清掉：非生产环境回到「已切换」，worker 照常实时收示例来信，回放命令也能重新演练。
 * 店铺、进线邮箱与来源规则不动。
 */
export async function clearInboundMail(tx: Tx): Promise<{ messages: number; mailboxes: number }> {
  // 一条语句删全部邮件：副本指向准的那封（duplicate_of_id），外键在语句结束时检查
  const messages = await tx.db.delete(message).returning({ id: message.id });
  const mailboxes = await tx.db.delete(mailboxSync).returning({ id: mailboxSync.id });
  await tx.db.delete(mailReplayItem);
  await tx.db.delete(mailCutover);
  await announceChange(tx, { topic: 'unassigned_mail' });
  return { messages: messages.length, mailboxes: mailboxes.length };
}
