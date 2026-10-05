import {
  formatMoney,
  ledgerColumnLabels,
  ledgerColumnTotals,
  ledgerFinanceColumns,
  type LedgerColumn,
  type LedgerItem,
  type LedgerTotals,
} from '@forcome/contracts';
import {
  columnVisibilityFeature,
  createColumnHelper,
  metaHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  customerCell,
  factoryCell,
  feeCell,
  feeTotalCell,
  methodCell,
  numberCell,
  ownerCell,
  partCell,
  responsibilityCell,
  shareCell,
  statusCell,
  storeSiteCell,
  trackingCell,
  type CellContext,
} from './ledger-cells';
import type { ColumnVisibility } from './ledger-columns';
import { A11Y, EMPTY_TITLE, TOTALS } from './p13-copy';

/*
 * P13 台账的表格（原型 p13_p1_table()，S13）：17 列 + 行尾「更多」，列定义交给 TanStack Table（设计规范组件对照
 * 「Table + TanStack Table：列显隐」，ADR 0007），显隐由「列设置」决定（坐席没有七个金额列与「更多」）。
 * 列宽照第一阶段的两个模板换算（售后负责人：列间距 8，单元格左右 4；坐席：列间距 12），含单元格内边距；
 * 快递单号这一列占剩余宽度（原型 minmax(0, 1fr)），列多时整表横向滚动、快递单号至少 136。
 * 表格在自己的滚动区里：表头与合计行上下固定，首列（售后单号）左右固定（P13「第一阶段」：首列与合计行固定）。
 * 合计行（原型的合计行，有财务权限时）：「合计 · 12 单」在首列，「首列与合计行固定」与（「其他」列隐藏时）「· 隐藏列「其他」$0.00」
 * 接在后面，金额列写各列之和（各行计入售后成本的部分，与 P17 同一个视图）。
 */

const LOADING_ROWS = 8;
/** 加载中交给表格的空数据（引用不变，免得每次渲染都当成新数据） */
const NO_ROWS: LedgerItem[] = [];
/** 快递单号（占剩余宽度的一列）的最小宽度：列多时整表横向滚动 */
const FLEX_MIN_WIDTH = 136;

/** 列的附加信息：对齐、两种视角的列宽（null 为占剩余宽度）；合计行里写的合计项取 contracts 的 ledgerColumnTotals */
interface ColumnMeta {
  readonly align: 'left' | 'right';
  readonly width: { readonly finance: number | null; readonly readOnly: number | null };
}

/** 单元格要用的上下文与行尾「更多」（交给表格的 meta） */
interface TableMeta {
  readonly ctx: CellContext;
  readonly more: (item: LedgerItem) => ReactNode;
}

const features = tableFeatures({
  columnVisibilityFeature,
  columnMeta: metaHelper<ColumnMeta>(),
  tableMeta: metaHelper<TableMeta>(),
});
const helper = createColumnHelper<typeof features, LedgerItem>();

const width = (finance: number | null, readOnly = finance) => ({ finance, readOnly });

/** 一列：叫法取 contracts，单元格拿到这一行与上下文 */
function column(
  id: LedgerColumn,
  meta: ColumnMeta,
  render: (item: LedgerItem, ctx: CellContext) => ReactNode,
) {
  return helper.display({
    id,
    header: ledgerColumnLabels[id],
    enableHiding: id !== 'number',
    cell: ({ row, table }) => render(row.original, table.options.meta!.ctx),
    meta,
  });
}

const left = (finance: number | null, readOnly?: number | null) => ({
  align: 'left' as const,
  width: width(finance, readOnly),
});

const COLUMNS = helper.columns([
  column('number', left(150, 182), numberCell),
  column('customer', left(104, 152), customerCell),
  column('storeSite', left(132, 192), storeSiteCell),
  column('method', left(108, 152), methodCell),
  column('responsibility', left(96, 142), responsibilityCell),
  column('status', left(72, 112), statusCell),
  column('owner', left(72, 84), ownerCell),
  column('factory', left(64, 76), factoryCell),
  column('part', left(200, 212), partCell),
  column('trackingNumber', left(null), trackingCell),
  column('productCost', { align: 'right', width: width(78) }, (item) =>
    feeCell(item, 'productCost'),
  ),
  column('freight', { align: 'right', width: width(70) }, (item) => feeCell(item, 'freight')),
  column('compensation', { align: 'right', width: width(152) }, (item) =>
    feeCell(item, 'compensation'),
  ),
  column('otherCost', { align: 'right', width: width(78) }, (item) => feeCell(item, 'otherCost')),
  column('feeTotal', { align: 'right', width: width(82) }, feeTotalCell),
  column('fshShare', { align: 'right', width: width(84) }, (item) => shareCell(item, 'fsh')),
  column('factoryShare', { align: 'right', width: width(84) }, (item) =>
    shareCell(item, 'factory'),
  ),
  helper.display({
    id: 'more',
    header: '',
    enableHiding: false,
    cell: ({ row, table }) => table.options.meta!.more(row.original),
    meta: { align: 'left', width: width(44) },
  }),
]);

/** 坐席看不到的列：七个金额列，与行尾「更多」（没有能做的操作时） */
function unavailable(finance: boolean, showMore: boolean): ColumnVisibility & { more?: boolean } {
  const hidden: Record<string, boolean> = {};
  if (!finance) for (const id of ledgerFinanceColumns) hidden[id] = false;
  if (!showMore) hidden.more = false;
  return hidden;
}

