import { addDays } from '@forcome/calendar';
import { z } from 'zod';
import { siteSchema } from './channel';
import type { TicketDrillChannel, TicketDrillOrigin, TicketListQuery } from './ticket-list';

/*
 * P17 报表的工单部分（PRD P17「指标口径」「第一阶段」v2.34、K19，待办 24）：筛选（近 7 天 / 本月 / 自定义、店铺、站点，地址栏与接口
 * 同名）、期间与对比的上一周期、接口的输出，以及下钻到 P04 的条件（按 ticket-list.ts 的参数拼，P04 条数与指标一致）。
 * 界面上的写法（对比、首响时长、「更新于」）在前端 pages/reports/p17-words.ts。售后成本卡与导出随待办 25。
 */

// ---------------------------------------------------------------- 筛选

/** 时间（K19）：近 7 天（默认）· 本月 · 自定义（区间日历，不能选今天之后，不设最长；协调者 2026-10-14 决定 Q3） */
export const reportPeriods = ['7d', 'month', 'custom'] as const;
export const reportPeriodSchema = z.enum(reportPeriods);
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;
export const DEFAULT_REPORT_PERIOD: ReportPeriod = '7d';
export const reportPeriodLabels: Record<ReportPeriod, string> = {
  '7d': '近 7 天',
  month: '本月',
  custom: '自定义',
};
/** 近 7 天含今天 */
const WEEK_DAYS = 7;

