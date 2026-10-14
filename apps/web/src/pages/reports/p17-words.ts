import {
  relativeTimeWords,
  reportPeriodLabels,
  type ReportDateRange,
  type ReportPeriod,
} from '@forcome/contracts';
import { drillDateWords } from '@/pages/tickets/p04-words';
import { EMPTY, UPDATED } from './p17-copy';

/*
 * P17 拼句子的纯函数（单测 p17-words.test.ts）：期间、首响时长、达标率、与上一周期的对比、「更新于」与无数据的说明。
 * 写法照 PRD P17「第一阶段」v2.34（协调者 2026-10-14 决定 Q2、Q4–Q7）。三个指标的数值与对比在 contracts 的 report-words.ts
 * （报表导出用同一份，待办 25），这里转出。
 */

export {
  comparePrefix,
  firstResponseDelta,
  firstResponseWords,
  rateWords,
  slaDelta,
  slaSubWords,
  volumeDelta,
  type DeltaTone,
  type DeltaWords,
} from '@forcome/contracts';

type Range = ReportDateRange & { readonly period: ReportPeriod };

/** 筛选行的起止：「09-05 至 09-11」（单天「09-10」，不在今年写全年份；同 P04 下钻芯片） */
export function rangeWords(range: ReportDateRange, today: string): string {
  return drillDateWords(range, today);
}

/** 一天：今年的「09-10」，不在今年的写全年份（每日工单量的横轴与悬停） */
export function dayWords(date: string, today: string): string {
  return drillDateWords({ from: date, to: date }, today);
}

/** 副标题里的期间（Q7）：「近 7 天」「本月」（同时间筛选的叫法），自定义写起止 */
export function periodWords(range: Range, today: string): string {
  return range.period === 'custom' ? rangeWords(range, today) : reportPeriodLabels[range.period];
}

/** 「更新于 10:12」：当天写时分，跨天「09-10 10:12」，不在今年带年份；从没同步成功过「更新于 —」（Q6） */
export function updatedWords(at: string | null, now: Date): string {
  return UPDATED.at(at === null ? UPDATED.never : relativeTimeWords(at, now));
}

/** 无数据说明里的范围：店铺名（没选写「全部店铺」），选了站点在后面写「 · US」 */
export function emptyScopeWords(storeName: string | null, site: string | null): string {
  return `${storeName ?? EMPTY.allStores}${site ? ` · ${site}` : ''}`;
}
