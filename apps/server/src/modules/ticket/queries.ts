import { addDays, businessDate, startOfBusinessDate } from '@forcome/calendar';
import {
  slaTargetOf,
  TICKET_PAGE_SIZE,
  ticketDrillChannelMembers,
  ticketDrillOf,
  ticketInboundRange,
  type Site,
  type TicketDrill,
  type TicketList,
  type TicketListItem,
  type TicketListQuery,
} from '@forcome/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import { storeNamesById } from '../channel';
import { storeScopeCondition, type DbExecutor, type StoreScope } from '../core';
import { customer, ticket, ticketMessage } from './schema';
import { customerTriggerEvents } from './ticket-status';

/*
 * 工单的查询（规格 ticket「查询接口」）：一律带店铺范围（ADR 0010）。P04 工单列表（筛选、报表下钻、SLA 剩余、排序与分页，
 * 待办 18）；P05 的工单详情在 detail.ts（17）。
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

/** 默认排序中不看 SLA 的部分（P04「第一阶段」）：待回复 → 等客户 → 已解决 → 已关闭 */
const statusRank = sql`CASE ${ticket.status}
  WHEN 'awaiting_reply' THEN 0 WHEN 'awaiting_customer' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END`;

/** P04 的 SLA 剩余：最早一封未回复的应回复来信的截止与目标（工单不是待回复、或没有这样的来信为空） */
export type PendingSla = TicketListItem['sla'];

export function toListItem(
  row: TicketRow,
  storeNames: Map<string, string>,
  sla: PendingSla,
): TicketListItem {
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
    sla,
  };
}

/**
 * 每张工单最早一封未回复的应回复来信（P04「第一阶段」SLA 列）：来源为客户、没有首次回复、没被标记无需回复的来信里到达最早的
 * （截止都是到达 + 24 小时，最早到达即最早截止）。按工单汇总成子查询（ticketId、dueAt、channel），只在工单待回复时用它
 */
function earliestPendingLetters(db: DbExecutor) {
  return db
    .selectDistinctOn([ticketMessage.ticketId], {
      ticketId: ticketMessage.ticketId,
      dueAt: sql<Date | string>`${ticketMessage.slaDueAt}`.as('pending_due_at'),
      channel: sql<TicketListItem['channel']>`${ticketMessage.channel}`.as('pending_channel'),
    })
    .from(ticketMessage)
    .where(
      and(
        eq(ticketMessage.direction, 'inbound'),
        eq(ticketMessage.source, 'customer'),
        isNull(ticketMessage.firstReplyAt),
        isNull(ticketMessage.noReplyAt),
        isNotNull(ticketMessage.slaDueAt),
      ),
    )
    .orderBy(ticketMessage.ticketId, asc(ticketMessage.receivedAt), asc(ticketMessage.id))
    .as('pending');
}

function pendingSlaOf(
  status: TicketRow['status'],
  dueAt: Date | string | null,
  channel: TicketListItem['channel'] | null,
): PendingSla {
  if (status !== 'awaiting_reply' || dueAt === null || channel === null) return null;
  return { target: slaTargetOf(channel), dueAt: new Date(dueAt).toISOString() };
}

/** 一张工单的 SLA 剩余（P05 详情的工单头与列表同一口径）；row 已按店铺范围取出 */
export async function pendingSla(db: DbExecutor, row: TicketRow): Promise<PendingSla> {
  if (row.status !== 'awaiting_reply') return null;
  const pending = earliestPendingLetters(db);
  const [found] = await db
    .select({ dueAt: pending.dueAt, channel: pending.channel })
    .from(pending)
    .where(eq(pending.ticketId, row.id));
  return found ? pendingSlaOf(row.status, found.dueAt, found.channel) : null;
}

/** 一段北京时间的日期（含两端）→ [起, 止) 的时刻 */
function windowOf(range: { readonly from: string; readonly to: string }) {
  return { start: startOfBusinessDate(range.from), end: startOfBusinessDate(addDays(range.to, 1)) };
}

/**
 * 下钻的子查询（ticketId、count）：按事件计为客户来信触发的新建或重开（ticket-status.ts），按封计为到达的客户来信
 * （首响中位数的「已回复」= 有首次回复，SLA 达标率按 SLA 结果）；渠道看被计数的来信自己的渠道
 */
