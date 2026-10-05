import {
  aftersalesActions,
  can,
  canViewFinance,
  formatMoney,
  formatRate,
  formatRateDate,
  handlingMethodLabels,
  missingItemLabels,
  responsibilityLabels,
  type CurrentMember,
  type Fee,
  type FeeItem,
  type LedgerItem,
  type RegistrationField,
} from '@forcome/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { AftersalesStatusBadge, CategoryBadge } from '@/components/aftersales-badges';
import { EmptyState } from '@/components/empty-state';
import { LoadError } from '@/components/load-error';
import { PageHead } from '@/components/page-head';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AFTERSALES_QUERY_KEY, ledgerQuery } from '@/lib/aftersales';
import { api, ApiRequestError } from '@/lib/api';
import { useCurrentMember } from '@/lib/current-member';
import { dismissToast, showError, showSuccess } from '@/lib/notify';
import { pages } from '@/lib/pages';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  CancelDialog,
  CompletionBadge,
  MissingFilterBar,
  MoreMenu,
  useCompleteAction,
} from './ledger-actions';
import { ledgerSearchSchema } from './ledger-search';
import {
  A11Y,
  BACKFILL_RESULT,
  COLUMNS,
  EMPTY_TITLE,
  EMPTY_VALUE,
  FINANCE_COLUMNS,
  FOREIGN_AMOUNT,
  MISSING,
  NEW_REGISTRATION,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  STALE,
  storeSite,
} from './p13-copy';
import { RegistrationDrawer, type DrawerTarget } from './registration-drawer';

/*
 * P13 登记台账（第一阶段，PRD P13「第一阶段」、S13–S15；参照图 design/spec/shots/phase1/P13_AfterSalesLog.png 与 _agent）。
 * 页头：标题、说明，右上当月登记完整率（点它筛出缺字段的已完成单）与「新建登记」。表格：售后单号（点开「编辑登记」抽屉；已完成
 * 缺适用字段时下标「缺 N 项」）· 客户 · 店铺与站点 · 处理方式 · 责任 · 状态 · 快递单号 · 产品成本 · 运费 · 额外赔偿 · 行尾「更多」。
 * 已完成的单缺的字段在单元格标黄「待回填」（快递单号带「补登」，只有售后负责人，行内编辑），进行中还没发生的写「—」（AC-AS-22）。
 * 金额写冻结的美元值，非美元下方写原币与汇率日期（待办 20）。坐席只读：没有「新建登记」、金额列与「更多」，完整率照常显示。
 * 列设置、导出 Excel、筛选行与「已隐藏 N 列」、费用合计 / FSH 与工厂承担与合计行、表下说明随 22；行尾「改派负责人」随 23。
 * 表格照原型 table_span()：外框圆角 8、表头 11 / 700 次要色、行上下 8；列宽照第一阶段的两个模板（售后负责人：列间距 8；
 * 坐席：列间距 12）换算，含单元格内边距；快递单号这一列占剩余宽度（原型 minmax(0, 1fr)）。
 */

const LOADING_ROWS = 8;
const BACKFILL_TOAST = 'aftersales-backfill';

const EMPTY = <span className="text-body text-subtle-foreground">{EMPTY_VALUE}</span>;
const PENDING = <Badge tone="warning">{MISSING.pending}</Badge>;

/** 单元格要用的上下文：查看者、行内补登的状态与动作、打开抽屉 */
interface CellContext {
  readonly member: CurrentMember;
  readonly backfill: InlineBackfill;
  readonly open: (number: string) => void;
}

/** 一列：表头、对齐、两种视角的列宽（空串为占剩余宽度）、单元格 */
interface Column {
  readonly key: string;
  readonly title: string;
  readonly align: 'left' | 'right';
  /** 售后负责人、客服主管视角（有金额列）与坐席视角的列宽 */
  readonly width: { readonly finance: string; readonly readOnly: string };
  readonly cell: (item: LedgerItem, ctx: CellContext) => ReactNode;
}

/** 这一格的字段缺了要标「待回填」吗：只对已完成的单（后端按 R-AS-08 算好的 missing，进行中为空） */
const isPending = (item: LedgerItem, field: RegistrationField) => item.missing.includes(field);

/** 有值写值；已完成缺这个字段写「待回填」；其余写「—」 */
function valueOr(item: LedgerItem, field: RegistrationField, value: ReactNode): ReactNode {
  if (value !== null && value !== undefined && value !== '') return value;
  return isPending(item, field) ? PENDING : EMPTY;
}

