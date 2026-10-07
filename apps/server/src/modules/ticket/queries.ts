import { type Site, type TicketListItem } from '@forcome/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { storeNamesById } from '../channel';
import { storeScopeCondition, type DbExecutor, type StoreScope } from '../core';
import { customer, ticket, ticketMessage } from './schema';

/*
 * 工单的查询（规格 ticket「查询接口」）：一律带店铺范围（ADR 0010）。待办 08 是 P04 的最简列表；筛选、SLA 列与默认排序的
 * SLA 部分、分页随 18。P05 的工单详情在 detail.ts（17）。
 */

export type TicketRow = typeof ticket.$inferSelect & { customerName: string };

const ticketColumns = {
  id: ticket.id,
  number: ticket.number,
  storeId: ticket.storeId,
  channel: ticket.channel,
  site: ticket.site,
  source: ticket.source,
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

export function toListItem(row: TicketRow, storeNames: Map<string, string>): TicketListItem {
  return {
    id: row.id,
    number: row.number,
    subject: row.subject,
    source: row.source,
    channel: row.channel,
    site: row.site,
    store: { id: row.storeId, name: storeNames.get(row.storeId) ?? '' },
    customer: { name: row.customerName },
    orderNumber: row.orderNumber,
    status: row.status,
    closeReason: row.closeReason,
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

/** 售后单的来源工单要带入的内容（新建登记，待办 19：店铺、站点、订单号、客户） */
export interface TicketReference {
  readonly id: string;
  readonly number: string;
  readonly storeId: string;
  readonly site: Site;
  readonly orderNumber: string | null;
  readonly customerId: string;
  readonly customerName: string;
}

/**
 * 按工单号取来源工单（店铺范围内；新建登记经 access.findOwned 调用，先取出再判断归属，越权记审计）。
 * 工单号不分大小写，按规范写法（T-日期-序号）查。
 */
export async function findTicketReference(
  db: DbExecutor,
  scope: StoreScope,
  number: string,
): Promise<TicketReference | null> {
  const row = await findTicketByNumber(db, scope, number.trim().toUpperCase());
  if (!row) return null;
  return {
    id: row.id,
    number: row.number,
    storeId: row.storeId,
    site: row.site,
    orderNumber: row.orderNumber,
    customerId: row.customerId,
    customerName: row.customerName,
  };
}

/**
 * 来信所在的工单号（P27 来信对象点进它所在工单的 P05，PRD P27「第一阶段」v2.31，待办 17）：来信 id → 工单号，
 * 按查看者的店铺范围；还没归并成工单的（还在未归属队列里）没有
 */
export async function ticketNumbersOfMessages(
  db: DbExecutor,
  scope: StoreScope,
  messageIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({ messageId: ticketMessage.channelMessageId, number: ticket.number })
    .from(ticketMessage)
    .innerJoin(ticket, eq(ticket.id, ticketMessage.ticketId))
    .where(
      and(
        inArray(ticketMessage.channelMessageId, [...messageIds]),
        storeScopeCondition(scope, ticket.storeId),
      ),
    );
  return new Map(rows.map((row) => [row.messageId, row.number]));
}
