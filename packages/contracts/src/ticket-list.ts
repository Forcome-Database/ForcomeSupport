import { addDays } from '@forcome/calendar';
import { z } from 'zod';
import { siteSchema } from './channel';
import {
  ticketChannelSchema,
  ticketListItemSchema,
  ticketSourceSchema,
  ticketStatusSchema,
  type TicketChannel,
} from './ticket';

/*
 * P04 工单列表的查询（PRD P04「第一阶段」v2.32、P17「指标口径」，待办 18）：筛选、只走地址栏的报表下钻参数、排序与分页，
 * 以及接口的输出。地址栏与接口用同一组参数名（页面把地址栏的条件原样交给接口），报表（待办 24）按这里的参数拼下钻链接。
 * 界面上的写法（芯片、计数行）在前端 pages/tickets/p04-words.ts。
 */

// ---------------------------------------------------------------- 筛选

/** 最近来信（协调者 2026-10-14 决定 Q1）：今天 · 近 7 天 · 近 30 天（默认）· 近 90 天 · 自定义；不设「全部」 */
export const ticketInboundPeriods = ['today', '7d', '30d', '90d', 'custom'] as const;
export const ticketInboundPeriodSchema = z.enum(ticketInboundPeriods);
export type TicketInboundPeriod = z.infer<typeof ticketInboundPeriodSchema>;
export const DEFAULT_TICKET_INBOUND_PERIOD: TicketInboundPeriod = '30d';
export const ticketInboundPeriodLabels: Record<TicketInboundPeriod, string> = {
  today: '今天',
  '7d': '近 7 天',
  '30d': '近 30 天',
  '90d': '近 90 天',
  custom: '自定义',
};
/** 「近 N 天」含今天 */
const PERIOD_DAYS: Record<Exclude<TicketInboundPeriod, 'custom'>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

// ---------------------------------------------------------------- 报表下钻（只走地址栏，P04 以「来自报表」芯片显示）

/**
 * 下钻按什么计（PRD P17「指标口径」）：
 * - triggered：客户来信触发的新建或重开（工单量、每日工单量）——按事件计，列出这些事件的工单；归期按状态变更的发生时刻
 * - arrived：客户来信到达（首响中位数、SLA 达标率）——按封计，列出含这些来信的工单；归期按来信的到达时间
 */
export const ticketDrillKinds = ['triggered', 'arrived'] as const;
export const ticketDrillKindSchema = z.enum(ticketDrillKinds);
export type TicketDrillKind = z.infer<typeof ticketDrillKindSchema>;

/**
 * 按封计时来信的状态（规格 ticket「查询接口」）：已回复（有首次回复，首响中位数）或 SLA 结果 达标 / 未达标 / 未到期
 * （P17 只带未达标，其余照样接受）
 */
export const ticketDrillLetterStates = ['replied', 'met', 'missed', 'pending'] as const;
export const ticketDrillLetterStateSchema = z.enum(ticketDrillLetterStates);
export type TicketDrillLetterState = z.infer<typeof ticketDrillLetterStateSchema>;

/**
 * 下钻带的渠道（报表的图例只有两组：亚马逊、Shopify 与邮件）：看被计数的那封来信自己的渠道（触发事件的来信或到达的来信），
 * 不看工单的渠道——与指标同口径
 */
export const ticketDrillChannels = ['amazon', 'shopify_email'] as const;
export const ticketDrillChannelSchema = z.enum(ticketDrillChannels);
export type TicketDrillChannel = z.infer<typeof ticketDrillChannelSchema>;
export const ticketDrillChannelMembers: Record<TicketDrillChannel, readonly TicketChannel[]> = {
  amazon: ['amazon'],
  shopify_email: ['shopify', 'email'],
};

/** 下钻的出处（计数行「条件与报表…同口径」，协调者 2026-10-14 决定 Q3：地址栏只带枚举键，文字由前端映射） */
export const ticketDrillOrigins = [
  'daily-bar',
  'daily-legend',
  'daily-detail',
  'metric-volume',
  'metric-first-response',
  'metric-sla',
] as const;
export const ticketDrillOriginSchema = z.enum(ticketDrillOrigins);
export type TicketDrillOrigin = z.infer<typeof ticketDrillOriginSchema>;

// ---------------------------------------------------------------- 排序与分页

/** 可排序的表头（Q2）：SLA 剩余（默认，↑ 为 PRD 的默认排序，↓ 整体反过来）与最近来信 */
export const ticketListSorts = ['sla', 'last_inbound'] as const;
export const ticketListSortSchema = z.enum(ticketListSorts);
export type TicketListSort = z.infer<typeof ticketListSortSchema>;
export const sortDirections = ['asc', 'desc'] as const;
export const sortDirectionSchema = z.enum(sortDirections);
export type SortDirection = z.infer<typeof sortDirectionSchema>;
/** 点了还没排序的表头时的方向：SLA 剩余 ↑，最近来信 ↓（最新在前） */
export const ticketListSortDefaults: Record<TicketListSort, SortDirection> = {
  sla: 'asc',
  last_inbound: 'desc',
};