/** 售后单号（原型 no_cell()）：13 / 600 主色，点开「编辑登记」；已完成缺适用字段时下方「缺 N 项」，悬停列出缺的字段 */
function numberCell(item: LedgerItem, ctx: CellContext): ReactNode {
  const labels = missingItemLabels(item.missing);
  return (
    <div className="flex flex-col items-start gap-0.75">
      <button
        type="button"
        aria-label={A11Y.open(item.number)}
        onClick={() => ctx.open(item.number)}
        className="rounded-xs text-body font-semibold whitespace-nowrap text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {item.number}
      </button>
      {labels.length > 0 && (
        <Badge tone="warning" title={MISSING.title(labels)}>
          {MISSING.badge(labels.length)}
        </Badge>
      )}
    </div>
  );
}

/**
 * 快递单号（原型 p1_tracking()）：有单号写单号（12 主色、过长省略）；已完成缺单号写「待回填」，售后负责人旁边「补登」，
 * 点它在这一格行内编辑（S15 ③）；其余写「—」（进行中还没寄出，AC-AS-22；不是寄配件）
 */
function trackingCell(item: LedgerItem, ctx: CellContext): ReactNode {
  if (item.trackingNumber) {
    return (
      <div className="truncate text-minor text-primary tabular-nums" title={item.trackingNumber}>
        {item.trackingNumber}
      </div>
    );
  }
  if (!isPending(item, 'trackingNumber')) return EMPTY;
  if (ctx.backfill.editing === item.id) return <InlineTrackingEditor item={item} ctx={ctx} />;
  const canBackfill = aftersalesActions(ctx.member, item).backfill;
  return (
    <div className="flex items-center gap-1.5">
      {PENDING}
      {canBackfill && (
        <Button variant="text-link" size="text" onClick={() => ctx.backfill.start(item.id)}>
          {MISSING.backfill}
        </Button>
      )}
    </div>
  );
}

/** 行内补登快递单号（S15 ③）：输入框 + 「保存」；Enter 保存、Esc 放弃；为空时「保存」禁用并悬停说明 */
function InlineTrackingEditor({ item, ctx }: { item: LedgerItem; ctx: CellContext }) {
  const { draft, setDraft, save, cancel, saving } = ctx.backfill;
  const empty = draft.trim() === '';
  const saveButton = (
    <Button size="sm" disabled={empty} loading={saving} onClick={() => void save(item)}>
      {MISSING.save}
    </Button>
  );
  return (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        aria-label={A11Y.tracking(item.number)}
        autoComplete="off"
        className="h-7 tabular-nums"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !empty) void save(item);
          if (event.key === 'Escape') cancel();
        }}
      />
      {empty ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {saveButton}
            </span>
          </TooltipTrigger>
          <TooltipContent>{MISSING.saveNeedsValue}</TooltipContent>
        </Tooltip>
      ) : (
        saveButton
      )}
    </div>
  );
}

const BASE_COLUMNS: readonly Column[] = [
  {
    key: 'number',
    title: COLUMNS.number,
    align: 'left',
    width: { finance: 'w-37.5', readOnly: 'w-45.5' },
    cell: numberCell,
  },
  {
    key: 'customer',
    title: COLUMNS.customer,
    align: 'left',
    width: { finance: 'w-26', readOnly: 'w-38' },
    cell: (item) =>
      valueOr(
        item,
        'customerName',
        item.customerName && (
          <div className="truncate text-body text-foreground" title={item.customerName}>
            {item.customerName}
          </div>
        ),
      ),
  },
  {
    key: 'storeSite',
    title: COLUMNS.storeSite,
    align: 'left',
    width: { finance: 'w-33', readOnly: 'w-48' },
    cell: (item) => (
      <div className="flex min-w-0 items-center gap-1">
        <div
          className="truncate text-minor text-ink-2"
          title={storeSite(item.store.name, item.site)}
        >
          {storeSite(item.store.name, item.site)}
        </div>
        {isPending(item, 'site') && PENDING}
      </div>
    ),
  },
  {
    key: 'method',
    title: COLUMNS.method,
    align: 'left',
    width: { finance: 'w-27', readOnly: 'w-38' },
    cell: (item) =>
      valueOr(
        item,
        'method',
        item.method && <CategoryBadge>{handlingMethodLabels[item.method]}</CategoryBadge>,
      ),
  },
  {
    key: 'responsibility',
    title: COLUMNS.responsibility,
    align: 'left',
    width: { finance: 'w-24', readOnly: 'w-35.5' },
    cell: (item) =>
      valueOr(
        item,
        'responsibility',
        item.responsibility && (
          <CategoryBadge>{responsibilityLabels[item.responsibility]}</CategoryBadge>
        ),
      ),
  },
  {
    key: 'status',
    title: COLUMNS.status,
    align: 'left',
    width: { finance: 'w-18', readOnly: 'w-28' },
    cell: (item) => <AftersalesStatusBadge status={item.status} />,
  },
  {
    key: 'trackingNumber',
    title: COLUMNS.trackingNumber,
    align: 'left',
    width: { finance: '', readOnly: '' },
    cell: trackingCell,
  },
];

