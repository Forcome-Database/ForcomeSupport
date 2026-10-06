import type { Tx } from '../core';
import { customer, customerIdentity, pendingReply, ticket, ticketMessage } from './schema';
import { clearStatusChanges } from './ticket-status';

/**
 * 清掉全部工单、工单消息、状态变更记录、等来信的我方回复与客户（「重放来信」，只用于非生产环境，见 apps/server/src/reset-inbound-data.ts）：
 * 收取的邮件清掉后，由它们归并出的工单与客户一并清掉，重新回放时按新口径重新归并。按外键先子后父删除；
 * 状态一致性约束（迁移 0007）只管新建与改状态，删除不受影响。
 */
export async function clearTickets(tx: Tx): Promise<{ tickets: number; customers: number }> {
  await tx.db.delete(pendingReply);
  await tx.db.delete(ticketMessage);
  await clearStatusChanges(tx);
  const tickets = await tx.db.delete(ticket).returning({ id: ticket.id });
  await tx.db.delete(customerIdentity);
  const customers = await tx.db.delete(customer).returning({ id: customer.id });
  return { tickets: tickets.length, customers: customers.length };
}
