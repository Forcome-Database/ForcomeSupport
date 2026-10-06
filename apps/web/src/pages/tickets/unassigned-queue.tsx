import {
  recipientHeaderLabels,
  unassignedSlaTargetLabels,
  type StoreOption,
  type UnassignedMail,
} from '@forcome/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { useState } from 'react';
import { DisabledReason } from '@/components/disabled-reason';
import { EmptyState } from '@/components/empty-state';
import { LoadError } from '@/components/load-error';
import { SlaBadge } from '@/components/ticket-badges';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { storeOptionsQuery } from '@/lib/channel';
import { useCurrentMember } from '@/lib/current-member';
import { formatLastInbound } from '@/lib/tickets';
import { cn } from '@/lib/utils';
import { UNASSIGNED } from './p04-copy';
import { assignWithUndo, unassignedMailQuery, usePendingAssignments } from './unassigned-mail';

/*
 * P04 的未归属店铺来信队列（I17 与补充小样③–⑥；第一期参照图 P04_Tickets_unassigned、P04_Tickets_unassigned_empty；待办 15）：
 * 筛选行右侧的入口「未归属店铺 N」（只对客服主管显示，切换按钮，打开时为选中态）与打开后的列表区——标题行、提示条（队列为空时不显示）、
 * 表格（来信 · 识别依据 · 到达 · SLA · 指定店铺）。没有 ✦ 推荐；下拉不预选，只列自己的授权店铺。
 * 表格照原型 mtable()（与 P04 的 tk_table 同一套：外框圆角 8、表头 11 / 700 次要色），行上下 10；列宽照 I17_TPL 换算（含单元格内边距）。
 */

/** 入口里的计数：有待处理的用提醒色，0 用中性色（不吸引注意，协调者 2026-10-07 决定 Q2） */
function CountBadge({ count }: { count: number }) {
  return (
    <Badge tone={count > 0 ? 'warning' : 'neutral'} data-testid="unassigned-count">
      {count}
    </Badge>
  );
}

/** 筛选行右侧：「仅客服主管可见」+ 切换按钮「未归属店铺 N」 */
export function UnassignedEntry({
  count,
  open,
  onToggle,
}: {
  count: number | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-11 whitespace-nowrap text-subtle-foreground">
        {UNASSIGNED.entryHint}
      </span>
      <Button
        size="sm"
        variant={open ? 'accent-outline' : 'outline'}
        aria-pressed={open}
        onClick={onToggle}
      >
        <Inbox strokeWidth={1.9} />
        {UNASSIGNED.entry}
        {count !== null && <CountBadge count={count} />}
      </Button>
    </div>
  );
}

