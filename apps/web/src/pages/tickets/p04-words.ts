import {
  dateRangeWords,
  DEFAULT_TICKET_INBOUND_PERIOD,
  messageSourceLabels,
  ticketChannelLabels,
  ticketInboundPeriodLabels,
  ticketStatusLabels,
  type TicketDateRange,
  type TicketDrill,
  type TicketDrillCounts,
  type TicketInboundPeriod,
} from '@forcome/contracts';
import type { FilterOption } from '@/components/filter-chip';
import { DRILL, EMPTY, FILTERS } from './p04-copy';
import type { TicketsSearch } from './tickets-search';

/*
 * P04 拼句子的纯函数（单测 p04-words.test.ts）：「来自报表」芯片、计数行、最近来信芯片的值与列表为空时的「当前筛选」。
 * 下钻的写法照 PRD P04「第一阶段」v2.32（协调者 2026-10-14 决定 Q3）。
 */

/** 一个日期：在今年的写「09-10」，不在今年的写全年份（同 P27） */
function dayWords(date: string, today: string): string {
  return date.startsWith(today.slice(0, 4)) ? date.slice(5) : date;
}

/** 下钻的日期：单天「09-10」，区间「09-04 至 09-10」 */
export function drillDateWords(range: TicketDateRange, today: string): string {
  const from = dayWords(range.from, today);
  return range.from === range.to ? from : DRILL.range(from, dayWords(range.to, today));
}

/** 按封计时被计数的来信：带渠道时「亚马逊来信」「Shopify 与邮件来信」，否则「客户来信」 */
function letterWords(drill: TicketDrill): string {
  return drill.channel ? DRILL.letterOf(DRILL.channels[drill.channel]) : DRILL.customerLetter;
}

/**
 * 「来自报表」芯片的条件：工单量类「09-10 新建或重开 · 客户来信」（图例带渠道时末尾加「 · 亚马逊」）；
 * 首响、SLA 类「09-10 到达 · 客户来信 · 已回复」「09-04 至 09-10 到达 · 亚马逊来信 · 未达标」
 */
export function drillChipWords(drill: TicketDrill, today: string): string {
  const date = drillDateWords(drill.range, today);
  if (drill.kind === 'triggered') {
    const parts = [`${date} ${DRILL.triggered}`, DRILL.customerLetter];
    if (drill.channel) parts.push(DRILL.channels[drill.channel]);
    return parts.join(' · ');
  }
  const parts = [`${date} ${DRILL.arrived}`, letterWords(drill)];
  if (drill.letter) parts.push(DRILL.letterStates[drill.letter]);
  return parts.join(' · ');
}

/** 计数行左侧：「共 73 条」「共 75 次新建或重开 · 73 张工单」「共 11 封来信 · 9 张工单」 */
export function drillCountWords(counts: TicketDrillCounts): string {
  if (counts.kind === 'arrived') return DRILL.lettersCount(counts.letters ?? 0, counts.tickets);
  const events = counts.events ?? 0;
  return events === counts.tickets
    ? DRILL.count(counts.tickets)
    : DRILL.eventsCount(events, counts.tickets);
}

/** 计数行的条件：「客户来信触发的新建或重开 09-10」「亚马逊来信到达 09-04 至 09-10 · 未达标」 */
function drillConditionWords(drill: TicketDrill, today: string): string {
  const date = drillDateWords(drill.range, today);
  if (drill.kind === 'triggered') {
    const parts = [`${DRILL.triggeredCondition} ${date}`];
    if (drill.channel) parts.push(DRILL.channels[drill.channel]);
    return parts.join(' · ');
  }
  const parts = [`${letterWords(drill)}${DRILL.arrived} ${date}`];
  if (drill.letter) parts.push(DRILL.letterStates[drill.letter]);
  return parts.join(' · ');
}

/** 出处：地址栏的枚举键 → 文字；没有出处为空串（「条件与报表同口径：…」） */
function drillOriginWords(drill: TicketDrill, today: string): string {
  switch (drill.origin) {
    case 'daily-bar':
      return DRILL.origins.dailyBar(dayWords(drill.range.from, today));
    case 'daily-legend':
      return drill.channel
        ? DRILL.origins.dailyLegend(DRILL.channels[drill.channel])
        : DRILL.origins.daily;
    case 'daily-detail':
      return DRILL.origins.daily;
    case 'metric-volume':
      return DRILL.origins.volume;
    case 'metric-first-response':
      return DRILL.origins.firstResponse;
    case 'metric-sla':
      return DRILL.origins.sla;
    case null:
      return '';
  }
}

/** 计数行的说明：「条件与报表「每日工单量」09-10 的柱同口径：客户来信触发的新建或重开 09-10」 */
export function drillNoteWords(drill: TicketDrill, today: string): string {
  return DRILL.note(drillOriginWords(drill, today), drillConditionWords(drill, today));
}

/** 最近来信芯片的值：几种「近 N 天」照叫法，自定义写起止（同 P27、P13 的区间写法） */
export function inboundWords(period: TicketInboundPeriod, range: TicketDateRange | null): string {
  if (period === 'custom' && range) return dateRangeWords(range.from, range.to);
  return ticketInboundPeriodLabels[period];
}

/**
 * 列表为空时「当前筛选：…」的各项（I10 的写法「状态 转人工 · 店铺 forcome.mx」）：照筛选行的顺序，来自报表在最前，
 * 最近来信总写（近 30 天也是条件）
 */
export function filterSummary(
  search: TicketsSearch,
  inbound: TicketDateRange | null,
  stores: readonly FilterOption[],
  drill: TicketDrill | null,
  today: string,
): string[] {
  const storeName = stores.find((option) => option.value === search.store)?.label;
  const parts: [string, string | undefined][] = [
    [DRILL.chip, drill ? drillChipWords(drill, today) : undefined],
    [FILTERS.status, search.status && ticketStatusLabels[search.status]],
    [FILTERS.channel, search.channel && ticketChannelLabels[search.channel]],
    [FILTERS.store, storeName],
    [FILTERS.site, search.site],
    [FILTERS.source, search.source && messageSourceLabels[search.source]],
    [FILTERS.inbound, inboundWords(search.inbound ?? DEFAULT_TICKET_INBOUND_PERIOD, inbound)],
  ];
  return parts.flatMap(([label, value]) => (value ? [EMPTY.filter(label, value)] : []));
}
