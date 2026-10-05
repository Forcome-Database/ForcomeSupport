import {
  aftersalesActions,
  formatMoney,
  formatRate,
  formatRateDate,
  handlingMethodLabels,
  missingItemLabels,
  partLabel,
  ratioGroupWords,
  ratioWords,
  responsibilityLabels,
  uniformRatio,
  type CurrentMember,
  type FeeItem,
  type LedgerItem,
  type RegistrationField,
} from '@forcome/contracts';
import type { ReactNode } from 'react';
import { AftersalesStatusBadge, CategoryBadge } from '@/components/aftersales-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { A11Y, EMPTY_VALUE, FOREIGN_AMOUNT, MISSING, NOT_KEPT, SHARE, storeSite } from './p13-copy';

/*
 * P13 台账的单元格（原型 build_ledger 的 p1_cells()、S13 与补充小样）：售后单号（「缺 N 项」）、文字列、快递单号（「待回填」与行内补登）、
 * 金额（美元值，非美元另起一行写原币与汇率日期；已取消的单只计保留的部分）、费用合计、FSH / 工厂承担（悬停写三组比例）。
 * 已完成的单缺的字段标黄「待回填」，其余没有值的写「—」（AC-AS-22）。
 */

/** 行内补登的状态与动作（一次只编辑一格） */
export interface InlineBackfill {
  readonly editing: string | null;
  readonly draft: string;
  readonly saving: boolean;
  readonly setDraft: (value: string) => void;
  readonly start: (id: string) => void;
  readonly cancel: () => void;
  readonly save: (item: LedgerItem) => Promise<void>;
}

/** 单元格要用的上下文：查看者、行内补登的状态与动作、打开抽屉 */
export interface CellContext {
  readonly member: CurrentMember;
  readonly backfill: InlineBackfill;
  readonly open: (number: string) => void;
}

export const EMPTY = <span className="text-body text-subtle-foreground">{EMPTY_VALUE}</span>;
const PENDING = <Badge tone="warning">{MISSING.pending}</Badge>;

/** 这一格的字段缺了要标「待回填」吗：只对已完成的单（后端按 R-AS-08 算好的 missing，进行中为空） */
const isPending = (item: LedgerItem, field: RegistrationField) => item.missing.includes(field);

/** 有值写值；已完成缺这个字段写「待回填」；其余写「—」 */
function valueOr(item: LedgerItem, field: RegistrationField, value: ReactNode): ReactNode {
  if (value !== null && value !== undefined && value !== '') return value;
  return isPending(item, field) ? PENDING : EMPTY;
}

/** 一行省略的文字（过长时悬停看全文） */
function text(value: string, className = 'text-body text-foreground') {
  return (
    <div className={cn('truncate', className)} title={value}>
      {value}
    </div>
  );
}

