import { SYSTEM_ACTOR_NAME, type TicketEvent, type TicketTrigger } from '@forcome/contracts';
import { updateWithVersion, type Actor, type Tx } from '../core';
import { transition, type Transition } from './lifecycle';
import { statusChange, ticket } from './schema';

/*
 * 工单状态的唯一写入口（ADR 0008「状态迁移只能经迁移表完成」）：新建与迁移都先问迁移表（lifecycle.ts），
 * 再在同一事务里写工单的状态与一条状态变更记录。别的代码不写 ticket.status：
 * - lint 只允许本文件引用状态变更记录表（eslint-boundaries.js）；
 * - 数据库在提交时检查工单状态等于它最近一条状态变更记录的目标状态（迁移 0007），绕过本文件直接改状态的写入会被拒绝。
 */

type TicketRow = typeof ticket.$inferSelect;
type NewTicket = Omit<
  typeof ticket.$inferInsert,
  'id' | 'status' | 'closeReason' | 'createdAt' | 'updatedAt' | 'version'
>;

function triggerOf(actor: Actor): TicketTrigger {
  return actor.kind === 'member' ? 'member' : 'system';
}

async function recordChange(
  tx: Tx,
  ticketId: string,
  result: Transition,
  event: TicketEvent,
  actor: Actor,
): Promise<void> {
  await tx.db.insert(statusChange).values({
    ticketId,
    fromStatus: result.from,
    toStatus: result.to,
    event,
    trigger: triggerOf(actor),
    actorId: actor.kind === 'member' ? actor.memberId : null,
    actorName: actor.kind === 'member' ? actor.name : SYSTEM_ACTOR_NAME,
    closeReason: result.closeReason,
    occurredAt: tx.now,
  });
}

/** 新建工单：状态取迁移表「（无）+ 事件」的目标状态，同时写第一条状态变更记录 */
export async function createTicket(
  tx: Tx,
  values: NewTicket,
  event: TicketEvent,
  actor: Actor,
): Promise<TicketRow> {
  const result = transition(null, event, triggerOf(actor));
  const [row] = await tx.db
    .insert(ticket)
    .values({
      ...values,
      status: result.to,
      closeReason: result.closeReason,
      createdAt: tx.now,
      updatedAt: tx.now,
    })
    .returning();
  if (!row) throw new Error('工单创建失败');
  await recordChange(tx, row.id, result, event, actor);
  return row;
}

/**
 * 对一张工单发生一个事件：按迁移表求目标状态（没有这一行抛 IllegalTransitionError，事务回滚）；
 * 状态有变化才写（带乐观锁）并记一条状态变更，没变化（例如追加来信）原样返回。
 * 调用方先在事务里锁住这张工单（SELECT … FOR UPDATE）再调用。
 */
export async function applyTransition(
  tx: Tx,
  current: TicketRow,
  event: TicketEvent,
  actor: Actor,
): Promise<TicketRow> {
  const result = transition(current.status, event, triggerOf(actor));
  if (!result.changed) return current;
  const updated = await updateWithVersion(tx, ticket, current, {
    status: result.to,
    closeReason: result.closeReason,
    updatedAt: tx.now,
  });
  await recordChange(tx, current.id, result, event, actor);
  return updated;
}
