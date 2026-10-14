import { slaDueAt, slaResultOf, type SlaResult, type TicketSource } from '@forcome/contracts';
import { and, eq, gt, isNull, lt, min, sql } from 'drizzle-orm';
import type { Tx } from '../core';
import { ticketsChanged } from './changes';
import { ticketMessage } from './schema';

/*
 * 来信的首次回复与 SLA（PRD R-SL-01、R-SL-07、R-SL-08，1.4「未回复来信」「应回复来信」，待办 16），记在 ticket.ticket_message：
 * - 每封来信（不论来源）记首次回复时间：同一工单内它之后的第一封我方回复（不含自动回复）的 internalDate。还没有、也没被标记
 *   无需回复的就是「未回复来信」，决定工单状态（识别到回复后是否转等客户、新来信是否让工单回到待回复）；
 * - 应回复来信（来源为客户）另记 SLA 截止（到达 + 24 小时）与结果：有首次回复按它与截止比（达标 / 未达标），
 *   还没有的为未到期，每分钟的扫描把过了截止的改为未达标，工单关闭时仍未到期的一律计未达标（R-SL-07）。
 *   生产厂、其他供应商的来信不计 SLA，两列为空。被「标记无需回复」的（17，no-reply.ts）为无需回复、不是未回复来信，回复不再改它；
 *   撤销时按 slaResultOf 恢复。
 */

/** 新归并的一封来信的首次回复与 SLA 列（firstReplyAt：工单里已有、晚于它的第一封我方回复，乱序时才有） */
export function inboundSlaColumns(input: {
  readonly source: TicketSource;
  readonly receivedAt: Date;
  readonly firstReplyAt: Date | null;
  readonly now: Date;
}): { firstReplyAt: Date | null; slaDueAt: Date | null; slaResult: SlaResult | null } {
  const { source, receivedAt, firstReplyAt, now } = input;
  if (source !== 'customer') return { firstReplyAt, slaDueAt: null, slaResult: null };
  const dueAt = slaDueAt(receivedAt);
  return { firstReplyAt, slaDueAt: dueAt, slaResult: slaResultOf({ dueAt, firstReplyAt, now }) };
}

/**
 * 工单里晚于某一时刻的第一封我方回复（不含自动回复）的发出时间：晚到的来信若早于已归属的回复，按 internalDate 判为
 * 已被该回复结束计时（R-SL-08 乱序）
 */
export async function firstReplyAfter(tx: Tx, ticketId: string, at: Date): Promise<Date | null> {
  const [row] = await tx.db
    .select({ at: min(ticketMessage.receivedAt) })
    .from(ticketMessage)
    .where(
      and(
        eq(ticketMessage.ticketId, ticketId),
        eq(ticketMessage.direction, 'outbound'),
        eq(ticketMessage.autoReply, false),
        gt(ticketMessage.receivedAt, at),
      ),
    );
  return row?.at ?? null;
}

/**
 * 一封我方回复结束它之前该工单内所有未回复来信的计时（R-SL-08）：在它之前到达、还没有首次回复（或首次回复晚于它，
 * 回复乱序归属时）的来信，首次回复改为它，应回复来信的结果按它与截止重新比（无需回复的不动）。
 * 已关闭的工单同样记（关闭后才同步进来的回信）：第一期只有满 7、14 天的按时关闭，关闭时未回复的早已过截止，重算仍是未达标；
 * 第二期有人工关闭、合并（R-SL-07）后，关闭后才发出、却没过截止的回复会把关闭时记的未达标改成达标，届时要按关闭时刻区分
 */
export async function endTimersBefore(tx: Tx, ticketId: string, replyAt: Date): Promise<void> {
  await tx.db
    .update(ticketMessage)
    .set({
      firstReplyAt: replyAt,
      slaResult: sql`CASE
        WHEN ${ticketMessage.slaResult} IS NULL OR ${ticketMessage.slaResult} = 'not_required'
          THEN ${ticketMessage.slaResult}
        WHEN ${replyAt.toISOString()}::timestamptz <= ${ticketMessage.slaDueAt} THEN 'met'
        ELSE 'missed' END`,
    })
    .where(
      and(
        eq(ticketMessage.ticketId, ticketId),
        eq(ticketMessage.direction, 'inbound'),
        lt(ticketMessage.receivedAt, replyAt),
        sql`(${ticketMessage.firstReplyAt} IS NULL OR ${ticketMessage.firstReplyAt} > ${replyAt.toISOString()}::timestamptz)`,
      ),
    );
}

/** 工单里还有没有未回复来信（1.4：在我方最近一封回复之后到达、且未被标记无需回复的来信，不论来源；被标记的不算，17） */
export async function hasUnrepliedInbound(tx: Tx, ticketId: string): Promise<boolean> {
  const [row] = await tx.db
    .select({ id: ticketMessage.id })
    .from(ticketMessage)
    .where(
      and(
        eq(ticketMessage.ticketId, ticketId),
        eq(ticketMessage.direction, 'inbound'),
        isNull(ticketMessage.firstReplyAt),
        isNull(ticketMessage.noReplyAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** 过了截止仍未回复的应回复来信：未到期 → 未达标（每分钟扫描；截止那一刻仍未到期），返回改了几封 */
export async function markOverdue(tx: Tx, now: Date): Promise<number> {
  const rows = await tx.db
    .update(ticketMessage)
    .set({ slaResult: 'missed' })
    .where(and(eq(ticketMessage.slaResult, 'pending'), lt(ticketMessage.slaDueAt, now)))
    .returning({ id: ticketMessage.id });
  if (rows.length > 0) await ticketsChanged(tx);
  return rows.length;
}

/** 工单关闭时仍未回复的应回复来信计未达标（R-SL-07、AC-TK-13） */
export async function missUnrepliedOnClose(tx: Tx, ticketId: string): Promise<void> {
  await tx.db
    .update(ticketMessage)
    .set({ slaResult: 'missed' })
    .where(and(eq(ticketMessage.ticketId, ticketId), eq(ticketMessage.slaResult, 'pending')));
}
