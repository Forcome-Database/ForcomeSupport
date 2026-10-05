import type { TicketListItem } from '@forcome/contracts';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { LoadError } from '@/components/load-error';
import { TicketChannelStore, TicketStatusBadge } from '@/components/ticket-badges';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatLastInbound, ticketListQuery } from '@/lib/tickets';
import { A11Y, COLUMNS, EMPTY_TITLE, EMPTY_VALUE, PAGE_DESCRIPTION, PAGE_TITLE } from './p04-copy';

/*
 * P04 工单列表（第一阶段，PRD P04「第一阶段」、I16；参照图 design/spec/shots/phase1/P04_Tickets.png）。
 * 待办 08 是最简列表：页头 + 表格（工单号 · 主题 · 渠道与店铺 · 客户 · 状态 · 最近来信），按 待回复 → 等客户 →
 * 已解决 → 已关闭、组内最近来信倒序（后端排好）。筛选行与「未归属店铺」入口、来源 / 订单号 / SLA 剩余列、
 * SLA 排序与分页、「只读 · 数据变化时自动刷新」与 SSE、点击行进入 P05 随 10、14、15、16、17、18 号待办。
 * 表格照原型 tk_table()：外框圆角 8、表头 11 / 700 次要色、行上下 7；列宽照 P1_TPL 换算（含单元格内边距）。
 */

const LOADING_ROWS = 8;

function TicketsHead() {
  return (
    <div className="flex shrink-0 flex-col gap-1 px-6 pt-4 pb-0.5">
      <h1 className="text-20 font-bold tracking-[-0.015em] text-foreground">{PAGE_TITLE}</h1>
      <p className="text-13 text-muted-foreground">{PAGE_DESCRIPTION}</p>
    </div>
  );
}

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
        <TicketChannelStore channel={ticket.channel} site={ticket.site} store={ticket.store.name} />
      </TableCell>
      <TableCell className="py-1.75">
        <div className="truncate text-body text-foreground" title={ticket.customer.name}>
          {ticket.customer.name}
        </div>
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
        <col className="w-52" />
        <col className="w-31" />
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

export function TicketsPage() {
  const tickets = useQuery(ticketListQuery);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TicketsHead />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pt-3.5 pb-3">
        {tickets.isError ? (
          <LoadError onRetry={() => void tickets.refetch()} />
        ) : (
          <TicketsTable tickets={tickets.isPending ? null : tickets.data} />
        )}
      </div>
    </div>
  );
}