/** 每页条数（原型「共 16 条 · 每页 20 条」） */
export const TICKET_PAGE_SIZE = 20;

// ---------------------------------------------------------------- 查询条件

/**
 * GET /api/tickets 的查询条件（地址栏同名）。没写最近来信为近 30 天；custom 的起止是北京时间的日期（含两端）。
 * 下钻：drill 给出按什么计，drillFrom / drillTo 是归期（含两端，只给起时为单天），letter 只用于按封计，
 * drillChannel 是被计数来信的渠道，origin 是出处。排序没写为 SLA 剩余 ↑。
 */
export const ticketListQuerySchema = z.object({
  status: ticketStatusSchema.optional(),
  channel: ticketChannelSchema.optional(),
  store: z.uuid().optional(),
  site: siteSchema.optional(),
  source: ticketSourceSchema.optional(),
  inbound: ticketInboundPeriodSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  drill: ticketDrillKindSchema.optional(),
  drillFrom: z.iso.date().optional(),
  drillTo: z.iso.date().optional(),
  letter: ticketDrillLetterStateSchema.optional(),
  drillChannel: ticketDrillChannelSchema.optional(),
  origin: ticketDrillOriginSchema.optional(),
  sort: ticketListSortSchema.optional(),
  dir: sortDirectionSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
});
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;

/** 一段日期（北京时间，含两端） */
export const ticketDateRangeSchema = z.object({ from: z.iso.date(), to: z.iso.date() });
export type TicketDateRange = z.infer<typeof ticketDateRangeSchema>;

/** 起止颠倒时对调 */
function ordered(from: string, to: string): TicketDateRange {
  return from <= to ? { from, to } : { from: to, to: from };
}

/** 这次按的最近来信：哪一种与起止（含两端）。近 N 天含今天；自定义没给的一端取今天 */
export function ticketInboundRange(
  query: Pick<TicketListQuery, 'inbound' | 'from' | 'to'>,
  today: string,
): TicketDateRange & { period: TicketInboundPeriod } {
  const period = query.inbound ?? DEFAULT_TICKET_INBOUND_PERIOD;
  if (period === 'custom') return { period, ...ordered(query.from ?? today, query.to ?? today) };
  return { period, from: addDays(today, -(PERIOD_DAYS[period] - 1)), to: today };
}

/** 下钻条件：没有 drill 或没有起始日时不下钻（地址栏手写缺了起始日的当作没有下钻） */
export interface TicketDrill {
  readonly kind: TicketDrillKind;
  readonly range: TicketDateRange;
  /** 只用于按封计 */
  readonly letter: TicketDrillLetterState | null;
  readonly channel: TicketDrillChannel | null;
  readonly origin: TicketDrillOrigin | null;
}

export function ticketDrillOf(
  query: Pick<
    TicketListQuery,
    'drill' | 'drillFrom' | 'drillTo' | 'letter' | 'drillChannel' | 'origin'
  >,
): TicketDrill | null {
  if (!query.drill || !query.drillFrom) return null;
  return {
    kind: query.drill,
    range: ordered(query.drillFrom, query.drillTo ?? query.drillFrom),
    letter: query.drill === 'arrived' ? (query.letter ?? null) : null,
    channel: query.drillChannel ?? null,
    origin: query.origin ?? null,
  };
}

// ---------------------------------------------------------------- 输出

/**
 * 下钻的数量（计数行）：按事件计时 events 为客户来信触发的新建或重开次数，按封计时 letters 为来信封数；tickets 为列出的工单数
 * （与 total 相同）。都已按店铺范围与其余筛选过滤
 */
export const ticketDrillCountsSchema = z.object({
  kind: ticketDrillKindSchema,
  events: z.int().nullable(),
  letters: z.int().nullable(),
  tickets: z.int(),
});
export type TicketDrillCounts = z.infer<typeof ticketDrillCountsSchema>;

/** GET /api/tickets：店铺范围内按条件筛出的一页工单，另带总条数、这次按的最近来信、下钻的数量与服务端当前时刻 */
export const ticketListSchema = z.object({
  tickets: z.array(ticketListItemSchema),
  total: z.int(),
  page: z.int(),
  pageSize: z.int(),
  inbound: ticketDateRangeSchema.extend({ period: ticketInboundPeriodSchema }),
  drill: ticketDrillCountsSchema.nullable(),
  /** 服务端当前时刻（SLA 剩余、「最近来信」当天只写时分都按它，开发测试环境 CLOCK_START 时与浏览器时钟不同） */
  now: z.iso.datetime({ offset: true }),
});
export type TicketList = z.infer<typeof ticketListSchema>;
