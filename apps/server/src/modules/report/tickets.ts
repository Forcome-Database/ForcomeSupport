import { addDays, BUSINESS_TIME_ZONE, businessDate, startOfBusinessDate } from '@forcome/calendar';
import {
  reportPreviousRange,
  reportRange,
  slaDueAt,
  ticketDrillChannelMembers,
  unassignedSlaTarget,
  type ReportDateRange,
  type ReportDay,
  type ReportMetrics,
  type ReportQuery,
  type TicketReport,
} from '@forcome/contracts';
import { and, count, eq, gte, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { mailboxHealths } from '../channel';
import { message } from '../channel/schema';
import { storeScopeCondition, type Database, type DbTransaction, type StoreScope } from '../core';
import { orderBackfills, orderSyncHealths } from '../order';
import { customerLetter, customerTriggerEvent } from '../ticket/schema';
import { runReportQuery } from './read-only';

/*
 * P17 报表的工单部分（PRD P17「指标口径」「第一阶段」v2.34、K19，待办 24）：工单量、首响中位数、SLA 达标率（亚马逊）及上一周期、
 * 「每日工单量」、「更新于」与 Shopify 回补的注。一律在只读角色下（runReportQuery）直读 ticket 的两个视图：
 * - 工单量与「每日工单量」：customer_trigger_event（客户来信触发的新建与重开，按触发来信的到达时间归期）；
 * - 首响中位数、SLA 达标率：customer_letter（工单里的客户来信，按到达时间归期）。
 * P04 的下钻从同两个视图数（ticket 的 customerTriggerEvents 与 queries.ts），所以报表的数与 P04 的条数一致（AC-P1-14）。
 * 店铺范围与店铺、站点筛选在每个查询上显式施加（视图的 store_id、site；报表绕过了仓储层的编译期保护，ADR 0010）。
 * 未归属店铺的来信（还在 channel.message、店铺为空）计入「全部店铺」口径的 SLA 分母（发件域是亚马逊、过了截止即未达标，
 * contracts 的 unassignedSlaTarget 与 slaDueAt）与「到达的来信」：只在店铺、站点都没选且成员看全部店铺时计入（协调者 2026-10-14
 * 决定 Q4；它们没有站点，选了站点时同样不计）。它们还没有回复，不进首响中位数。
 */

type Window = { readonly start: Date; readonly end: Date };

/** 一段北京时间的日期（含两端）→ [起, 止) 的时刻 */
function windowOf(range: ReportDateRange): Window {
  return { start: startOfBusinessDate(range.from), end: startOfBusinessDate(addDays(range.to, 1)) };
}

/** 视图里的店铺与站点列 */
interface ScopedColumns {
  readonly storeId: typeof customerLetter.storeId | typeof customerTriggerEvent.storeId;
  readonly site: typeof customerLetter.site | typeof customerTriggerEvent.site;
}

/** 店铺范围 + 店铺、站点筛选（每个视图查询都要带） */
function scoped(scope: StoreScope, query: ReportQuery, columns: ScopedColumns): SQL | undefined {
  return and(
    storeScopeCondition(scope, columns.storeId),
    query.store ? eq(columns.storeId, query.store) : undefined,
    query.site ? eq(columns.site, query.site) : undefined,
  );
}

/** 某一时刻在北京时间的日期（SQL，`YYYY-MM-DD`） */
const businessDay = (column: SQL | typeof customerTriggerEvent.receivedAt) =>
  sql<string>`to_char(${column} AT TIME ZONE ${BUSINESS_TIME_ZONE}, 'YYYY-MM-DD')`;

const AMAZON_CHANNELS = [...ticketDrillChannelMembers.amazon];

/** 工单量：期间内客户来信触发的新建与重开事件数 */
async function volumeOf(tx: DbTransaction, where: SQL | undefined, window: Window) {
  const [row] = await tx
    .select({ n: count() })
    .from(customerTriggerEvent)
    .where(
      and(
        where,
        gte(customerTriggerEvent.receivedAt, window.start),
        lt(customerTriggerEvent.receivedAt, window.end),
      ),
    );
  return row?.n ?? 0;
}

/** 期间内到达的客户来信：封数、首响中位数（只含已回复）、亚马逊来信的达标数与计入数（达标 + 未达标） */
async function lettersOf(tx: DbTransaction, where: SQL | undefined, window: Window) {
  const amazon = inArray(customerLetter.channel, AMAZON_CHANNELS);
  const [row] = await tx
    .select({
      arrived: count(),
      median: sql<
        number | null
      >`percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ${customerLetter.firstReplyAt} - ${customerLetter.receivedAt}) * 1000) FILTER (WHERE ${isNotNull(customerLetter.firstReplyAt)})`,
      met: sql<number>`count(*) FILTER (WHERE ${amazon} AND ${customerLetter.slaResult} = 'met')::int`,
      counted: sql<number>`count(*) FILTER (WHERE ${amazon} AND ${customerLetter.slaResult} IN ('met', 'missed'))::int`,
    })
    .from(customerLetter)
    .where(
      and(
        where,
        gte(customerLetter.receivedAt, window.start),
        lt(customerLetter.receivedAt, window.end),
      ),
    );
  return {
    arrived: row?.arrived ?? 0,
    firstResponseMs: row?.median === null || row?.median === undefined ? null : Number(row.median),
    sla: { met: row?.met ?? 0, counted: row?.counted ?? 0 },
  };
}

/** 未归属店铺的客户来信（未归属队列同一组条件，只取来源为客户的）在两段期间里的到达封数与亚马逊未达标封数 */
async function unassignedOf(tx: DbTransaction, windows: readonly Window[], now: Date) {
  const start = windows.reduce((a, w) => (w.start < a ? w.start : a), windows[0]!.start);
  const end = windows.reduce((a, w) => (w.end > a ? w.end : a), windows[0]!.end);
  const rows = await tx
    .select({ fromAddress: message.fromAddress, receivedAt: message.receivedAt })
    .from(message)
    .where(
      and(
        eq(message.direction, 'inbound'),
        isNull(message.storeId),
        isNull(message.duplicateOfId),
        eq(message.source, 'customer'),
        gte(message.receivedAt, start),
        lt(message.receivedAt, end),
      ),
    );
  return windows.map((w) => {
    const inWindow = rows.filter((r) => r.receivedAt >= w.start && r.receivedAt < w.end);
    // 还没有回复：亚马逊的过了截止即未达标，没到截止的不计（D-23）
    const missed = inWindow.filter(
      (r) => unassignedSlaTarget(r.fromAddress) === 'platform' && slaDueAt(r.receivedAt) <= now,
    ).length;
    return { arrived: inWindow.length, missed };
  });
}

/** 每日工单量：期间内每一天两组渠道各自的事件数（没有事件的天为 0） */
async function dailyOf(
  tx: DbTransaction,
  where: SQL | undefined,
  range: ReportDateRange,
): Promise<ReportDay[]> {
  const window = windowOf(range);
  const day = businessDay(customerTriggerEvent.receivedAt);
  const amazon = sql<boolean>`${inArray(customerTriggerEvent.channel, AMAZON_CHANNELS)}`;
  const rows = await tx
    .select({ day, amazon, n: count() })
    .from(customerTriggerEvent)
    .where(
      and(
        where,
        gte(customerTriggerEvent.receivedAt, window.start),
        lt(customerTriggerEvent.receivedAt, window.end),
      ),
    )
    // 按选出的前两列（日期、是否亚马逊）分组：表达式里带参数，GROUP BY 写同一表达式时参数编号不同、数据库认不出是同一列
    .groupBy(sql`1, 2`);
  const days: ReportDay[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    days.push({ date, amazon: 0, shopify_email: 0 });
  }
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const row of rows) {
    const found = byDate.get(row.day);
    if (found) found[row.amazon ? 'amazon' : 'shopify_email'] += row.n;
  }
  return days;
}

