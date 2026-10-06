import { can, type TicketListItem } from '@forcome/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { z } from 'zod';
import { EmptyState } from '@/components/empty-state';
import { LoadError } from '@/components/load-error';
import { PageHead } from '@/components/page-head';
import {
  TicketChannelStore,
  TicketSourceLabel,
  TicketStatusBadge,
} from '@/components/ticket-badges';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCurrentMember } from '@/lib/current-member';
import { pages } from '@/lib/pages';
import { formatLastInbound, ticketListQuery } from '@/lib/tickets';
import { cn } from '@/lib/utils';
import { A11Y, COLUMNS, EMPTY_TITLE, EMPTY_VALUE, PAGE_DESCRIPTION, PAGE_TITLE } from './p04-copy';
import { UnassignedEntry, UnassignedQueue, useUnassignedCount } from './unassigned-queue';

/*
 * P04 工单列表（第一阶段，PRD P04「第一阶段」、I16；参照图 design/spec/shots/phase1/P04_Tickets.png）。
 * 现在是最简列表：页头 + 表格（工单号 · 主题 · 来源 · 渠道与店铺 · 客户 · 订单号 · 状态 · 最近来信，来源列自待办 10、
 * 订单号列自待办 14），按待回复 → 等客户 → 已解决 → 已关闭、组内最近来信倒序（后端排好）。筛选行与「未归属店铺」入口、
 * SLA 剩余列、SLA 排序与分页、「只读 · 数据变化时自动刷新」与 SSE、点击行进入 P05 随 16、17、18 号待办。
 * 筛选行右侧的「未归属店铺 N」入口只对客服主管显示（I17，待办 15）：切换按钮，条件写在地址栏（?view=unassigned），
 * 打开时列表区换成队列、筛选行只留入口（工单的筛选随 18 加在左侧，不作用于队列）。
 * 表格照原型 tk_table()：外框圆角 8、表头 11 / 700 次要色、行上下 7；列宽照 P1_TPL 换算（含单元格内边距）。
 */

const LOADING_ROWS = 8;

function TicketRow({ ticket, now }: { ticket: TicketListItem; now: Date }) {
  return (
    <TableRow data-testid="ticket-row">
      <TableCell className="py-1.75">
        <span className="text-body font-medium whitespace-nowrap text-primary">
          {ticket.number}
        </span>
      </TableCell>
      <TableCell className="py-1.75">
        <div className="truncate text-body font-medium text-foreground" title={ticket.subject}>
          {ticket.subject || EMPTY_VALUE}
        </div>
      </TableCell>
      <TableCell className="py-1.75">
        <TicketSourceLabel source={ticket.source} />
      </TableCell>
      <TableCell className="py-1.75">
        <TicketChannelStore channel={ticket.channel} site={ticket.site} store={ticket.store.name} />
      </TableCell>
      <TableCell className="py-1.75">
        <div className="truncate text-body text-foreground" title={ticket.customer.name}>
          {ticket.customer.name}
        </div>
      </TableCell>
      <TableCell className="py-1.75">
        {/* 原型 p1_row：12 / 400、不折行；有订单为次要正文色 ink2，没有关联订单写「—」、ink4 */}
        <span
          className={cn(
            'text-minor whitespace-nowrap',
            ticket.orderNumber ? 'text-ink-2' : 'text-subtle-foreground',
          )}
          data-testid="ticket-order"
        >
          {ticket.orderNumber ?? EMPTY_VALUE}
        </span>
      </TableCell>
      <TableCell className="py-1.75">
        <TicketStatusBadge status={ticket.status} />
      </TableCell>
      <TableCell className="py-1.75">
        <span className="text-minor whitespace-nowrap text-muted-foreground">
          {formatLastInbound(ticket.lastInboundAt, now)}
        </span>
      </TableCell>
    </TableRow>
  );
}

function TicketsTable({ tickets }: { tickets: readonly TicketListItem[] | null }) {
  const now = new Date();
  return (
    <Table aria-label={A11Y.table} aria-busy={tickets === null} containerClassName="rounded-md">
      <colgroup>
        <col className="w-36.5" />
        <col />
        <col className="w-21" />
        <col className="w-52" />
        <col className="w-31" />
        <col className="w-40" />
        <col className="w-20.5" />
        <col className="w-24.5" />
      </colgroup>
      <TableHeader>
        <TableRow>
          {Object.values(COLUMNS).map((title) => (
            <TableHead key={title} className="font-bold text-muted-foreground">
              {title}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets === null ? (
          Array.from({ length: LOADING_ROWS }, (_, i) => (
            <TableRow key={i}>
              {Object.keys(COLUMNS).map((column) => (
                <TableCell key={column} className="py-2.5">
                  <Skeleton className="h-3.5 rounded-sm" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : tickets.length === 0 ? (
          <TableRow>
            <TableCell colSpan={Object.keys(COLUMNS).length} className="p-0">
              <EmptyState icon={Search} title={EMPTY_TITLE} />
            </TableCell>
          </TableRow>
        ) : (
          tickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} now={now} />)
        )}
      </TableBody>
    </Table>
  );
}

/** P04 的地址参数：view=unassigned 打开未归属店铺队列（只对客服主管有效，其余成员照常看工单列表） */
export const ticketsSearchSchema = z.object({
  view: z.literal('unassigned').optional().catch(undefined),
});

function TicketList() {
  const tickets = useQuery(ticketListQuery);
  return tickets.isError ? (
    <LoadError onRetry={() => void tickets.refetch()} />
  ) : (
    <TicketsTable tickets={tickets.isPending ? null : tickets.data} />
  );
}

export function TicketsPage() {
  const member = useCurrentMember();
  const navigate = useNavigate();
  const search = ticketsSearchSchema.parse(useSearch({ strict: false }));
  const supervisor = can(member.roles, 'ticket.assign_store');
  const queueOpen = supervisor && search.view === 'unassigned';
  const count = useUnassignedCount(supervisor);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pt-3.5 pb-3">
        {supervisor && (
          <div className="flex min-h-7 items-center justify-end gap-3">
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
          </div>
        )}
        {queueOpen ? <UnassignedQueue /> : <TicketList />}
      </div>
    </div>
  );
}
