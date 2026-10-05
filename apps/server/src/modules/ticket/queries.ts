import type { TicketDetail, TicketListItem, TicketMessage } from '@forcome/contracts';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { listMessageSummaries, storeNamesById } from '../channel';
import { storeScopeCondition, type DbExecutor, type StoreScope } from '../core';
import { customer, ticket, ticketMessage } from './schema';

/*
 * 工单的查询（规格 ticket「查询接口」）：一律带店铺范围（ADR 0010）。待办 08 是 P04 的最简列表与工单的消息；
 * 筛选、SLA 列与默认排序的 SLA 部分、分页随 18，P05 的全程记录、SLA 结果、状态流转与订单卡随 17。
 */

type TicketRow = typeof ticket.$inferSelect & { customerName: string };

const ticketColumns = {
  id: ticket.id,
  number: ticket.number,
  storeId: ticket.storeId,
  channel: ticket.channel,
  site: ticket.site,
  customerId: ticket.customerId,
  subject: ticket.subject,
  orderNumber: ticket.orderNumber,
  status: ticket.status,
  closeReason: ticket.closeReason,
  firstInboundAt: ticket.firstInboundAt,
  lastInboundAt: ticket.lastInboundAt,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
  version: ticket.version,
  customerName: customer.name,
};

/** 默认排序中不看 SLA 的部分（P04「第一阶段」）：待回复 → 等客户 → 已解决 → 已关闭，组内最近来信倒序 */
const statusRank = sql`CASE ${ticket.status}
  WHEN 'awaiting_reply' THEN 0 WHEN 'awaiting_customer' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END`;

function toListItem(row: TicketRow, storeNames: Map<string, string>): TicketListItem {
  return {
    id: row.id,
    number: row.number,
    subject: row.subject,
    channel: row.channel,
    site: row.site,
    store: { id: row.storeId, name: storeNames.get(row.storeId) ?? '' },
    customer: { name: row.customerName },
    status: row.status,
    lastInboundAt: row.lastInboundAt.toISOString(),
  };
}

/** P04 工单列表（店铺范围内） */
export async function listTickets(db: DbExecutor, scope: StoreScope): Promise<TicketListItem[]> {
  const rows = await db
    .select(ticketColumns)
    .from(ticket)
    .innerJoin(customer, eq(customer.id, ticket.customerId))
    .where(storeScopeCondition(scope, ticket.storeId))
    .orderBy(statusRank, desc(ticket.lastInboundAt), desc(ticket.number));
  const names = await storeNamesById(
    db,
    rows.map((r) => r.storeId),
  );
  return rows.map((row) => toListItem(row, names));
}

/** 按工单号取工单（店铺范围内；详情接口经 access.findOwned 调用，先取出再判断归属） */
export async function findTicketByNumber(
  db: DbExecutor,
  scope: StoreScope,
  number: string,
): Promise<TicketRow | null> {
  const [row] = await db
    .select(ticketColumns)
    .from(ticket)
    .innerJoin(customer, eq(customer.id, ticket.customerId))
    .where(and(eq(ticket.number, number), storeScopeCondition(scope, ticket.storeId)))
    .limit(1);
  return row ?? null;
}

/** 工单与它的消息（按到达时间先后）；row 已按店铺范围取出 */
export async function ticketDetail(
  db: DbExecutor,
  scope: StoreScope,
  row: TicketRow,
): Promise<TicketDetail> {
  const links = await db
    .select({ channelMessageId: ticketMessage.channelMessageId })
    .from(ticketMessage)
    .where(eq(ticketMessage.ticketId, row.id))
    .orderBy(asc(ticketMessage.receivedAt), asc(ticketMessage.createdAt));
  const summaries = await listMessageSummaries(
    db,
    scope,
    links.map((l) => l.channelMessageId),
  );
  const byId = new Map(summaries.map((s) => [s.id, s]));
  const messages: TicketMessage[] = links.map((link) => {
    const s = byId.get(link.channelMessageId);
    // 工单里的消息与工单同一个店铺（归并时取的就是来信识别出的店铺；15 指定店铺时一并回填来信的店铺），
    // 读不到说明数据不一致：报错，不悄悄少给几封
    if (!s) {
      throw new Error(`工单 ${row.number} 的消息 ${link.channelMessageId} 在当前店铺范围里读不到`);
    }
    return {
      id: s.id,
      direction: s.direction,
      mailbox: s.mailbox,
      from: { name: s.fromName, address: s.fromAddress },
      subject: s.subject,
      arrivedAt: s.receivedAt.toISOString(),
      alsoSentTo: [...s.alsoSentTo],
    };
  });
  const names = await storeNamesById(db, [row.storeId]);
  return { ticket: toListItem(row, names), messages };
}
