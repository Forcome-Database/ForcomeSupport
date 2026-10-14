import {
  reportRangeDays,
  slaRate,
  type ReportDateRange,
  type ReportPeriod,
  type ReportSlaCounts,
} from './report';

/*
 * P17 三个指标的写法（PRD P17「第一阶段」v2.34，协调者 2026-10-14 决定 Q2、Q4、Q7）：数值、与上一周期的对比、副标题。
 * 画面（web 的 pages/reports）与报表导出（server 的 report/export.ts，v2.35「写法与画面一致」）共用这一份，不各写一套。
 * 文案逐字照原型 K19（web 的 p17-copy.test.ts 读原型核对）。
 */

/** 工单量计的是什么（副标题与导出的说明） */
const VOLUME_WHAT = '客户来信新建或重开';

/** 三张指标（原型 p17_p1_kpis()） */
export const REPORT_KPI = {
  volume: '工单量',
  firstResponse: '首响中位数',
  sla: 'SLA 达标率（亚马逊）',
  /** 工单量的副标题：「近 7 天 · 客户来信新建或重开」，期间随筛选（本月、起止，Q7） */
  volumeSub: (period: string) => `${period} · ${VOLUME_WHAT}`,
  volumeWhat: VOLUME_WHAT,
  firstResponseSub: '来信到首次回复 · 按来信到达归期',
  /** 「未达标 11 封」；店铺为全部且有未归属的未达标来信时「未达标 11 封 · 其中 2 封未归属店铺」（Q4） */
  slaSub: (missed: number) => `未达标 ${missed} 封`,
  slaUnassigned: (count: number) => `其中 ${count} 封未归属店铺`,
  /** 无数据（K4）：数值「—」，副标题「所选范围无数据」 */
  none: '—',
  noData: '所选范围无数据',
} as const;

/** 与上一周期的对比（Q2）：前缀随期间，「持平」，SLA 写「个百分点」 */
export const REPORT_COMPARE = {
  week: '较前 7 天',
  month: '较上月同期',
  days: (n: number) => `较前 ${n} 天`,
  flat: '持平',
  points: '个百分点',
} as const;

/** 对比的颜色：中性、变好（绿）、变差（红） */
export type DeltaTone = 'muted' | 'success' | 'danger';
export interface DeltaWords {
  readonly text: string;
  readonly tone: DeltaTone;
}

type Range = ReportDateRange & { readonly period: ReportPeriod };

/** 对比的前缀：近 7 天「较前 7 天」，本月「较上月同期」，自定义「较前 N 天」 */
export function comparePrefix(range: Range): string {
  if (range.period === '7d') return REPORT_COMPARE.week;
  if (range.period === 'month') return REPORT_COMPARE.month;
  return REPORT_COMPARE.days(reportRangeDays(range));
}

const minutesOf = (ms: number) => Math.round(ms / 60_000);

/** 一段时长（分钟）：不足 1 小时「35m」，其余「2h 14m」「1h 05m」（超过 24 小时照写小时） */
function minutesWords(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** 首响中位数：没有已回复的来信为「—」 */
export function firstResponseWords(ms: number | null): string {
  return ms === null ? REPORT_KPI.none : minutesWords(minutesOf(ms));
}

/** 达标率保留一位小数，整数不写小数（「96.4%」「100%」「50%」）；分母为 0 为「—」 */
export function rateWords(counts: ReportSlaCounts): string {
  const rate = slaRate(counts);
  return rate === null ? REPORT_KPI.none : `${Number(rate.toFixed(1))}%`;
}

const signed = (n: number, body: string) => `${n > 0 ? '+' : '-'}${body}`;

/** 工单量的对比：相对变化取整（「+8%」「-3%」「持平」），一律中性色；上一周期为 0 时不写 */
export function volumeDelta(current: number, prior: number, range: Range): DeltaWords | null {
  if (prior === 0) return null;
  const pct = Math.round(((current - prior) / prior) * 100);
  const body = pct === 0 ? REPORT_COMPARE.flat : signed(pct, `${Math.abs(pct)}%`);
  return { text: `${comparePrefix(range)} ${body}`, tone: 'muted' };
}

/** 首响的对比：差值（「-35m」「+1h 05m」），缩短绿色、变长红色；任一期没有已回复的来信时不写 */
export function firstResponseDelta(
  current: number | null,
  prior: number | null,
  range: Range,
): DeltaWords | null {
  if (current === null || prior === null) return null;
  const diff = minutesOf(current) - minutesOf(prior);
  if (diff === 0) return { text: `${comparePrefix(range)} ${REPORT_COMPARE.flat}`, tone: 'muted' };
  return {
    text: `${comparePrefix(range)} ${signed(diff, minutesWords(Math.abs(diff)))}`,
    tone: diff < 0 ? 'success' : 'danger',
  };
}

/** SLA 的对比：差值「+1.2 个百分点」（保留一位），升高绿色、降低红色；任一期分母为 0 时不写 */
export function slaDelta(
  current: ReportSlaCounts,
  prior: ReportSlaCounts,
  range: Range,
): DeltaWords | null {
  const now = slaRate(current);
  const before = slaRate(prior);
  if (now === null || before === null) return null;
  // 按两期显示出来的值（保留一位）相减，差值与卡上的数对得上
  const shown = (rate: number) => Math.round(rate * 10);
  const diff = (shown(now) - shown(before)) / 10;
  if (diff === 0) return { text: `${comparePrefix(range)} ${REPORT_COMPARE.flat}`, tone: 'muted' };
  return {
    text: `${comparePrefix(range)} ${signed(diff, Math.abs(diff).toFixed(1))} ${REPORT_COMPARE.points}`,
    tone: diff > 0 ? 'success' : 'danger',
  };
}

/** SLA 卡的副标题：「未达标 11 封」，有未归属的未达标来信时「未达标 11 封 · 其中 2 封未归属店铺」（Q4） */
export function slaSubWords(counts: ReportSlaCounts, unassignedMissed: number): string {
  const missed = REPORT_KPI.slaSub(counts.counted - counts.met);
  return unassignedMissed > 0
    ? `${missed} · ${REPORT_KPI.slaUnassigned(unassignedMissed)}`
    : missed;
}

/**
 * 售后成本按责任类型的写法里画面与导出共用的部分（原型 p17_p1_cost()，PRD P17「第一阶段」v2.35）：标签、副标题（即售后成本的口径）、
 * 来源说明
 */
const NOT_FILTERED = '不随时间筛选';
export const REPORT_COST = {
  title: '售后成本按责任类型',
  /** 卡头标签「本月 · 不随时间筛选」 */
  tag: `本月 · ${NOT_FILTERED}`,
  notFiltered: NOT_FILTERED,
  sub: '产品成本 + 运费 + 额外赔偿 + 其他',
  source: '来自登记台账，不含待确认',
} as const;
