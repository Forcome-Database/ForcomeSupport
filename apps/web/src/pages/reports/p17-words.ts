import {
  relativeTimeWords,
  reportRangeDays,
  slaRate,
  type ReportDateRange,
  type ReportPeriod,
  type ReportSlaCounts,
} from '@forcome/contracts';
import { drillDateWords } from '@/pages/tickets/p04-words';
import { COMPARE, EMPTY, KPI, UPDATED } from './p17-copy';

/*
 * P17 拼句子的纯函数（单测 p17-words.test.ts）：期间、首响时长、达标率、与上一周期的对比、「更新于」与无数据的说明。
 * 写法照 PRD P17「第一阶段」v2.34（协调者 2026-10-14 决定 Q2、Q4–Q7）。
 */

/** 对比的颜色：中性、变好（绿）、变差（红），只用设计令牌的次要文字色 / success / destructive */
export type DeltaTone = 'muted' | 'success' | 'danger';
export interface DeltaWords {
  readonly text: string;
  readonly tone: DeltaTone;
}

type Range = ReportDateRange & { readonly period: ReportPeriod };

/** 筛选行的起止：「09-05 至 09-11」（单天「09-10」，不在今年写全年份；同 P04 下钻芯片） */
export function rangeWords(range: ReportDateRange, today: string): string {
  return drillDateWords(range, today);
}

/** 副标题里的期间（Q7）：「近 7 天」「本月」，自定义写起止 */
export function periodWords(range: Range, today: string): string {
  if (range.period === '7d') return COMPARE.weekPeriod;
  if (range.period === 'month') return COMPARE.monthPeriod;
  return rangeWords(range, today);
}

/** 对比的前缀：近 7 天「较前 7 天」，本月「较上月同期」，自定义「较前 N 天」 */
export function comparePrefix(range: Range): string {
  if (range.period === '7d') return COMPARE.week;
  if (range.period === 'month') return COMPARE.month;
  return COMPARE.days(reportRangeDays(range));
}

const minutesOf = (ms: number) => Math.round(ms / 60_000);

/** 一段时长（分钟）：不足 1 小时「35m」，其余「2h 14m」「1h 05m」（超过 24 小时照写小时） */
function minutesWords(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** 首响中位数：没有已回复的来信为「—」 */
export function firstResponseWords(ms: number | null): string {
  return ms === null ? KPI.none : minutesWords(minutesOf(ms));
}

/** 达标率保留一位小数，整数不写小数（「96.4%」「100%」「50%」）；分母为 0 为「—」 */
export function rateWords(counts: ReportSlaCounts): string {
  const rate = slaRate(counts);
  return rate === null ? KPI.none : `${Number(rate.toFixed(1))}%`;
}

const signed = (n: number, body: string) => `${n > 0 ? '+' : '-'}${body}`;

/** 工单量的对比：相对变化取整（「+8%」「-3%」「持平」），一律中性色；上一周期为 0 时不写 */
export function volumeDelta(current: number, prior: number, range: Range): DeltaWords | null {
  if (prior === 0) return null;
  const pct = Math.round(((current - prior) / prior) * 100);
  const body = pct === 0 ? COMPARE.flat : signed(pct, `${Math.abs(pct)}%`);
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
  if (diff === 0) return { text: `${comparePrefix(range)} ${COMPARE.flat}`, tone: 'muted' };
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
  const diff = Math.round((now - before) * 10) / 10;
  if (diff === 0) return { text: `${comparePrefix(range)} ${COMPARE.flat}`, tone: 'muted' };
  return {
    text: `${comparePrefix(range)} ${signed(diff, Math.abs(diff).toFixed(1))} ${COMPARE.points}`,
    tone: diff > 0 ? 'success' : 'danger',
  };
}

/** SLA 卡的副标题：「未达标 11 封」，有未归属的未达标来信时「未达标 11 封 · 其中 2 封未归属店铺」（Q4） */
export function slaSubWords(counts: ReportSlaCounts, unassignedMissed: number): string {
  const missed = KPI.slaSub(counts.counted - counts.met);
  return unassignedMissed > 0 ? `${missed} · ${KPI.slaUnassigned(unassignedMissed)}` : missed;
}

/** 「更新于 10:12」：当天写时分，跨天「09-10 10:12」，不在今年带年份；从没同步成功过「更新于 —」（Q6） */
export function updatedWords(at: string | null, now: Date): string {
  return UPDATED.at(at === null ? UPDATED.never : relativeTimeWords(at, now));
}

/** 无数据说明里的范围：店铺名（没选写「全部店铺」），选了站点在后面写「 · US」 */
export function emptyScopeWords(storeName: string | null, site: string | null): string {
  return `${storeName ?? EMPTY.allStores}${site ? ` · ${site}` : ''}`;
}
