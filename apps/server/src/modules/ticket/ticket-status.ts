import {
  SYSTEM_ACTOR_NAME,
  type TicketChannel,
  type TicketEvent,
  type TicketTrigger,
} from '@forcome/contracts';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { updateWithVersion, type Actor, type DbExecutor, type Tx } from '../core';
import { ticketsChanged } from './changes';
import { transition, type Transition } from './lifecycle';
import { customerTriggerEvent, statusChange, ticket } from './schema';

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

/**
 * 引起这次迁移的消息（channel.message 的 id）：新建、追加、重开为触发的来信，识别到回复为那封我方回复；按时关闭与成员的动作没有。
 * 工单量只计由客户来信触发的新建与重开，按它找来信的来源（待办 16 记录，24 统计）
 */
export interface TransitionCause {
  readonly messageId?: string;
}

async function recordChange(
  tx: Tx,
  ticketId: string,
  result: Transition,
  event: TicketEvent,
  actor: Actor,
  cause: TransitionCause,
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
    channelMessageId: cause.messageId ?? null,
    occurredAt: tx.now,
  });
  await ticketsChanged(tx);
}

/** 新建工单：状态取迁移表「（无）+ 事件」的目标状态，同时写第一条状态变更记录 */
export async function createTicket(
  tx: Tx,
  values: NewTicket,
  event: TicketEvent,
  actor: Actor,
  cause: TransitionCause = {},
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
  await recordChange(tx, row.id, result, event, actor, cause);
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
  cause: TransitionCause = {},
): Promise<TicketRow> {
  const result = transition(current.status, event, triggerOf(actor));
  if (!result.changed) return current;
  const updated = await updateWithVersion(tx, ticket, current, {
    status: result.to,
    closeReason: result.closeReason,
    updatedAt: tx.now,
  });
  await recordChange(tx, current.id, result, event, actor, cause);
  return updated;
}

/**
 * 几张已关闭工单的关闭时刻（R-TK-01「30 天内关闭」的判断，待办 14）：已关闭的工单最近一条状态变更就是迁到已关闭的那一条
 * （数据库守卫保证状态等于最近一条的目标状态；「最近」同守卫按写入先后，即 UUIDv7 主键），取它的发生时刻。
 * 给的工单不是已关闭的抛错（调用方判断错了）。
 */
export async function closedTimes(
  tx: Tx,
  closed: readonly TicketRow[],
): Promise<Map<string, Date>> {
  if (closed.length === 0) return new Map();
  const rows = await tx.db
    .selectDistinctOn([statusChange.ticketId], {
      ticketId: statusChange.ticketId,
      toStatus: statusChange.toStatus,
      occurredAt: statusChange.occurredAt,
    })
    .from(statusChange)
    .where(
      inArray(
        statusChange.ticketId,
        closed.map((row) => row.id),
      ),
    )
    .orderBy(statusChange.ticketId, desc(statusChange.id));
  const times = new Map<string, Date>();
  for (const row of rows) {
    if (row.toStatus !== 'closed') {
      throw new Error(`工单 ${row.ticketId} 最近一次迁移不是关闭，没有关闭时刻`);
    }
    times.set(row.ticketId, row.occurredAt);
  }
  return times;
}

/** 一张工单的状态变更记录（P05 的状态流转与事件行，17），按写入先后（UUIDv7 主键，同数据库守卫的「最近」） */
export async function listStatusChanges(db: DbExecutor, ticketId: string) {
  return db
    .select({
      id: statusChange.id,
      fromStatus: statusChange.fromStatus,
      toStatus: statusChange.toStatus,
      event: statusChange.event,
      trigger: statusChange.trigger,
      actorName: statusChange.actorName,
      closeReason: statusChange.closeReason,
      channelMessageId: statusChange.channelMessageId,
      occurredAt: statusChange.occurredAt,
    })
    .from(statusChange)
    .where(eq(statusChange.ticketId, ticketId))
    .orderBy(asc(statusChange.id));
}

/**
 * 客户来信触发的新建与重开（工单量的事件，PRD P17「指标口径」、D-24；P04 按事件下钻，待办 18）：从视图 customer_trigger_event
 * （schema.ts，迁移 0031）数——新建（从「无」迁出的 inbound）与重开（inbound_reopen）、触发来信来源为客户，归期按业务时刻（触发那封来信的
 * 到达时间，ADR 0008「待办 18 落地」修订），渠道看触发那封来信自己的渠道。报表（report，待办 24）的工单量与「每日工单量」的柱从同一个
 * 视图数（AC-P1-14）。按工单汇总成子查询（ticketId、count），由列表查询连接，店铺范围与其余筛选在那边施加
 */
export function customerTriggerEvents(
  db: DbExecutor,
  window: { readonly start: Date; readonly end: Date },
  channels: readonly TicketChannel[] | null,
) {
  return db
    .select({
      ticketId: customerTriggerEvent.ticketId,
      count: sql<number>`count(*)::int`.as('drill_count'),
    })
    .from(customerTriggerEvent)
    .where(
      and(
        gte(customerTriggerEvent.receivedAt, window.start),
        lt(customerTriggerEvent.receivedAt, window.end),
        channels ? inArray(customerTriggerEvent.channel, [...channels]) : undefined,
      ),
    )
    .groupBy(customerTriggerEvent.ticketId)
    .as('drill');
}

/**
 * 清掉全部状态变更记录：只给非生产环境的「重放来信」用（reset.ts 随后删掉全部工单）。状态变更记录只由本文件写，
 * 删除也放在这里。
 */
export async function clearStatusChanges(tx: Tx): Promise<void> {
  await tx.db.delete(statusChange);
}
