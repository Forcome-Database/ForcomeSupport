import {
  aftersalesActions,
  CANCEL_REASON_MAX,
  COMPLETE_UNDO_SECONDS,
  COMPLETION_TARGET,
  completionLabel,
  feeItemLabels,
  feeItems,
  formatMoney,
  formatRateDate,
  handlingMethodLabels,
  missingItemLabels,
  responsibilityLabels,
  type Completion,
  type CurrentMember,
  type FeeItem,
  type LedgerItem,
} from '@forcome/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CircleCheck, CircleX, Ellipsis, Filter, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { FieldError } from '@/components/form-field';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AFTERSALES_QUERY_KEY } from '@/lib/aftersales';
import { api, ApiRequestError } from '@/lib/api';
import { dismissToast, showError, showSuccess, showUndo } from '@/lib/notify';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { cn } from '@/lib/utils';
import { A11Y, CANCEL, COMPLETE_RESULT, COMPLETION, MISSING_FILTER, MORE, STALE } from './p13-copy';

/*
 * P13 台账上的状态操作与完整率（PRD P13「第一阶段」、S13、S15 及其补充小样）：页头的当月登记完整率、点它筛出缺字段的
 * 已完成单的筛选芯片、行尾「更多」（设为已完成 5 秒撤销、取消售后单二次确认；改派负责人随待办 23）。
 * 谁能做什么按 contracts 的 aftersalesActions（与后端同一个判断）；不可用的项禁用并悬停写原因。
 */

// 浮层的 id：失败浮层与撤销倒计时各用各的。Sonner 的「撤掉」要到下一帧才生效，同一个 id 先撤掉再弹新的，
// 新弹出的会被那次撤掉误删，所以成功后撤掉的是失败浮层，倒计时用另一个 id
const COMPLETE_FAILED_TOAST = (number: string) => `aftersales-complete-failed-${number}`;
const UNDO_TOAST = (number: string) => `aftersales-undo-${number}`;
const UNDO_FAILED_TOAST = (number: string) => `aftersales-undo-failed-${number}`;
const CANCEL_TOAST = 'aftersales-cancel';

/** 月份的写法（「2026-09」→ 9） */
const monthOf = (month: string) => Number(month.slice(5, 7));

/**
 * 页头的当月登记完整率（原型 build_ledger.completion()）：「9 月登记完整率 87.5% ▬ 7 / 8 · 目标 ≥ 98% | 筛出缺字段的 1 单 ›」；
 * 达标（≥ 98%）绿色、不达标黄色；全部齐全时右侧写「无缺字段的单」；当月没有已完成的单写「—」，右侧不写、整块不可点
 * （S15 补充小样）。有缺字段的单时整块可点，筛出缺字段的已完成单。
 */
