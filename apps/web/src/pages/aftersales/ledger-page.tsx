import {
  can,
  canViewFinance,
  formatMoney,
  formatRateDate,
  handlingMethodLabels,
  responsibilityLabels,
  type Fee,
  type FeeItem,
  type LedgerItem,
} from '@forcome/contracts';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { AftersalesStatusBadge, CategoryBadge } from '@/components/aftersales-badges';
import { EmptyState } from '@/components/empty-state';
import { LoadError } from '@/components/load-error';
import { PageHead } from '@/components/page-head';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ledgerQuery } from '@/lib/aftersales';
import { useCurrentMember } from '@/lib/current-member';
import { cn } from '@/lib/utils';
import {
  A11Y,
  COLUMNS,
  EMPTY_TITLE,
  EMPTY_VALUE,
  FINANCE_COLUMNS,
  FOREIGN_AMOUNT,
  NEW_REGISTRATION,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  storeSite,
} from './p13-copy';
import { RegistrationDrawer } from './registration-drawer';

/*
 * P13 登记台账（第一阶段，PRD P13「第一阶段」、S13；参照图 design/spec/shots/phase1/P13_AfterSalesLog.png 与 _agent）。
 * 最简列表：页头（标题、说明、右上「新建登记」）+ 表格（售后单号 · 客户 · 店铺与站点 · 处理方式 · 责任 · 状态 ·
 * 快递单号 · 产品成本 · 运费 · 额外赔偿；金额写冻结的美元值，非美元下方写原币与汇率日期，待办 20），按售后单号先后（后端排好）。
 * 坐席只读：没有「新建登记」与金额列，说明换成只读的写法。
 * 完整率（21）、列设置与导出 Excel（22）、筛选与「已隐藏 N 列」（22）、费用合计 / FSH 与工厂承担 / 行尾「更多」与合计行（21、22）、
 * 快递单号的「待回填」与补登（21）、点售后单号打开「编辑登记」（21）随后续待办加在原型的位置上；表下的说明是一段话，
 * 同时写汇率折算、承担计算、待回填与行尾「更多」，等这些都有了随 22 一起加。表格照原型 table_span()：外框圆角 8、表头 11 / 700 次要色、行上下 8；列宽照第一阶段的两个模板
 * （售后负责人：列间距 8；坐席：列间距 12）换算，含单元格内边距；快递单号这一列占剩余宽度（原型 minmax(0, 1fr)）。
 */

const LOADING_ROWS = 8;

const EMPTY = <span className="text-body text-subtle-foreground">{EMPTY_VALUE}</span>;

/** 一列：表头、对齐、两种视角的列宽（空串为占剩余宽度）、单元格 */
interface Column {
  readonly key: string;
  readonly title: string;
  readonly align: 'left' | 'right';
  /** 售后负责人、客服主管视角（有金额列）与坐席视角的列宽 */
  readonly width: { readonly finance: string; readonly readOnly: string };
  readonly cell: (item: LedgerItem) => ReactNode;
}

const BASE_COLUMNS: readonly Column[] = [
  {
    key: 'number',
    title: COLUMNS.number,
    align: 'left',
    width: { finance: 'w-37.5', readOnly: 'w-45.5' },
    cell: (item) => (
      <span className="text-body font-semibold whitespace-nowrap text-primary">{item.number}</span>
    ),
  },
  {
    key: 'customer',
    title: COLUMNS.customer,
    align: 'left',
    width: { finance: 'w-26', readOnly: 'w-38' },
    cell: (item) => (
      <div className="truncate text-body text-foreground" title={item.customerName ?? undefined}>
        {item.customerName ?? EMPTY_VALUE}
      </div>
    ),
  },
  {
    key: 'storeSite',
    title: COLUMNS.storeSite,
    align: 'left',
    width: { finance: 'w-33', readOnly: 'w-48' },
    cell: (item) => (
      <div className="truncate text-minor text-ink-2" title={storeSite(item.store.name, item.site)}>
        {storeSite(item.store.name, item.site)}
      </div>
    ),
  },
  {
    key: 'method',
    title: COLUMNS.method,
    align: 'left',
    width: { finance: 'w-27', readOnly: 'w-38' },
    cell: (item) =>
      item.method ? <CategoryBadge>{handlingMethodLabels[item.method]}</CategoryBadge> : EMPTY,
  },
  {
    key: 'responsibility',
    title: COLUMNS.responsibility,
    align: 'left',
    width: { finance: 'w-24', readOnly: 'w-35.5' },
    cell: (item) =>
      item.responsibility ? (
        <CategoryBadge>{responsibilityLabels[item.responsibility]}</CategoryBadge>
      ) : (
        EMPTY
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
    // 原型 p1_tracking()：有单号写单号（12 主色、过长省略），没有写「—」；已完成缺单号的「待回填」与补登随 21
    key: 'trackingNumber',
    title: COLUMNS.trackingNumber,
    align: 'left',
    width: { finance: '', readOnly: '' },
    cell: (item) =>
      item.trackingNumber ? (
        <div className="truncate text-minor text-primary tabular-nums" title={item.trackingNumber}>
          {item.trackingNumber}
        </div>
      ) : (
        EMPTY
      ),
  },
];

/**
 * 金额（原型 p1_val()、p1_comp()，R-FL-06）：写冻结的美元值（13 正文色）；非美元在下方另起一行写原币与汇率日期
 * （11 浅灰，例「MX$889.00 · 汇率 09-10」），悬停说明汇率怎么来的。列窄时这一行在「·」处换行（原型只在宽的「额外赔偿」
 * 列画过一行写完的样子）。没登记写「—」。
 */
function feeCell(fee: Fee | null | undefined): ReactNode {
  if (!fee) return EMPTY;
  const usd = (
    <span className="text-body whitespace-nowrap text-foreground tabular-nums">
      {formatMoney(fee.usd, 'USD')}
    </span>
  );
  if (!fee.rate) return usd;
  return (
    <div className="flex flex-col items-end" title={FOREIGN_AMOUNT.title}>
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
  cell: (item) => feeCell(item.fees?.[key]),
});

const FINANCE_ONLY: readonly Column[] = [
  feeColumn('productCost', 'w-19.5'),
  feeColumn('freight', 'w-17.5'),
  feeColumn('compensation', 'w-41'),
];

function LedgerTable({
  items,
  finance,
}: {
  items: readonly LedgerItem[] | null;
  finance: boolean;
}) {
  const columns = finance ? [...BASE_COLUMNS, ...FINANCE_ONLY] : BASE_COLUMNS;
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
          items.map((item) => (
            <TableRow key={item.id} data-testid="ledger-row">
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn('py-2', column.align === 'right' && 'text-right')}
                >
                  {column.cell(item)}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export function LedgerPage() {
  const member = useCurrentMember();
  const finance = canViewFinance(member.roles);
  const canRegister = can(member.roles, 'aftersales.register');
  const ledger = useQuery(ledgerQuery);
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title={PAGE_TITLE}
        description={finance ? PAGE_DESCRIPTION.finance : PAGE_DESCRIPTION.readOnly}
        actions={
          canRegister && (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {NEW_REGISTRATION}
            </Button>
          )
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-6 pt-3.5 pb-3.5">
        {ledger.isError ? (
          <LoadError onRetry={() => void ledger.refetch()} />
        ) : (
          <LedgerTable items={ledger.isPending ? null : ledger.data} finance={finance} />
        )}
      </div>
      {canRegister && creating && (
        <RegistrationDrawer registrar={member} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
