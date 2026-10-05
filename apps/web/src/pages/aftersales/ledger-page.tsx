import {
  can,
  canViewFinance,
  handlingMethodLabels,
  responsibilityLabels,
  type Fee,
  type LedgerItem,
} from '@forcome/contracts';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { AftersalesStatusBadge, CategoryBadge } from '@/components/aftersales-badges';
import { EmptyState } from '@/components/empty-state';
import { LoadError } from '@/components/load-error';
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
  money,
  NEW_REGISTRATION,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  storeSite,
} from './p13-copy';
import { RegistrationDrawer } from './registration-drawer';

/*
 * P13 登记台账（第一阶段，PRD P13「第一阶段」、S13；参照图 design/spec/shots/phase1/P13_AfterSalesLog.png 与 _agent）。
 * 待办 19 是最简列表：页头（标题、说明、右上「新建登记」）+ 表格（售后单号 · 客户 · 店铺与站点 · 处理方式 · 责任 · 状态 ·
 * 产品成本 · 运费 · 额外赔偿，金额为原币），按售后单号先后（后端排好）。坐席只读：没有「新建登记」与金额列，说明换成只读的写法。
 * 完整率（21）、列设置与导出 Excel（22）、筛选与「已隐藏 N 列」（22）、快递单号 / 费用合计 / FSH 与工厂承担 / 行尾「更多」与合计行（20–22）、
 * 点售后单号打开「编辑登记」（21）随后续待办加在原型的位置上；表下的说明写的是汇率折算与承担计算，随 20、22 一起加。
 * 表格照原型 table_span()：外框圆角 8、表头 11 / 700 次要色、行上下 8；列宽照第一阶段的模板换算（含单元格内边距），
 * 还没有的「快递单号」那一列先空着占位，金额列靠右。
 */

const LOADING_ROWS = 8;

function LedgerHead({
  finance,
  canRegister,
  onNew,
}: {
  finance: boolean;
  canRegister: boolean;
  onNew: () => void;
}) {
  return (
    <div className="flex shrink-0 items-end justify-between gap-4 px-6 pt-4 pb-0.5">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-20 font-bold tracking-[-0.015em] text-foreground">{PAGE_TITLE}</h1>
        <p className="text-13 text-muted-foreground">
          {finance ? PAGE_DESCRIPTION.finance : PAGE_DESCRIPTION.readOnly}
        </p>
      </div>
      {canRegister && (
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={onNew}>
            <Plus />
            {NEW_REGISTRATION}
          </Button>
        </div>
      )}
    </div>
  );
}

function FeeCell({ fee }: { fee: Fee | null }) {
  return (
    <TableCell className="py-2 text-right">
      {fee ? (
        <span className="text-body whitespace-nowrap text-foreground tabular-nums">
          {money(fee.amount, fee.currency)}
        </span>
      ) : (
        <span className="text-body text-subtle-foreground">{EMPTY_VALUE}</span>
      )}
    </TableCell>
  );
}

function LedgerRow({ item, finance }: { item: LedgerItem; finance: boolean }) {
  return (
    <TableRow data-testid="ledger-row">
      <TableCell className="py-2">
        <span className="text-body font-semibold whitespace-nowrap text-primary">
          {item.number}
        </span>
      </TableCell>
      <TableCell className="py-2">
        <div className="truncate text-body text-foreground" title={item.customerName ?? undefined}>
          {item.customerName ?? EMPTY_VALUE}
        </div>
      </TableCell>
      <TableCell className="py-2">
        <div
          className="truncate text-minor text-ink-2"
          title={storeSite(item.store.name, item.site)}
        >
          {storeSite(item.store.name, item.site)}
        </div>
      </TableCell>
      <TableCell className="py-2">
        {item.method ? (
          <CategoryBadge>{handlingMethodLabels[item.method]}</CategoryBadge>
        ) : (
          <span className="text-body text-subtle-foreground">{EMPTY_VALUE}</span>
        )}
      </TableCell>
      <TableCell className="py-2">
        {item.responsibility ? (
          <CategoryBadge>{responsibilityLabels[item.responsibility]}</CategoryBadge>
        ) : (
          <span className="text-body text-subtle-foreground">{EMPTY_VALUE}</span>
        )}
      </TableCell>
      <TableCell className="py-2">
        <AftersalesStatusBadge status={item.status} />
      </TableCell>
      <TableCell aria-hidden className="py-2" />
      {finance && (
        <>
          <FeeCell fee={item.fees?.productCost ?? null} />
          <FeeCell fee={item.fees?.freight ?? null} />
          <FeeCell fee={item.fees?.compensation ?? null} />
        </>
      )}
    </TableRow>
  );
}

function LedgerTable({
  items,
  finance,
}: {
  items: readonly LedgerItem[] | null;
  finance: boolean;
}) {
  const columns = [
    ...Object.values(COLUMNS),
    '',
    ...(finance ? Object.values(FINANCE_COLUMNS) : []),
  ];
  return (
    <Table
      aria-label={A11Y.table}
      aria-busy={items === null}
      containerClassName="rounded-md"
      className={cn(finance && '[&_td]:px-1 [&_th]:px-1')}
    >
      {finance ? (
        <colgroup>
          <col className="w-37.5" />
          <col className="w-26" />
          <col className="w-33" />
          <col className="w-27" />
          <col className="w-24" />
          <col className="w-18" />
          <col />
          <col className="w-19.5" />
          <col className="w-17.5" />
          <col className="w-41" />
        </colgroup>
      ) : (
        <colgroup>
          <col className="w-45.5" />
          <col className="w-38" />
          <col className="w-48" />
          <col className="w-38" />
          <col className="w-35.5" />
          <col className="w-28" />
          <col />
        </colgroup>
      )}
      <TableHeader>
        <TableRow>
          {columns.map((title, index) => (
            <TableHead
              key={title || `blank-${index}`}
              aria-hidden={title === '' || undefined}
              className={cn(
                'font-bold text-muted-foreground',
                index > Object.keys(COLUMNS).length && 'text-right',
              )}
            >
              {title}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items === null ? (
          Array.from({ length: LOADING_ROWS }, (_, i) => (
            <TableRow key={i}>
              {columns.map((title, index) => (
                <TableCell key={title || `blank-${index}`} className="py-2.5">
                  {title && <Skeleton className="h-3.5 rounded-sm" />}
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
          items.map((item) => <LedgerRow key={item.id} item={item} finance={finance} />)
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
      <LedgerHead finance={finance} canRegister={canRegister} onNew={() => setCreating(true)} />
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