/**
 * 金额（原型 p1_val()、p1_comp()，R-FL-06）：写冻结的美元值（13 正文色）；非美元在下方另起一行写原币与汇率日期
 * （11 浅灰，例「MX$889.00 · 汇率 09-10」），悬停说明汇率怎么来的（手工修改的另写，S14 补充小样之二）。列窄时这一行在「·」处换行（原型只在宽的「额外赔偿」
 * 列画过一行写完的样子）。没登记的：已完成的单写「待回填」，其余写「—」。
 */
function feeCell(item: LedgerItem, key: FeeItem, fee: Fee | null | undefined): ReactNode {
  if (!fee) return isPending(item, `fees.${key}`) ? PENDING : EMPTY;
  const usd = (
    <span className="text-body whitespace-nowrap text-foreground tabular-nums">
      {formatMoney(fee.usd, 'USD')}
    </span>
  );
  if (!fee.rate) return usd;
  return (
    <div
      className="flex flex-col items-end"
      title={
        fee.rate.source === 'manual'
          ? FOREIGN_AMOUNT.manualTitle(formatRate(fee.rate.rate), fee.currency)
          : FOREIGN_AMOUNT.publishedTitle
      }
    >
      {usd}
      <span className="text-right text-11 text-subtle-foreground tabular-nums">
        <span className="whitespace-nowrap">{formatMoney(fee.amount, fee.currency)}</span>
        {FOREIGN_AMOUNT.separator}
        <span className="whitespace-nowrap">
          {FOREIGN_AMOUNT.rateDate(formatRateDate(fee.rate.date))}
        </span>
      </span>
    </div>
  );
}

/** 金额列（美元；非美元另写原币与汇率日期） */
const feeColumn = (key: Extract<FeeItem, keyof typeof FINANCE_COLUMNS>, width: string): Column => ({
  key,
  title: FINANCE_COLUMNS[key],
  align: 'right',
  width: { finance: width, readOnly: width },
  cell: (item) => feeCell(item, key, item.fees?.[key]),
});

const FINANCE_ONLY: readonly Column[] = [
  feeColumn('productCost', 'w-19.5'),
  feeColumn('freight', 'w-17.5'),
  feeColumn('compensation', 'w-41'),
];

/** 行内补登的状态与动作（一次只编辑一格） */
interface InlineBackfill {
  readonly editing: string | null;
  readonly draft: string;
  readonly saving: boolean;
  readonly setDraft: (value: string) => void;
  readonly start: (id: string) => void;
  readonly cancel: () => void;
  readonly save: (item: LedgerItem) => Promise<void>;
}