function drillSubquery(db: DbExecutor, drill: TicketDrill) {
  const window = windowOf(drill.range);
  const channels = drill.channel ? ticketDrillChannelMembers[drill.channel] : null;
  if (drill.kind === 'triggered') return customerTriggerEvents(db, window, channels);
  const letter: Record<NonNullable<TicketDrill['letter']>, SQL> = {
    replied: isNotNull(ticketMessage.firstReplyAt),
    met: eq(ticketMessage.slaResult, 'met'),
    missed: eq(ticketMessage.slaResult, 'missed'),
    pending: eq(ticketMessage.slaResult, 'pending'),
  };
  return db
    .select({
      ticketId: ticketMessage.ticketId,
      count: sql<number>`count(*)::int`.as('drill_count'),
    })
    .from(ticketMessage)
    .where(
      and(
        eq(ticketMessage.direction, 'inbound'),
        eq(ticketMessage.source, 'customer'),
        gte(ticketMessage.receivedAt, window.start),
        lt(ticketMessage.receivedAt, window.end),
        channels ? inArray(ticketMessage.channel, [...channels]) : undefined,
        drill.letter ? letter[drill.letter] : undefined,
      ),
    )
    .groupBy(ticketMessage.ticketId)
    .as('drill');
}

/**
 * P04 工单列表（PRD P04「第一阶段」v2.32）：店铺范围内按筛选（状态、渠道、店铺、站点、来源、最近来信）与报表下钻条件筛出，
 * 排好序取一页。默认排序（SLA 剩余 ↑）：有 SLA 剩余的在前、按截止升序（已超时的截止最早，自然在最前），其后按 待回复 → 等客户 →
 * 已解决 → 已关闭，组内最近来信倒序；SLA 剩余 ↓ 整体反过来。最近来信 ↓ 最新在前。店铺筛选在范围外由接口先把关（E-24）。
 */
export async function listTickets(
  db: DbExecutor,
  scope: StoreScope,
  query: TicketListQuery,
  now: Date,
): Promise<TicketList> {
  const inbound = ticketInboundRange(query, businessDate(now));
  const inboundWindow = windowOf(inbound);
  const drill = ticketDrillOf(query);
  const drillCounts = drill ? drillSubquery(db, drill) : null;
  const pending = earliestPendingLetters(db);

  const where = and(
    storeScopeCondition(scope, ticket.storeId),
    query.status ? eq(ticket.status, query.status) : undefined,
    query.channel ? eq(ticket.channel, query.channel) : undefined,
    query.store ? eq(ticket.storeId, query.store) : undefined,
    query.site ? eq(ticket.site, query.site) : undefined,
    query.source ? eq(ticket.source, query.source) : undefined,
    gte(ticket.lastInboundAt, inboundWindow.start),
    lt(ticket.lastInboundAt, inboundWindow.end),
  );

  const totals = db
    .select({
      total: count(),
      drill: drillCounts
        ? sql<number>`coalesce(sum(${drillCounts.count}), 0)::int`
        : sql<number>`0`,
    })
    .from(ticket)
    .$dynamic();
  if (drillCounts) totals.innerJoin(drillCounts, eq(drillCounts.ticketId, ticket.id));
  const [counted] = await totals.where(where);
  const total = counted?.total ?? 0;

  // SLA 剩余只看待回复的工单
  const dueAt = sql`CASE WHEN ${ticket.status} = 'awaiting_reply' THEN ${pending.dueAt} END`;
  const sort = query.sort ?? 'sla';
  const dir = query.dir ?? (sort === 'sla' ? 'asc' : 'desc');
  const order: SQL[] =
    sort === 'sla'
      ? dir === 'asc'
        ? [
            sql`${dueAt} ASC NULLS LAST`,
            statusRank,
            desc(ticket.lastInboundAt),
            desc(ticket.number),
          ]
        : [
            sql`${dueAt} DESC NULLS FIRST`,
            sql`${statusRank} DESC`,
            asc(ticket.lastInboundAt),
            asc(ticket.number),
          ]
      : dir === 'desc'
        ? [desc(ticket.lastInboundAt), desc(ticket.number)]
        : [asc(ticket.lastInboundAt), asc(ticket.number)];

  const page = query.page ?? 1;
  const rows = db
    .select({ ...ticketColumns, pendingDueAt: pending.dueAt, pendingChannel: pending.channel })
    .from(ticket)
    .innerJoin(customer, eq(customer.id, ticket.customerId))
    .leftJoin(pending, eq(pending.ticketId, ticket.id))
    .$dynamic();
  if (drillCounts) rows.innerJoin(drillCounts, eq(drillCounts.ticketId, ticket.id));
  const found = await rows
    .where(where)
    .orderBy(...order)
    .limit(TICKET_PAGE_SIZE)
    .offset((page - 1) * TICKET_PAGE_SIZE);

  const names = await storeNamesById(
    db,
    found.map((r) => r.storeId),
  );
  return {
    tickets: found.map(({ pendingDueAt, pendingChannel, ...row }) =>
      toListItem(row, names, pendingSlaOf(row.status, pendingDueAt, pendingChannel)),
    ),
    total,
    page,
    pageSize: TICKET_PAGE_SIZE,
    inbound,
    drill: drill
      ? {
          kind: drill.kind,
          events: drill.kind === 'triggered' ? (counted?.drill ?? 0) : null,
          letters: drill.kind === 'arrived' ? (counted?.drill ?? 0) : null,
          tickets: total,
        }
      : null,
    now: now.toISOString(),
  };
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
