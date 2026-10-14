import { businessDate } from '@forcome/calendar';
import {
  can,
  ticketDrillOf,
  type TicketDrill,
  type TicketList,
  type TicketListSort,
} from '@forcome/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { RefreshCw, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { DisabledReason } from '@/components/disabled-reason';
import { LoadError } from '@/components/load-error';
import { PageHead } from '@/components/page-head';
import { Button } from '@/components/ui/button';
import { storeOptionsQuery } from '@/lib/channel';
import { useCurrentMember } from '@/lib/current-member';
import { pages } from '@/lib/pages';
import { ticketListQuery, useServerNow } from '@/lib/tickets';
import { EMPTY, FILTERS, LIVE_NOTE, PAGE_DESCRIPTION, PAGE_TITLE, PAGER } from './p04-copy';
import { drillCountWords, drillNoteWords, filterSummary } from './p04-words';
import { TicketFilterBar } from './tickets-filters';
import {
  clearedSearch,
  currentSort,
  isDefaultSearch,
  sortedBy,
  ticketQueryOf,
  ticketsSearchSchema,
  type TicketsSearch,
} from './tickets-search';
import { TicketsTable } from './tickets-table';
import { UnassignedEntry, UnassignedQueue, useUnassignedCount } from './unassigned-queue';

/*
 * P04 工单列表（第一阶段，PRD P04「第一阶段」v2.32、I16、I10；参照图 design/spec/shots/phase1/P04_Tickets.png、
 * P04_Tickets_drill.png）：只读工作台。页头（右侧「只读 · 数据变化时自动刷新」）→ 筛选行（条件写在地址栏，右侧客服主管的
 * 「未归属店铺 N」入口，I17，待办 15）→ 下钻时的计数行 → 表格 → 分页。没有指标行、快捷视图、批量条、选择框、优先级、意图、
 * 情绪、标签、负责人、导出、新建工单。店铺范围由后端强制过滤；数据变化经实时推送在后台重新拉取（lib/live-updates.ts）。
 */

/** 下钻时筛选行下方的计数行（原型 p04_p1(drill=True)：「共 73 条」13 / 600、说明 12 次要色，右侧「清除筛选」） */
function DrillCount({
  drill,
  data,
  today,
  onClear,
}: {
  drill: TicketDrill;
  data: TicketList;
  today: string;
  onClear: () => void;
}) {
  if (!data.drill) return null;
  return (
    <div className="flex items-center justify-between gap-3" data-testid="drill-count">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="text-13 font-semibold whitespace-nowrap text-foreground">
          {drillCountWords(data.drill)}
        </span>
        <span className="truncate text-12 text-muted-foreground">
          {drillNoteWords(drill, today)}
        </span>
      </div>
      <Button variant="text-link" size="text" onClick={onClear}>
        {FILTERS.clear}
      </Button>
    </div>
  );
}

