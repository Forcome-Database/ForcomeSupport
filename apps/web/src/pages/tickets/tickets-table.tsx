import type { TicketListItem, TicketListSort } from '@forcome/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/empty-state';
import {
  SlaBadge,
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
import { ticketDetailPath } from '@/lib/pages';
import { formatLastInbound } from '@/lib/tickets';
import { cn } from '@/lib/utils';
import { A11Y, COLUMNS, EMPTY_TITLE, EMPTY_VALUE, SLA_REPLIED, SORT_ARROWS } from './p04-copy';

/*
 * P04 的表格（原型 tk_table()、p1_row()）：外框圆角 8、表头 11 / 700 次要色、行上下 7；列宽照 P1_TPL 换算（含单元格内边距）。
 * 九列：工单号 · 主题 · 来源 · 渠道与店铺 · 客户 · 订单号 · 状态 · SLA 剩余 · 最近来信。SLA 剩余与最近来信是排序表头
 * （原型 sort_head()：当前排序列主色加 ↑ / ↓，另一列灰色 ↕）。点一行进入 P05（工单号是链接，键盘可达）。
 * 加载中 8 行骨架（PRD P04「状态」）；为空时 I10 的空状态（当前筛选与清除筛选由页面给出）。
 */

const LOADING_ROWS = 8;

/** SLA 剩余（P04「第一阶段」）：待回复写剩余或「已超时」（带「· 内部」与颜色），等客户写「已回复」，其余写「—」 */
function SlaCell({ ticket, now }: { ticket: TicketListItem; now: Date }) {
  if (ticket.status === 'awaiting_reply' && ticket.sla) {
    return <SlaBadge dueAt={ticket.sla.dueAt} now={now} target={ticket.sla.target} />;
  }
  return (
    <span className="text-11 whitespace-nowrap text-subtle-foreground" data-testid="sla-text">
      {ticket.status === 'awaiting_customer' ? SLA_REPLIED : EMPTY_VALUE}
    </span>
  );
}

function TicketRow({ ticket, now }: { ticket: TicketListItem; now: Date }) {
  const navigate = useNavigate();
  return (
    <TableRow
      data-testid="ticket-row"
      className="cursor-pointer hover:bg-muted/60"
      onClick={() => void navigate({ to: ticketDetailPath, params: { number: ticket.number } })}
    >
      <TableCell className="py-1.75">
        <Link
          to={ticketDetailPath}
          params={{ number: ticket.number }}
          className="rounded-xs text-body font-medium whitespace-nowrap text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => event.stopPropagation()}
        >
          {ticket.number}
        </Link>
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
      <TableCell className="py-1.75" data-testid="ticket-sla">
        <SlaCell ticket={ticket} now={now} />
      </TableCell>
      <TableCell className="py-1.75">
        <span className="text-minor whitespace-nowrap text-muted-foreground">
          {formatLastInbound(ticket.lastInboundAt, now)}
        </span>
      </TableCell>
    </TableRow>
  );
}

/** 排序表头（原型 sort_head()）：当前排序列主色 + 方向箭头，另一列灰色 ↕ */
function SortHead({
  title,
  column,
  sort,
  onSort,
}: {
  title: string;
  column: TicketListSort;
  sort: { sort: TicketListSort; dir: 'asc' | 'desc' };
  onSort: (column: TicketListSort) => void;
}) {
  const on = sort.sort === column;
  return (
    <TableHead
      className="font-bold text-muted-foreground"
      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          'inline-flex cursor-pointer items-center gap-0.75 rounded-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring',
          on ? 'text-primary-text' : 'text-muted-foreground',
        )}
      >
        {title}
        <span className="text-11">{on ? SORT_ARROWS[sort.dir] : SORT_ARROWS.none}</span>
      </button>
    </TableHead>
  );
}

export function TicketsTable({
  tickets,
  now,
  sort,
  onSort,
  empty,
}: {
  /** 加载中为 null */
  tickets: readonly TicketListItem[] | null;
  /** 服务端当前时刻（SLA 剩余、当天只写时分都按它） */
  now: Date;
  sort: { sort: TicketListSort; dir: 'asc' | 'desc' };
  onSort: (column: TicketListSort) => void;
  /** 为空时空状态的说明与按钮（I10 的「当前筛选」与「清除筛选」） */
  empty: { description?: string; action?: ReactNode };
}) {
  const plain = [
    COLUMNS.number,
    COLUMNS.subject,
    COLUMNS.source,
    COLUMNS.channelStore,
    COLUMNS.customer,
    COLUMNS.orderNumber,
    COLUMNS.status,
  ];
  const columnCount = plain.length + 2;
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
        <col className="w-36" />
        <col className="w-24.5" />
      </colgroup>
      <TableHeader>
        <TableRow>
          {plain.map((title) => (
            <TableHead key={title} className="font-bold text-muted-foreground">
              {title}
            </TableHead>
          ))}
          <SortHead title={COLUMNS.sla} column="sla" sort={sort} onSort={onSort} />
          <SortHead title={COLUMNS.lastInbound} column="last_inbound" sort={sort} onSort={onSort} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets === null ? (
          Array.from({ length: LOADING_ROWS }, (_, i) => (
            <TableRow key={i} data-testid="ticket-row-loading">
              {Array.from({ length: columnCount }, (_, column) => (
                <TableCell key={column} className="py-2.5">
                  <Skeleton className="h-3.5 rounded-sm" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : tickets.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columnCount} className="p-0">
              <EmptyState
                icon={Search}
                title={EMPTY_TITLE}
                description={empty.description}
                action={empty.action}
              />
            </TableCell>
          </TableRow>
        ) : (
          tickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} now={now} />)
        )}
      </TableBody>
    </Table>
  );
}