/** 一行的「指定店铺」：下拉（未预选）+「指定」（没选店铺时置灰，悬停写原因） */
function AssignCell({
  mail,
  stores,
}: {
  mail: UnassignedMail;
  stores: readonly StoreOption[] | undefined;
}) {
  const queryClient = useQueryClient();
  const member = useCurrentMember();
  const [storeId, setStoreId] = useState<string>('');
  const store = stores?.find((s) => s.id === storeId);
  return (
    <div className="flex items-center gap-1.5">
      <Select value={storeId} onValueChange={setStoreId}>
        <SelectTrigger
          className="h-7 w-41"
          aria-label={`${UNASSIGNED.columns.store}：${mail.customer.name}`}
        >
          <SelectValue placeholder={UNASSIGNED.storePlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {stores?.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DisabledReason reason={store ? null : UNASSIGNED.assignDisabled}>
        <Button
          size="sm"
          disabled={!store}
          onClick={() => store && assignWithUndo(queryClient, mail, store, member.id)}
        >
          {UNASSIGNED.assign}
        </Button>
      </DisabledReason>
    </div>
  );
}

function MailRow({
  mail,
  now,
  stores,
}: {
  mail: UnassignedMail;
  now: Date;
  stores: readonly StoreOption[] | undefined;
}) {
  return (
    <TableRow data-testid="unassigned-row">
      <TableCell>
        <div className="flex min-w-0 flex-col gap-px">
          <span className="truncate text-13 font-semibold text-foreground">
            {mail.customer.name}
          </span>
          <span className="truncate text-12 text-muted-foreground" title={mail.subject}>
            {mail.subject}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-11 text-subtle-foreground">
            {recipientHeaderLabels[mail.basis.header]}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-12 font-semibold text-foreground">
              {mail.basis.address}
            </span>
            <Badge tone="warning">{UNASSIGNED.unregistered}</Badge>
          </span>
          <span className="truncate text-11 text-subtle-foreground">
            {UNASSIGNED.fromDomain(mail.fromDomain)}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <span className="text-12 whitespace-nowrap text-ink-2 tabular-nums">
          {formatLastInbound(mail.receivedAt, now)}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.75">
          <SlaBadge dueAt={mail.sla.dueAt} now={now} target={mail.sla.target} />
          <span className="text-11 whitespace-nowrap text-subtle-foreground">
            {unassignedSlaTargetLabels[mail.sla.target]}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <AssignCell mail={mail} stores={stores} />
      </TableCell>
    </TableRow>
  );
}

const COLUMN_COUNT = Object.keys(UNASSIGNED.columns).length;

function QueueTable({
  mails,
  now,
  stores,
}: {
  mails: readonly UnassignedMail[] | null;
  now: Date;
  stores: readonly StoreOption[] | undefined;
}) {
  return (
    <Table aria-label={UNASSIGNED.title} aria-busy={mails === null} containerClassName="rounded-md">
      <colgroup>
        <col className="w-105" />
        <col />
        <col className="w-14" />
        <col className="w-36" />
        <col className="w-61" />
      </colgroup>
      <TableHeader>
        <TableRow>
          {Object.values(UNASSIGNED.columns).map((title) => (
            <TableHead key={title} className="font-bold text-muted-foreground">
              {title}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {mails === null ? (
          Array.from({ length: 2 }, (_, i) => (
            <TableRow key={i}>
              {Array.from({ length: COLUMN_COUNT }, (_, j) => (
                <TableCell key={j} className="py-4">
                  <Skeleton className="h-3.5 rounded-sm" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : mails.length === 0 ? (
          <TableRow>
            <TableCell colSpan={COLUMN_COUNT} className="p-0">
              <EmptyState icon={Inbox} title={UNASSIGNED.empty} />
            </TableCell>
          </TableRow>
        ) : (
          mails.map((mail) => <MailRow key={mail.id} mail={mail} now={now} stores={stores} />)
        )}
      </TableBody>
    </Table>
  );
}

/** 打开「未归属店铺 N」后的列表区：标题行、提示条与表格；撤销窗口里与提交中的来信不显示 */
export function UnassignedQueue() {
  const queue = useQuery(unassignedMailQuery);
  const stores = useQuery(storeOptionsQuery);
  const pending = usePendingAssignments();
  if (queue.isError) return <LoadError onRetry={() => void queue.refetch()} />;
  const mails = queue.data ? queue.data.mails.filter((m) => !pending.has(m.id)) : null;
  const now = queue.data ? new Date(queue.data.now) : new Date();
  const count = mails?.length ?? 0;
  return (
    <section className="flex flex-col gap-3" aria-label={UNASSIGNED.title}>
      <div className="flex items-center gap-2">
        <h2 className="text-16 font-bold text-foreground">{UNASSIGNED.title}</h2>
        {mails && <CountBadge count={count} />}
        <span className={cn('text-12 whitespace-nowrap text-muted-foreground')}>
          {UNASSIGNED.scope}
        </span>
      </div>
      {count > 0 && (
        <Alert
          tone="warning"
          title={UNASSIGNED.noteTitle(count)}
          description={UNASSIGNED.noteDescription}
        />
      )}
      <QueueTable mails={mails} now={now} stores={stores.data} />
    </section>
  );
}

/** 入口上的计数：队列里的来信，减去撤销窗口里与提交中的 */
export function useUnassignedCount(enabled: boolean): number | null {
  const queue = useQuery({ ...unassignedMailQuery, enabled });
  const pending = usePendingAssignments();
  if (!queue.data) return null;
  return queue.data.mails.filter((m) => !pending.has(m.id)).length;
}