/** 表下的分页（原型：「共 16 条 · 每页 20 条 · 已超时在前…」，上一页 · 1 / 1 · 下一页，禁用时悬停写原因） */
function Pager({
  data,
  defaultOrder,
  onPage,
}: {
  data: TicketList;
  defaultOrder: boolean;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const summary = PAGER.summary(data.total, data.pageSize);
  return (
    <div className="flex items-center justify-between gap-3" data-testid="ticket-pager">
      <span className="text-12 text-muted-foreground">
        {defaultOrder ? `${summary} · ${PAGER.defaultOrder}` : summary}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <DisabledReason reason={data.page <= 1 ? PAGER.first : null}>
          <Button
            variant="outline"
            size="sm"
            disabled={data.page <= 1}
            onClick={() => onPage(data.page - 1)}
          >
            {PAGER.prev}
          </Button>
        </DisabledReason>
        <span className="text-12 text-ink-2 tabular-nums">
          {PAGER.position(data.page, pageCount)}
        </span>
        <DisabledReason
          reason={data.page >= pageCount ? PAGER.last(data.total, data.pageSize) : null}
        >
          <Button
            variant="outline"
            size="sm"
            disabled={data.page >= pageCount}
            onClick={() => onPage(data.page + 1)}
          >
            {PAGER.next}
          </Button>
        </DisabledReason>
      </div>
    </div>
  );
}

function TicketList({ search, entry }: { search: TicketsSearch; entry: ReactNode }) {
  const navigate = useNavigate();
  const query = ticketQueryOf(search);
  const list = useQuery({ ...ticketListQuery(query), placeholderData: keepPreviousData });
  const stores = useQuery(storeOptionsQuery);
  const data = list.data ?? null;
  const now = useServerNow(data?.now ?? null);
  const today = businessDate(now);
  const drill = ticketDrillOf(query);
  const clearable = !isDefaultSearch(search);
  const empty = data !== null && data.tickets.length === 0;
  // 列表为空时「清除筛选后查看全部 N 张」：N 是清除后（默认的近 30 天、其余不选）会列出的张数
  const fallback = useQuery({
    ...ticketListQuery(ticketQueryOf(clearedSearch(search))),
    enabled: clearable && empty,
  });
  const storeOptions = (stores.data ?? []).map((store) => ({ value: store.id, label: store.name }));
  const sort = currentSort(search);

  const go = (next: TicketsSearch) => void navigate({ to: pages.tickets.path, search: next });
  const clear = () => go(clearedSearch(search));

  // 地址栏的页码超出了（筛选后少了、数据变了）：回到最后一页
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : null;
  useEffect(() => {
    if (pageCount !== null && (search.page ?? 1) > pageCount) {
      void navigate({
        to: pages.tickets.path,
        search: { ...search, page: pageCount > 1 ? pageCount : undefined },
        replace: true,
      });
    }
  }, [navigate, pageCount, search]);

  return (
    <>
      <TicketFilterBar
        search={search}
        inbound={data?.inbound ?? null}
        drill={drill}
        today={today}
        stores={storeOptions}
        clearable={clearable && !drill}
        entry={entry}
        onChange={go}
        onClear={clear}
      />
      {list.isError ? (
        <LoadError onRetry={() => void list.refetch()} />
      ) : (
        <div className="flex flex-col gap-2">
          {data && drill && <DrillCount drill={drill} data={data} today={today} onClear={clear} />}
          <TicketsTable
            tickets={data?.tickets ?? null}
            now={now}
            sort={sort}
            onSort={(column: TicketListSort) => go(sortedBy(search, column))}
            empty={{
              description: EMPTY.description(
                filterSummary(search, data?.inbound ?? null, storeOptions, drill, today),
                clearable,
                fallback.data?.total ?? 0,
              ),
              // 清除后也一张都没有时只写「换个条件试试。」、不给清除筛选（协调者 2026-10-14 决定 Q6）
              action:
                clearable && (fallback.data?.total ?? 0) > 0 ? (
                  <Button variant="outline" onClick={clear}>
                    <X />
                    {FILTERS.clear}
                  </Button>
                ) : undefined,
            }}
          />
        </div>
      )}
      {data && data.total > 0 && (!drill || data.total > data.pageSize) && (
        <Pager
          data={data}
          defaultOrder={sort.sort === 'sla' && sort.dir === 'asc'}
          onPage={(page) => go({ ...search, page: page > 1 ? page : undefined })}
        />
      )}
    </>
  );
}

export function TicketsPage() {
  const member = useCurrentMember();
  const navigate = useNavigate();
  const search = ticketsSearchSchema.parse(useSearch({ strict: false }));
  const supervisor = can(member.roles, 'ticket.assign_store');
  const queueOpen = supervisor && search.view === 'unassigned';
  const count = useUnassignedCount(supervisor);
  const entry = supervisor ? (
    <UnassignedEntry
      count={count}
      open={queueOpen}
      onToggle={() =>
        void navigate({
          to: pages.tickets.path,
          search: queueOpen ? {} : { view: 'unassigned' },
        })
      }
    />
  ) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        actions={
          <span className="inline-flex items-center gap-1.5 text-12 whitespace-nowrap text-muted-foreground">
            <RefreshCw className="size-3.5 text-subtle-foreground" />
            {LIVE_NOTE}
          </span>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pt-3.5 pb-3">
        {queueOpen ? (
          <>
            {/* 队列视图：筛选行只留右侧入口（工单的筛选不作用于队列，PRD v2.30） */}
            <div className="flex min-h-7 items-center justify-end gap-3">{entry}</div>
            <UnassignedQueue />
          </>
        ) : (
          <TicketList search={search} entry={entry} />
        )}
      </div>
    </div>
  );
}