export function LedgerTable({
  items,
  totals,
  finance,
  showMore,
  visibility,
  ctx,
  more,
  selectedId,
  empty,
}: {
  /** 加载中为 null（查询结果的数组，引用稳定） */
  items: LedgerItem[] | null;
  /** 合计行（有财务权限时） */
  totals: LedgerTotals | undefined;
  finance: boolean;
  showMore: boolean;
  visibility: ColumnVisibility;
  ctx: CellContext;
  more: (item: LedgerItem) => ReactNode;
  /** 选中的一行（行尾「更多」打开或在补登）：浅主色底、左侧主色条 */
  selectedId: string | null;
  /** 列表为空时的说明与操作（S10 的 P13 写法） */
  empty: { description: string; action?: ReactNode };
}) {
  const table = useTable({
    features,
    columns: COLUMNS,
    data: items ?? NO_ROWS,
    getRowId: (item) => item.id,
    state: { columnVisibility: { ...visibility, ...unavailable(finance, showMore) } },
    meta: { ctx, more },
  });
  const view = finance ? 'finance' : 'readOnly';
  const columns = table.getVisibleLeafColumns();
  const fixed = columns.reduce((sum, c) => sum + (c.columnDef.meta?.width[view] ?? 0), 0);
  // 合计行的金额从第一个可见的金额列开始；金额列全被隐藏时只剩「合计 · N 单」与说明
  const firstMoney = columns.findIndex((c) => ledgerFinanceColumns.has(c.id as LedgerColumn));
  const moneyStart = firstMoney === -1 ? columns.length : firstMoney;
  const otherHidden = finance && !columns.some((c) => c.id === 'otherCost');

  return (
    <Table
      aria-label={A11Y.table}
      aria-busy={items === null}
      containerClassName="min-h-0 shrink overflow-auto rounded-md"
      className={cn('border-separate border-spacing-0', finance && '[&_td]:px-1 [&_th]:px-1')}
      style={{ minWidth: fixed + FLEX_MIN_WIDTH }}
    >
      <colgroup>
        {columns.map((c) => {
          const px = c.columnDef.meta?.width[view];
          return <col key={c.id} style={px ? { width: px } : undefined} />;
        })}
      </colgroup>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header, index) => (
              <TableHead
                key={header.id}
                className={cn(
                  'sticky top-0 z-[2] border-b border-border bg-muted font-bold text-muted-foreground',
                  index === 0 && 'left-0 z-[3]',
                  header.column.columnDef.meta?.align === 'right' && 'text-right',
                )}
              >
                <table.FlexRender header={header} />
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {items === null ? (
          Array.from({ length: LOADING_ROWS }, (_, i) => (
            <TableRow key={i}>
              {columns.map((c) => (
                <TableCell key={c.id} className="border-b border-border-soft py-2.5">
                  <Skeleton className="h-3.5 rounded-sm" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="p-0">
              <EmptyState
                icon={Search}
                title={EMPTY_TITLE}
                description={empty.description}
                action={empty.action}
              />
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => {
            const selected = selectedId === row.id;
            return (
              <TableRow
                key={row.id}
                data-testid="ledger-row"
                data-selected={selected || undefined}
                className={cn('border-b-0', selected ? 'bg-primary-soft' : 'bg-card')}
              >
                {row.getVisibleCells().map((cell, index) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      'border-b border-border-soft bg-inherit py-2',
                      index === 0 && 'sticky left-0 z-[1]',
                      selected && index === 0 && 'shadow-[inset_3px_0_0_var(--primary)]',
                      cell.column.columnDef.meta?.align === 'right' && 'text-right',
                    )}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            );
          })
        )}
      </TableBody>
      {totals && items !== null && items.length > 0 && (
        <tfoot>
          <tr data-testid="ledger-totals" className="text-13 font-bold text-foreground">
            {/* 首列固定：说明文字接在「合计 · N 单」后面，越过首列落在右边空着的格子上（原型合计行的左半边是一整段） */}
            <td className="sticky bottom-0 left-0 z-[3] overflow-visible bg-muted py-2.5 whitespace-nowrap first:pl-4">
              <span className="flex items-center gap-2">
                {TOTALS.label(totals.count)}
                <span className="text-11 font-normal text-subtle-foreground">{TOTALS.pinned}</span>
                {otherHidden && (
                  <span className="text-11 font-normal text-subtle-foreground">
                    {TOTALS.hiddenOther(formatMoney(totals.otherCost, 'USD'))}
                  </span>
                )}
              </span>
            </td>
            {moneyStart > 1 && (
              <td colSpan={moneyStart - 1} className="sticky bottom-0 z-[2] bg-muted" />
            )}
            {columns.slice(moneyStart).map((c) => {
              const key = ledgerColumnTotals[c.id as LedgerColumn];
              return (
                <td
                  key={c.id}
                  className="sticky bottom-0 z-[2] bg-muted px-1 py-2.5 text-right whitespace-nowrap tabular-nums last:pr-4"
                >
                  {key ? formatMoney(totals[key], 'USD') : null}
                </td>
              );
            })}
          </tr>
        </tfoot>
      )}
    </Table>
  );
}