/** GET /api/reports/tickets 的查询条件（地址栏同名）：时间、店铺、站点。custom 的起止是北京时间的日期（含两端） */
export const reportQuerySchema = z.object({
  period: reportPeriodSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  store: z.uuid().optional(),
  site: siteSchema.optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** 一段日期（北京时间，含两端） */
export const reportDateRangeSchema = z.object({ from: z.iso.date(), to: z.iso.date() });
export type ReportDateRange = z.infer<typeof reportDateRangeSchema>;

/** 两个日期之间相差的天数（to − from） */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 一段日期有几天（含两端） */
export function reportRangeDays(range: ReportDateRange): number {
  return daysBetween(range.from, range.to) + 1;
}

/**
 * 这次按的期间：近 7 天含今天；本月从 1 日到今天；自定义没给的一端取今天，起止颠倒时对调，晚于今天的取今天
 * （不能选今天之后，协调者 2026-10-14 决定 Q3）
 */
export function reportRange(
  query: Pick<ReportQuery, 'period' | 'from' | 'to'>,
  today: string,
): ReportDateRange & { period: ReportPeriod } {
  const period = query.period ?? DEFAULT_REPORT_PERIOD;
  if (period === '7d') return { period, from: addDays(today, -(WEEK_DAYS - 1)), to: today };
  if (period === 'month') return { period, from: `${today.slice(0, 8)}01`, to: today };
  const clamp = (date: string) => (date > today ? today : date);
  const a = clamp(query.from ?? today);
  const b = clamp(query.to ?? today);
  return a <= b ? { period, from: a, to: b } : { period, from: b, to: a };
}

/** 某月有几天（month 为 `YYYY-MM`） */
function daysInMonth(month: string): number {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/**
 * 对比的上一周期（PRD P17「指标口径」）：近 7 天对比之前 7 天，本月对比上月同期（上月 1 日到上月同一天，上月没有这一天取月末），
 * 自定义对比之前等长区间
 */
export function reportPreviousRange(
  range: ReportDateRange & { period: ReportPeriod },
): ReportDateRange {
  if (range.period === 'month') {
    const [year, month] = range.from.split('-').map(Number) as [number, number];
    const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
    const day = Math.min(Number(range.to.slice(8, 10)), daysInMonth(prev));
    return { from: `${prev}-01`, to: `${prev}-${String(day).padStart(2, '0')}` };
  }
  const days = reportRangeDays(range);
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

// ---------------------------------------------------------------- 输出

/** 报表的两组渠道（D-24：亚马逊 / Shopify 与邮件），与 P04 下钻的 drillChannel 同名 */
export const reportChannelGroups = [
  'amazon',
  'shopify_email',
] as const satisfies readonly TicketDrillChannel[];
export type ReportChannelGroup = (typeof reportChannelGroups)[number];

/** 「每日工单量」的一天：两组渠道各自的客户来信触发的新建或重开次数 */
export const reportDaySchema = z.object({
  date: z.iso.date(),
  amazon: z.int().nonnegative(),
  shopify_email: z.int().nonnegative(),
});
export type ReportDay = z.infer<typeof reportDaySchema>;

/** SLA 达标率（亚马逊）的计数：达标数 ÷ 计入数（已回复 + 已超期未回复，未到期与无需回复不计，D-23） */
export const reportSlaCountsSchema = z.object({
  met: z.int().nonnegative(),
  /** 分母：达标 + 未达标 */
  counted: z.int().nonnegative(),
});
export type ReportSlaCounts = z.infer<typeof reportSlaCountsSchema>;

/** 一个期间的三个指标 */
export const reportMetricsSchema = z.object({
  /** 工单量：客户来信触发的新建与重开事件数（按触发来信的到达时间归期） */
  volume: z.int().nonnegative(),
  /** 首响中位数（毫秒）：期间内到达的客户来信到首次回复的时长中位数，只含已回复；没有已回复的为空 */
  firstResponseMs: z.number().nonnegative().nullable(),
  sla: reportSlaCountsSchema,
});
export type ReportMetrics = z.infer<typeof reportMetricsSchema>;

/** GET /api/reports/tickets：P17 的工单部分 */
export const ticketReportSchema = z.object({
  /** 这次按的期间与对比的上一周期 */
  range: reportDateRangeSchema.extend({ period: reportPeriodSchema }),
  previous: reportDateRangeSchema,
  current: reportMetricsSchema,
  /** 上一周期的同一组指标（对比用；没有可比的值时前端不写对比） */
  prior: reportMetricsSchema,
  /**
   * 未达标里有几封是未归属店铺的来信（只在店铺为「全部」且看全部店铺的成员时计入，协调者 2026-10-14 决定 Q4）：
   * 它们没有工单，下钻到 P04 列不出；P04 的封数 = 未达标 − 这几封
   */
  unassignedMissed: z.int().nonnegative(),
  /** 期间内到达的客户来信封数（含计入的未归属来信）：与工单量都为 0 时为无数据（K4，Q5） */
  arrived: z.int().nonnegative(),
  /** 每日工单量：期间内每一天（北京时间）一项，没有事件的天为 0 */
  daily: z.array(reportDaySchema),
  /** 「更新于」：全部已连接的 Gmail 邮箱、亚马逊订单、Shopify 订单中最旧的一次同步成功时间；从没同步成功过为空（AC-P1-11，Q6） */
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Shopify 订单回补的天数：有 Shopify 店铺因没开通 read_all_orders 只回补了 60 天时为该天数，否则为空（标题下的第二条注） */
  shopifyBackfillDays: z.int().positive().nullable(),
  /** 服务端当前时刻（「更新于」与下钻的「今天」按它；开发测试环境 CLOCK_START 时与浏览器时钟不同） */
  now: z.iso.datetime({ offset: true }),
});
export type TicketReport = z.infer<typeof ticketReportSchema>;

/** 本期没有客户来信触发的新建或重开、也没有到达的客户来信：无数据（K4，协调者 2026-10-14 决定 Q5） */
export function isEmptyTicketReport(report: Pick<TicketReport, 'current' | 'arrived'>): boolean {
  return report.current.volume === 0 && report.arrived === 0;
}

/** 达标率（0–100）；分母为 0 时为空 */
export function slaRate(counts: ReportSlaCounts): number | null {
  return counts.counted === 0 ? null : (counts.met / counts.counted) * 100;
}

// ---------------------------------------------------------------- 下钻到 P04

/**
 * 从哪里下钻（PRD P17「指标口径」v2.32）：三个指标、「每日工单量」的柱（某一天）、图例（某一组渠道）与「查看明细」。
 * 出处键即 P04 的 origin
 */
export type ReportDrillTarget =
  | { readonly from: 'metric-volume' | 'metric-first-response' | 'metric-sla' | 'daily-detail' }
  | { readonly from: 'daily-bar'; readonly date: string }
  | { readonly from: 'daily-legend'; readonly channel: ReportChannelGroup };

/** P04 没写最近来信时为近 30 天（含今天） */
const TICKET_DEFAULT_INBOUND_DAYS = 30;

/**
 * 下钻到 P04 的查询条件（与指标同口径，P04 条数与指标一致，AC-P1-14；参数见 ticket-list.ts 的 ticketListQuerySchema）：
 * - 工单量、「每日工单量」的柱 / 图例 / 查看明细：按事件计（triggered）；图例另带渠道；
 * - 首响中位数：客户来信到达 + 已回复；SLA 达标率（亚马逊）：亚马逊来信到达 + 未达标（按封计，arrived）；
 * - 带报表当前的店铺与站点；日期只有一天时只给 drillFrom；
 * - 一并带「最近来信」（协调者 2026-10-14 决定 Q1 补充规则）：下钻起始日不早于近 30 天的起点时不写（P04 默认近 30 天），
 *   更早时带自定义「下钻起始日 至 今天」，否则 P04 默认的最近来信会筛掉下钻对象。
 */
export function reportDrillQuery(
  target: ReportDrillTarget,
  filters: {
    readonly range: ReportDateRange;
    readonly store?: string;
    readonly site?: ReportQuery['site'];
  },
  today: string,
): TicketListQuery {
  const origin: TicketDrillOrigin = target.from;
  const range =
    target.from === 'daily-bar' ? { from: target.date, to: target.date } : filters.range;
  const query: TicketListQuery = {
    drill:
      target.from === 'metric-first-response' || target.from === 'metric-sla'
        ? 'arrived'
        : 'triggered',
    drillFrom: range.from,
    ...(range.to !== range.from ? { drillTo: range.to } : {}),
    ...(target.from === 'metric-first-response' ? { letter: 'replied' as const } : {}),
    ...(target.from === 'metric-sla'
      ? { letter: 'missed' as const, drillChannel: 'amazon' as const }
      : {}),
    ...(target.from === 'daily-legend' ? { drillChannel: target.channel } : {}),
    origin,
    ...(filters.store ? { store: filters.store } : {}),
    ...(filters.site ? { site: filters.site } : {}),
  };
  if (range.from < addDays(today, -(TICKET_DEFAULT_INBOUND_DAYS - 1))) {
    return { ...query, inbound: 'custom', from: range.from, to: today };
  }
  return query;
}