/**
 * 「更新于」（AC-P1-11，D-24）：全部已连接的进线邮箱（Gmail 与 163 企业邮箱）、亚马逊订单、Shopify 订单中最旧的一次同步成功时间（从没同步成功过的
 * 不算连接上，不参与；都没有为空）。订单通知队列（SQS）、回补与夜间对账不参与（待办 12、13）。不随店铺筛选变化（Q6）
 */
async function updatedAtOf(tx: DbTransaction): Promise<Date | null> {
  const times = [
    ...(await mailboxHealths(tx)).map((h) => h.lastSuccessAt),
    ...[...(await orderSyncHealths(tx, 'amazon_orders')).values()].map((h) => h.lastSuccessAt),
    ...[...(await orderSyncHealths(tx, 'shopify_orders')).values()].map((h) => h.lastSuccessAt),
  ].filter((at): at is Date => at !== null);
  return times.length === 0 ? null : times.reduce((a, b) => (b < a ? b : a));
}

/** Shopify 订单回补的天数（标题下的第二条注，待办 13）：有店铺没开通 read_all_orders、只回补了 60 天时取最短的，否则为空 */
async function shopifyBackfillDaysOf(tx: DbTransaction): Promise<number | null> {
  const limited = [...(await orderBackfills(tx)).values()].filter((b) => b.historyLimited);
  return limited.length === 0 ? null : Math.min(...limited.map((b) => b.windowDays));
}

/** P17 的工单部分：店铺范围内按期间、店铺、站点算出三个指标与上一周期、每日工单量、「更新于」与回补的注 */
export async function ticketReport(
  db: Database,
  scope: StoreScope,
  query: ReportQuery,
  now: Date,
): Promise<TicketReport> {
  const range = reportRange(query, businessDate(now));
  const previous = reportPreviousRange(range);
  const windows = [windowOf(range), windowOf(previous)] as const;
  const withUnassigned = scope.all && !query.store && !query.site;
  return runReportQuery(db, async (tx) => {
    const events = scoped(scope, query, customerTriggerEvent);
    const letters = scoped(scope, query, customerLetter);
    const unassigned = withUnassigned ? await unassignedOf(tx, windows, now) : null;
    const metrics = async (window: Window, i: 0 | 1) => {
      const found = await lettersOf(tx, letters, window);
      const extra = unassigned?.[i] ?? { arrived: 0, missed: 0 };
      const result: ReportMetrics = {
        volume: await volumeOf(tx, events, window),
        firstResponseMs: found.firstResponseMs,
        sla: { met: found.sla.met, counted: found.sla.counted + extra.missed },
      };
      return { result, arrived: found.arrived + extra.arrived };
    };
    const current = await metrics(windows[0], 0);
    const prior = await metrics(windows[1], 1);
    const updatedAt = await updatedAtOf(tx);
    return {
      range,
      previous,
      current: current.result,
      prior: prior.result,
      unassignedMissed: unassigned?.[0]?.missed ?? 0,
      arrived: current.arrived,
      daily: await dailyOf(tx, events, range),
      updatedAt: updatedAt?.toISOString() ?? null,
      shopifyBackfillDays: await shopifyBackfillDaysOf(tx),
      now: now.toISOString(),
    };
  });
}