/** 售后单号（原型 no_cell()）：13 / 600 主色，点开「编辑登记」；已完成缺适用字段时下方「缺 N 项」，悬停列出缺的字段 */
export function numberCell(item: LedgerItem, ctx: CellContext): ReactNode {
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

export const customerCell = (item: LedgerItem) =>
  valueOr(item, 'customerName', item.customerName && text(item.customerName));

export function storeSiteCell(item: LedgerItem): ReactNode {
  const label = storeSite(item.store.name, item.site);
  return (
    <div className="flex min-w-0 items-center gap-1">
      {text(label, 'text-minor text-ink-2')}
      {isPending(item, 'site') && PENDING}
    </div>
  );
}

export const methodCell = (item: LedgerItem) =>
  valueOr(
    item,
    'method',
    item.method && <CategoryBadge>{handlingMethodLabels[item.method]}</CategoryBadge>,
  );

export const responsibilityCell = (item: LedgerItem) =>
  valueOr(
    item,
    'responsibility',
    item.responsibility && (
      <CategoryBadge>{responsibilityLabels[item.responsibility]}</CategoryBadge>
    ),
  );

export const statusCell = (item: LedgerItem) => <AftersalesStatusBadge status={item.status} />;

/** 负责人（默认隐藏的列） */
export const ownerCell = (item: LedgerItem) =>
  valueOr(item, 'ownerId', item.ownerName && text(item.ownerName));

/** 生产厂（默认隐藏的列；R-AS-08 的必填字段，缺时计入「缺 N 项」） */
export const factoryCell = (item: LedgerItem) =>
  valueOr(item, 'factory', item.factory && text(item.factory));

/** 配件 × 数量（默认隐藏的列）：「HEPA 滤芯组件 FC-V2-HF01 × 1」，过长省略、悬停看全文 */
export const partCell = (item: LedgerItem) =>
  valueOr(item, 'part', item.part && text(partLabel(item.part), 'text-minor text-ink-2'));

/**
 * 快递单号（原型 p1_tracking()）：有单号写单号（12 主色、过长省略）；已完成缺单号写「待回填」，售后负责人旁边「补登」，
 * 点它在这一格行内编辑（S15 ③）；其余写「—」（进行中还没寄出，AC-AS-22；不是寄配件）
 */
export function trackingCell(item: LedgerItem, ctx: CellContext): ReactNode {
  if (item.trackingNumber) {
    return text(item.trackingNumber, 'text-minor text-primary tabular-nums');
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

/** 美元金额（13 正文色、等宽数字；weight 给费用合计加粗） */
function usd(amount: string, className?: string) {
  return (
    <span className={cn('text-body whitespace-nowrap text-foreground tabular-nums', className)}>
      {formatMoney(amount, 'USD')}
    </span>
  );
}

/**
 * 金额（原型 p1_val()、p1_comp()，R-FL-06）：写冻结的美元值；非美元在下方另起一行写原币与汇率日期
 * （11 浅灰，例「MX$889.00 · 汇率 09-10」），悬停说明汇率怎么来的（手工修改的另写，S14 补充小样之二）。列窄时这一行在「·」处换行。
 * 已取消的单没保留的项写「$0.00」，悬停原登记额（S13 补充小样，R-AS-08）。没登记的：已完成的单写「待回填」，其余写「—」。
 */
export function feeCell(item: LedgerItem, key: FeeItem): ReactNode {
  const fee = item.fees?.[key];
  if (!fee) return isPending(item, `fees.${key}`) ? PENDING : EMPTY;
  if (item.keptFees && !item.keptFees.includes(key)) {
    return (
      <span title={NOT_KEPT(formatMoney(fee.usd, 'USD'))}>{usd(item.cost?.[key] ?? '0.00')}</span>
    );
  }
  if (!fee.rate) return usd(fee.usd);
  return (
    <div
      className="flex flex-col items-end"
      title={
        fee.rate.source === 'manual'
          ? FOREIGN_AMOUNT.manualTitle(formatRate(fee.rate.rate), fee.currency)
          : FOREIGN_AMOUNT.publishedTitle
      }
    >
      {usd(fee.usd)}
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

/** 费用合计（13 / 600）：计入售后成本的四项之和 */
export const feeTotalCell = (item: LedgerItem) =>
  item.cost ? usd(item.cost.total, 'font-semibold') : EMPTY;

/**
 * FSH / 工厂承担（原型 p1_share()）：按三组比例算出的金额，第一期不带「≈」；悬停写比例——三组相同「三组均 FSH 0 / 工厂 100」，
 * 不同时第一行「按费用项」、下面逐组列出（S13 补充小样）。比例没登记（历史导入）时同其他缺的字段。
 */
export function shareCell(item: LedgerItem, side: 'fsh' | 'factory'): ReactNode {
  const amount = item.cost?.[side];
  if (!item.ratios || amount === null || amount === undefined) return valueOr(item, 'ratios', null);
  const title = uniformRatio(item.ratios)
    ? ratioWords(item.ratios)
    : [SHARE.byItem, ...ratioGroupWords(item.ratios)].join('\n');
  return <span title={title}>{usd(amount)}</span>;
}