/** 行内补登快递单号（S15 ③）：保存后浮层「已补登 · 已记入审计日志」，「缺 N 项」随之减少；失败按 G5 */
function useInlineBackfill(): InlineBackfill {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const mutation = useMutation({
    mutationFn: ({ item, tracking }: { item: LedgerItem; tracking: string }) =>
      api.updateAftersales(item.number, {
        version: item.version,
        changes: { trackingNumber: tracking },
      }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: AFTERSALES_QUERY_KEY });

  async function save(item: LedgerItem): Promise<void> {
    const tracking = draft.trim();
    try {
      const saved = await mutation.mutateAsync({ item, tracking });
      dismissToast(BACKFILL_TOAST);
      setEditing(null);
      await refresh();
      showSuccess({
        title: BACKFILL_RESULT.title,
        description: BACKFILL_RESULT.inline(saved.number, saved.trackingNumber ?? tracking),
      });
    } catch (error) {
      if (endSessionIfUnauthenticated(queryClient, error)) return;
      // 这一格刚被别人补了（409 或「只能补登缺失的字段」）：刷新成最新，收起编辑
      const stale =
        error instanceof ApiRequestError && (error.status === 409 || error.status === 400);
      if (stale) {
        setEditing(null);
        await refresh();
        showError({
          id: BACKFILL_TOAST,
          action: BACKFILL_RESULT.failedAction,
          error,
          description: STALE,
        });
        return;
      }
      showError({
        id: BACKFILL_TOAST,
        action: BACKFILL_RESULT.failedAction,
        error,
        retry: () => save(item),
      });
    }
  }

  return {
    editing,
    draft,
    saving: mutation.isPending,
    setDraft,
    start: (id) => {
      setEditing(id);
      setDraft('');
    },
    cancel: () => setEditing(null),
    save,
  };
}

function LedgerTable({
  items,
  finance,
  showMore,
  ctx,
  onComplete,
  onCancel,
}: {
  items: readonly LedgerItem[] | null;
  finance: boolean;
  showMore: boolean;
  ctx: CellContext;
  onComplete: (item: LedgerItem) => void;
  onCancel: (item: LedgerItem) => void;
}) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const moreColumn: Column = {
    key: 'more',
    title: '',
    align: 'left',
    width: { finance: 'w-8', readOnly: 'w-8' },
    cell: (item) => (
      <MoreMenu
        item={item}
        member={ctx.member}
        onComplete={onComplete}
        onCancel={onCancel}
        onOpenChange={(open) => setMenuOpen(open ? item.id : null)}
      />
    ),
  };
  const columns = [
    ...BASE_COLUMNS,
    ...(finance ? FINANCE_ONLY : []),
    ...(showMore ? [moreColumn] : []),
  ];
  const view = finance ? 'finance' : 'readOnly';
  return (
    <Table
      aria-label={A11Y.table}
      aria-busy={items === null}
      containerClassName="rounded-md"
      className={cn(finance && '[&_td]:px-1 [&_th]:px-1')}
    >
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} className={column.width[view] || undefined} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              key={column.key}
              className={cn(
                'font-bold text-muted-foreground',
                column.align === 'right' && 'text-right',
              )}
            >
              {column.title}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items === null ? (
          Array.from({ length: LOADING_ROWS }, (_, i) => (
            <TableRow key={i}>
              {columns.map((column) => (
                <TableCell key={column.key} className="py-2.5">
                  <Skeleton className="h-3.5 rounded-sm" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="p-0">
              <EmptyState icon={Search} title={EMPTY_TITLE} />
            </TableCell>
          </TableRow>
        ) : (
          items.map((item) => {
            // 行尾「更多」打开或这一行在补登时为选中态（原型 row_tones 'select'：浅主色底 + 左侧主色条）
            const selected = menuOpen === item.id || ctx.backfill.editing === item.id;
            return (
              <TableRow
                key={item.id}
                data-testid="ledger-row"
                data-selected={selected || undefined}
                className={cn(selected && 'bg-primary-soft shadow-[inset_3px_0_0_var(--primary)]')}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn('py-2', column.align === 'right' && 'text-right')}
                  >
                    {column.cell(item, ctx)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

export function LedgerPage() {
  const member = useCurrentMember();
  const finance = canViewFinance(member.roles);
  const canRegister = can(member.roles, 'aftersales.register');
  // 行尾「更多」：能设为已完成或取消的角色才有（坐席没有，原型 S13 坐席视角）
  const showMore =
    can(member.roles, 'aftersales.edit_open') || can(member.roles, 'aftersales.cancel');
  const search = ledgerSearchSchema.parse(useSearch({ strict: false }));
  const navigate = useNavigate();
  const ledger = useQuery(ledgerQuery(search.missing ? { missing: '1' } : {}));
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [cancelling, setCancelling] = useState<LedgerItem | null>(null);
  const backfill = useInlineBackfill();
  const complete = useCompleteAction();
  const ctx: CellContext = {
    member,
    backfill,
    open: (number) => setDrawer({ mode: 'edit', number }),
  };
  const filterMissing = (missing: boolean) =>
    void navigate({
      to: pages.aftersalesLedger.path,
      search: missing ? { missing: '1' } : {},
    });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title={PAGE_TITLE}
        description={finance ? PAGE_DESCRIPTION.finance : PAGE_DESCRIPTION.readOnly}
        actions={
          <>
            {ledger.data && (
              <CompletionBadge
                completion={ledger.data.completion}
                onFilter={() => filterMissing(true)}
              />
            )}
            {canRegister && (
              <Button onClick={() => setDrawer({ mode: 'create' })}>
                <Plus />
                {NEW_REGISTRATION}
              </Button>
            )}
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-6 pt-3.5 pb-3.5">
        {search.missing && ledger.data && (
          <MissingFilterBar
            month={ledger.data.completion.month}
            onClear={() => filterMissing(false)}
          />
        )}
        {ledger.isError ? (
          <LoadError onRetry={() => void ledger.refetch()} />
        ) : (
          <LedgerTable
            items={ledger.isPending ? null : ledger.data.items}
            finance={finance}
            showMore={showMore}
            ctx={ctx}
            onComplete={(item) => void complete(item)}
            onCancel={setCancelling}
          />
        )}
      </div>
      {drawer && (
        <RegistrationDrawer registrar={member} target={drawer} onClose={() => setDrawer(null)} />
      )}
      {cancelling && <CancelDialog item={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}
