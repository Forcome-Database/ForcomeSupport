import {
  DEFAULT_TICKET_INBOUND_PERIOD,
  siteSchema,
  sortDirectionSchema,
  ticketChannelSchema,
  ticketDrillChannelSchema,
  ticketDrillKindSchema,
  ticketDrillLetterStateSchema,
  ticketDrillOf,
  ticketDrillOriginSchema,
  ticketInboundPeriodSchema,
  ticketListSortDefaults,
  ticketListSortSchema,
  ticketSourceSchema,
  ticketStatusSchema,
  type TicketListQuery,
  type TicketListSort,
} from '@forcome/contracts';
import { z } from 'zod';

/**
 * P04 地址栏里的条件（TanStack Router 按它校验，ADR 0007；PRD P04「第一阶段」「条件与排序写在地址栏」）：
 * - view=unassigned 打开未归属店铺队列（只对客服主管有效，待办 15）；
 * - 筛选：状态、渠道、店铺、站点、来源、最近来信（inbound，没写为近 30 天；custom 带起止 from / to）；
 * - 只走地址栏的报表下钻（drill、drillFrom、drillTo、letter、drillChannel、origin，参数名与接口相同，contracts 的 ticket-list.ts）；
 * - 排序（sort、dir；没写为 SLA 剩余 ↑）与页码（1 不写）。
 * 写错的条件丢掉。
 */
export const ticketsSearchSchema = z.object({
  view: z.literal('unassigned').optional().catch(undefined),
  status: ticketStatusSchema.optional().catch(undefined),
  channel: ticketChannelSchema.optional().catch(undefined),
  store: z.uuid().optional().catch(undefined),
  site: siteSchema.optional().catch(undefined),
  source: ticketSourceSchema.optional().catch(undefined),
  inbound: ticketInboundPeriodSchema.optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  drill: ticketDrillKindSchema.optional().catch(undefined),
  drillFrom: z.iso.date().optional().catch(undefined),
  drillTo: z.iso.date().optional().catch(undefined),
  letter: ticketDrillLetterStateSchema.optional().catch(undefined),
  drillChannel: ticketDrillChannelSchema.optional().catch(undefined),
  origin: ticketDrillOriginSchema.optional().catch(undefined),
  sort: ticketListSortSchema.optional().catch(undefined),
  dir: sortDirectionSchema.optional().catch(undefined),
  page: z.coerce.number().int().min(2).optional().catch(undefined),
});
export type TicketsSearch = z.infer<typeof ticketsSearchSchema>;

/** 筛选行里的单选条件 */
export const choiceFilters = ['status', 'channel', 'store', 'site', 'source'] as const;
export type ChoiceFilter = (typeof choiceFilters)[number];

const DRILL_KEYS = ['drill', 'drillFrom', 'drillTo', 'letter', 'drillChannel', 'origin'] as const;

/** 交给接口的查询条件：地址栏的条件去掉页面视图；最近来信不是自定义时不带起止 */
export function ticketQueryOf(search: TicketsSearch): TicketListQuery {
  const { view: _view, from, to, ...rest } = search;
  return rest.inbound === 'custom' ? { ...rest, from, to } : rest;
}

/** 有没有报表下钻（与后端同一个 ticketDrillOf：要有 drill 与起始日） */
export function hasDrill(search: TicketsSearch): boolean {
  return ticketDrillOf(search) !== null;
}

/** 条件是否就是默认（最近来信近 30 天、其余都没选、没有下钻）：是的话不出「清除筛选」 */
export function isDefaultSearch(search: TicketsSearch): boolean {
  return (
    choiceFilters.every((key) => search[key] === undefined) &&
    (search.inbound ?? DEFAULT_TICKET_INBOUND_PERIOD) === DEFAULT_TICKET_INBOUND_PERIOD &&
    !hasDrill(search)
  );
}

/** 改了筛选条件：回到第一页 */
export function withFilter(search: TicketsSearch, next: Partial<TicketsSearch>): TicketsSearch {
  return { ...search, ...next, page: undefined };
}

/** 清除筛选：筛选与下钻都回到默认，排序保留 */
export function clearedSearch(search: TicketsSearch): TicketsSearch {
  return { sort: search.sort, dir: search.dir };
}

/** 移除「来自报表」芯片：只去掉下钻条件 */
export function withoutDrill(search: TicketsSearch): TicketsSearch {
  const next: TicketsSearch = { ...search, page: undefined };
  for (const key of DRILL_KEYS) delete next[key];
  return next;
}

/** 当前的排序与方向（没写为 SLA 剩余 ↑） */
export function currentSort(search: TicketsSearch): {
  sort: TicketListSort;
  dir: 'asc' | 'desc';
} {
  const sort = search.sort ?? 'sla';
  return { sort, dir: search.dir ?? ticketListSortDefaults[sort] };
}

/**
 * 点表头排序（Q2）：点当前排序的列反过来；点另一列按它的默认方向（SLA 剩余 ↑，最近来信 ↓）。回到默认（SLA 剩余 ↑）时地址栏不写
 */
export function sortedBy(search: TicketsSearch, column: TicketListSort): TicketsSearch {
  const current = currentSort(search);
  const dir =
    current.sort === column
      ? current.dir === 'asc'
        ? 'desc'
        : 'asc'
      : ticketListSortDefaults[column];
  const isDefault = column === 'sla' && dir === ticketListSortDefaults.sla;
  return {
    ...search,
    sort: isDefault ? undefined : column,
    dir: isDefault ? undefined : dir,
    page: undefined,
  };
}