export function CompletionBadge({
  completion,
  onFilter,
}: {
  completion: Completion;
  onFilter: () => void;
}) {
  const label = completionLabel(completion);
  const missing = completion.completed - completion.complete;
  const percent = completion.completed ? (completion.complete * 100) / completion.completed : 0;
  const good = percent >= COMPLETION_TARGET;
  const content = (
    <>
      <span className="text-12 text-muted-foreground">
        {COMPLETION.label(monthOf(completion.month))}
      </span>
      <span
        className={cn(
          'text-14 font-bold tabular-nums',
          label === null
            ? 'text-subtle-foreground'
            : good
              ? 'text-success-text'
              : 'text-warning-text',
        )}
      >
        {label ?? COMPLETION.empty}
      </span>
      <span aria-hidden className="h-1 w-14 overflow-hidden rounded-full bg-secondary">
        <span
          className={cn('block h-full rounded-full', good ? 'bg-success' : 'bg-warning')}
          style={{ width: `${Math.round(percent)}%` }}
        />
      </span>
      <span className="text-12 font-semibold text-ink-2 tabular-nums">
        {COMPLETION.ratio(completion.complete, completion.completed)}
      </span>
      <span className="text-12 text-subtle-foreground">{COMPLETION.target}</span>
      {completion.completed > 0 && (
        <>
          <span aria-hidden className="h-4 w-px bg-border" />
          {missing > 0 ? (
            <span className="flex items-center gap-0.5 text-12 font-medium text-primary">
              {COMPLETION.filter(missing)}
              <ChevronRight className="size-3.5" />
            </span>
          ) : (
            <span className="text-12 font-semibold text-success-text">
              {COMPLETION.allComplete}
            </span>
          )}
        </>
      )}
    </>
  );
  const box =
    'inline-flex h-8 shrink-0 items-center gap-2 rounded-md border bg-card px-2.5 whitespace-nowrap shadow-xs';
  return missing > 0 ? (
    <button
      type="button"
      title={COMPLETION.title}
      onClick={onFilter}
      className={cn(
        box,
        'outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      {content}
    </button>
  ) : (
    <div title={COMPLETION.title} className={box}>
      {content}
    </div>
  );
}

/**
 * 点完整率筛出后的筛选芯片（S15 补充小样，同 P04「来自报表」芯片的样子）：选中态「缺字段的已完成单：9 月」带 ×，
 * 右侧「清除筛选」。筛选行的其余条件随待办 22。
 */
export function MissingFilterBar({ month, onClear }: { month: string; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-primary-line bg-primary-soft pr-1.5 pl-2 text-12 font-medium whitespace-nowrap text-muted-foreground">
        <Filter className="size-3.25 text-primary-text" />
        {MISSING_FILTER.label}
        <span className="font-semibold text-primary-text">
          {MISSING_FILTER.month(monthOf(month))}
        </span>
        <button
          type="button"
          title={MISSING_FILTER.remove}
          aria-label={MISSING_FILTER.remove}
          onClick={onClear}
          className="flex rounded-xs p-0.5 text-primary-text outline-none hover:bg-primary-line focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3" strokeWidth={2} />
        </button>
      </span>
      <Button variant="text-link" size="text" onClick={onClear}>
        {MISSING_FILTER.clear}
      </Button>
    </div>
  );
}

/** 菜单项不可用时的原因（S15 补充小样） */
function completeBlocked(item: LedgerItem): string {
  if (item.status === 'completed') return MORE.reasons.completed;
  if (item.status === 'cancelled') return MORE.reasons.cancelled;
  return MORE.reasons.notEditor;
}

function cancelBlocked(item: LedgerItem): string {
  return item.status === 'completed' ? MORE.reasons.cancelCompleted : MORE.reasons.cancelled;
}

/** 不可用的菜单项：禁用的样子，悬停写原因（Radix 的 disabled 收不到悬停，所以自己挡掉选择） */
function BlockedItem({ icon, label, reason }: { icon: ReactNode; label: string; reason: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem
          aria-disabled
          onSelect={(event) => event.preventDefault()}
          className="text-placeholder focus:bg-transparent"
        >
          {icon}
          {label}
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side="left">{reason}</TooltipContent>
    </Tooltip>
  );
}

/**
 * 行尾「更多」（原型 more_cell()、S15 ①）：设为已完成 · 分隔线 · 取消售后单（危险色）；改派负责人随待办 23。
 * 打开时按钮为浅主色底与描边，这一行为选中态（由使用处根据 onOpenChange 标出）。
 */
export function MoreMenu({
  item,
  member,
  onComplete,
  onCancel,
  onOpenChange,
}: {
  item: LedgerItem;
  member: CurrentMember;
  onComplete: (item: LedgerItem) => void;
  onCancel: (item: LedgerItem) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const actions = aftersalesActions(member, item);
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={A11Y.more(item.number)}
          className="flex size-6 items-center justify-center rounded-sm text-subtle-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-primary-soft data-[state=open]:text-primary-text data-[state=open]:ring-1 data-[state=open]:ring-primary-line data-[state=open]:ring-inset"
        >
          <Ellipsis className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-42">
        {actions.complete ? (
          <DropdownMenuItem onSelect={() => onComplete(item)}>
            <CircleCheck />
            {MORE.complete}
          </DropdownMenuItem>
        ) : (
          <BlockedItem
            icon={<CircleCheck />}
            label={MORE.complete}
            reason={completeBlocked(item)}
          />
        )}
        <DropdownMenuSeparator />
        {actions.cancel ? (
          <DropdownMenuItem
            onSelect={() => onCancel(item)}
            className="text-destructive-text focus:text-destructive-text"
          >
            <CircleX />
            {MORE.cancel}
          </DropdownMenuItem>
        ) : (
          <BlockedItem icon={<CircleX />} label={MORE.cancel} reason={cancelBlocked(item)} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 操作失败：这张单刚被别人改过（409）时说明已刷新，其余给「立即重试」（G5） */
function showActionError(
  id: string,
  action: string,
  error: unknown,
  retry: () => Promise<unknown>,
): void {
  if (error instanceof ApiRequestError && error.status === 409) {
    showError({ id, action, error, description: STALE });
    return;
  }
  showError({ id, action, error, retry });
}

/**
 * 设为已完成（S15 ①）：直接执行，弹撤销浮层（缺字段时第二行写「缺 N 项，已标黄待回填」）；5 秒内点「撤销」回到进行中。
 * 失败给失败浮层；这张单刚被别人改过时写「已刷新为最新内容」，台账随之刷新。
 */
export function useCompleteAction() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: AFTERSALES_QUERY_KEY });

  async function undo(done: LedgerItem) {
    try {
      await api.undoComplete(done.number, done.version);
      dismissToast(UNDO_FAILED_TOAST(done.number));
    } catch (error) {
      if (endSessionIfUnauthenticated(queryClient, error)) return;
      showError({
        id: UNDO_FAILED_TOAST(done.number),
        action: COMPLETE_RESULT.undoFailedAction,
        error,
        retry: () => api.undoComplete(done.number, done.version).finally(refresh),
      });
    } finally {
      await refresh();
    }
  }

  async function complete(item: LedgerItem) {
    try {
      const done = await api.completeAftersales(item.number, item.version);
      dismissToast(COMPLETE_FAILED_TOAST(item.number));
      await refresh();
      const missing = missingItemLabels(done.missing).length;
      showUndo({
        id: UNDO_TOAST(item.number),
        title: COMPLETE_RESULT.title(done.number),
        description: missing > 0 ? COMPLETE_RESULT.missing(missing) : undefined,
        seconds: COMPLETE_UNDO_SECONDS,
        onUndo: () => undo(done),
      });
    } catch (error) {
      if (endSessionIfUnauthenticated(queryClient, error)) return;
      await refresh();
      showActionError(COMPLETE_FAILED_TOAST(item.number), COMPLETE_RESULT.failedAction, error, () =>
        complete(item),
      );
    }
  }

  return complete;
}

/**
 * 取消售后单的二次确认（S15 ②，原型 build_ledger.cancel_dialog()）：原因必填（0 / 200）；逐项列出已登记的费用（没登记的不列）、
 * 默认全部勾选「取消后保留的已产生部分」，下方保留合计按费用发生日计入售后成本；两条说明；默认焦点在「取消」。
 * 坐席没有入口（不显示「更多」），这里的金额是查看者能看到的美元冻结值。
 */
export function CancelDialog({ item, onClose }: { item: LedgerItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const ids = useId();
  const registered = feeItems.filter((fee) => item.fees?.[fee]);
  const [kept, setKept] = useState<ReadonlySet<FeeItem>>(new Set(registered));
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () =>
      api.cancelAftersales(item.number, {
        version: item.version,
        reason,
        keptFees: registered.filter((fee) => kept.has(fee)),
      }),
  });
  const keptCents = registered
    .filter((fee) => kept.has(fee))
    .reduce((sum, fee) => sum + Math.round(Number(item.fees?.[fee]?.usd ?? 0) * 100), 0);

  async function submit() {
    setReasonError(null);
    try {
      const cancelled = await cancel.mutateAsync();
      dismissToast(CANCEL_TOAST);
      await queryClient.invalidateQueries({ queryKey: AFTERSALES_QUERY_KEY });
      showSuccess({
        title: CANCEL.doneTitle(cancelled.number),
        description: CANCEL.doneDescription,
      });
      onClose();
    } catch (error) {
      if (endSessionIfUnauthenticated(queryClient, error)) return;
      if (error instanceof ApiRequestError && error.status === 400 && error.fields?.reason) {
        setReasonError(error.fields.reason);
        document.getElementById(`${ids}-reason`)?.focus();
        return;
      }
      if (error instanceof ApiRequestError && error.status === 409) {
        await queryClient.invalidateQueries({ queryKey: AFTERSALES_QUERY_KEY });
        onClose();
      }
      showActionError(CANCEL_TOAST, CANCEL.failedAction, error, () => submit());
    }
  }

  const method = item.method ? handlingMethodLabels[item.method] : '';
  const responsibility = item.responsibility ? responsibilityLabels[item.responsibility] : '';
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="w-115">
        <AlertDialogHeader
          tone="danger"
          title={CANCEL.title(item.number)}
          description={CANCEL.description(item.customerName ?? '', method, responsibility)}
        />
        <AlertDialogBody asChild>
          <div className="flex flex-col gap-3 text-foreground">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-reason`} className="text-12 font-semibold text-ink-2">
                {CANCEL.reason}
                <span aria-hidden className="ml-0.5 text-destructive-text">
                  *
                </span>
              </label>
              <Textarea
                id={`${ids}-reason`}
                rows={2}
                maxLength={CANCEL_REASON_MAX}
                placeholder={CANCEL.reasonPlaceholder}
                counter={`${reason.length} / ${CANCEL_REASON_MAX}`}
                value={reason}
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={reasonError ? `${ids}-reason-error` : undefined}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(null);
                }}
              />
              {reasonError && <FieldError id={`${ids}-reason-error`} messages={[reasonError]} />}
            </div>
            {registered.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-12 font-semibold text-ink-2">{CANCEL.fees}</span>
                  <span className="text-12 text-subtle-foreground">{CANCEL.feesDefault}</span>
                </div>
                <div className="overflow-hidden rounded-md border">
                  {registered.map((fee, index) => (
                    <label
                      key={fee}
                      className={cn(
                        'flex items-center justify-between gap-3 px-3 py-1.5',
                        index > 0 && 'border-t border-border-soft',
                      )}
                    >
                      <span className="flex items-center gap-2 text-13 text-foreground">
                        <Checkbox
                          aria-label={A11Y.keep(feeItemLabels[fee])}
                          checked={kept.has(fee)}
                          onCheckedChange={(checked) => {
                            const next = new Set(kept);
                            if (checked === true) next.add(fee);
                            else next.delete(fee);
                            setKept(next);
                          }}
                        />
                        {feeItemLabels[fee]}
                      </span>
                      <span className="text-13 font-semibold text-foreground tabular-nums">
                        {formatMoney(item.fees?.[fee]?.usd ?? '0', 'USD')}
                      </span>
                    </label>
                  ))}
                  <div className="flex items-center justify-between gap-3 border-t bg-muted px-3 py-1.75">
                    <span className="text-12 text-muted-foreground">
                      {CANCEL.keptTotal(item.feeDate ? formatRateDate(item.feeDate) : '')}
                    </span>
                    <span className="text-13 font-bold text-foreground tabular-nums">
                      {formatMoney((keptCents / 100).toFixed(2), 'USD')}
                    </span>
                  </div>
                </div>
              </div>
            )}
            <ul className="flex flex-col gap-1">
              {CANCEL.notes.map((note) => (
                <li
                  key={note}
                  className="flex gap-2 text-12 leading-[1.55] text-ink-2 before:mt-2 before:size-1 before:shrink-0 before:rounded-full before:bg-subtle-foreground"
                >
                  {note}
                </li>
              ))}
            </ul>
          </div>
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Button type="button" variant="outline" autoFocus>
              {CANCEL.dismiss}
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            loading={cancel.isPending}
            onClick={() => void submit()}
          >
            {CANCEL.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
