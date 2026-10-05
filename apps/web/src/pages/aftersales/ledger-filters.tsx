import {
  aftersalesStatusLabels,
  aftersalesStatuses,
  handlingMethodLabels,
  handlingMethods,
  responsibilities,
  responsibilityLabels,
  type FeeDateRange,
} from '@forcome/contracts';
import { Filter, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ChipFace, ChoiceChip, RangeCalendar, type FilterOption } from '@/components/filter-chip';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { type ChoiceFilter, type LedgerSearch, withRange } from './ledger-search';
import { EMPTY, FILTERS, MISSING_FILTER, rangeLabel } from './p13-copy';

/*
 * P13 的筛选行（PRD P13「第一阶段」、S13 与补充小样，用户确认 10-05）：费用发生日 · 店铺 · 处理方式 · 责任 · 状态 · 负责人。
 * 芯片照原型 filter_chip()（components/filter-chip.tsx，与 P27 共用）。
 * 费用发生日默认本月（接口补上，芯片写这次按的起止），点开为区间日历，选好起止即生效；其余芯片单选，下拉是浮层里的命令列表
 * （设计规范「筛选器为 Popover 内的 Command 列表」），第一项「全部」清除该条件；店铺没选时写「店铺：全部」，其余没选只写名称。
 * 条件偏离默认时右侧「清除筛选」。点完整率「筛出缺字段」后只有「缺字段的已完成单」芯片与店铺芯片（只随店铺）。
 */

/**
 * 费用发生日的芯片：写这次按的起止（「2026-09-01 至 09-11」）；点开为区间日历（原型 range_picker()：起止两天实心主色，
 * 中间浅主色），点第一天开始新的区间，点第二天即生效并关闭
 */
function DateRangeChip({
  range,
  onChange,
}: {
  range: FeeDateRange | null;
  onChange: (range: FeeDateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setStart(null);
      }}
    >
      <PopoverTrigger asChild>
        <ChipFace
          label={FILTERS.feeDate}
          shown={range ? rangeLabel(range) : null}
          active={range !== null}
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" aria-label={FILTERS.feeDate}>
        <RangeCalendar
          range={range}
          start={start}
          onStart={setStart}
          onPick={(picked) => {
            setStart(null);
            setOpen(false);
            onChange(picked);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

const methodOptions = handlingMethods.map((value) => ({
  value,
  label: handlingMethodLabels[value],
}));
const responsibilityOptions = responsibilities.map((value) => ({
  value,
  label: responsibilityLabels[value],
}));
const statusOptions = aftersalesStatuses.map((value) => ({
  value,
  label: aftersalesStatusLabels[value],
}));

/** 「当前筛选：…」里的各项（S10 的 P13 写法：「费用发生日 2026-09-01 至 09-11 · 店铺 forcome.mx · 责任 其他」） */
export function filterSummary(
  search: LedgerSearch,
  range: FeeDateRange | null,
  stores: readonly FilterOption[],
  owners: readonly FilterOption[],
  month: number,
): string[] {
  const labelOf = (options: readonly FilterOption[], value: string | undefined) =>
    options.find((option) => option.value === value)?.label;
  const parts: [string, string | undefined][] = search.missing
    ? [
        [MISSING_FILTER.name, MISSING_FILTER.month(month)],
        [FILTERS.store, labelOf(stores, search.store)],
      ]
    : [
        [FILTERS.feeDate, range ? rangeLabel(range) : undefined],
        [FILTERS.store, labelOf(stores, search.store)],
        [FILTERS.method, labelOf(methodOptions, search.method)],
        [FILTERS.responsibility, labelOf(responsibilityOptions, search.responsibility)],
        [FILTERS.status, labelOf(statusOptions, search.status)],
        [FILTERS.owner, labelOf(owners, search.owner)],
      ];
  return parts.flatMap(([label, value]) => (value ? [EMPTY.filter(label, value)] : []));
}

/**
 * 筛选行：左边各芯片，右边（条件偏离默认时）「清除筛选」。筛出缺字段时左边是「缺字段的已完成单：9 月」（× 移除这条筛选，保留店铺）
 * 与店铺芯片。
 */
export function LedgerFilterBar({
  search,
  range,
  defaultRange,
  month,
  stores,
  owners,
  clearable,
  onChange,
  onClear,
}: {
  search: LedgerSearch;
  /** 这次按的费用发生日（接口返回；加载前为 null） */
  range: FeeDateRange | null;
  /** 默认的本月（接口返回；选到它时地址栏不写起止） */
  defaultRange: FeeDateRange | undefined;
  /** 完整率的月份（「缺字段的已完成单：9 月」） */
  month: number;
  stores: readonly FilterOption[];
  owners: readonly FilterOption[];
  clearable: boolean;
  onChange: (next: LedgerSearch) => void;
  onClear: () => void;
}) {
  const choose = (key: ChoiceFilter) => (value: string | undefined) =>
    onChange({ ...search, [key]: value });
  const storeChip = (
    <ChoiceChip
      label={FILTERS.store}
      options={stores}
      selected={search.store}
      showAll
      onSelect={choose('store')}
    />
  );
  let chips: ReactNode;
  if (search.missing) {
    chips = (
      <>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-primary-line bg-primary-soft pr-1.5 pl-2 text-12 font-medium whitespace-nowrap text-muted-foreground">
          <Filter className="size-3.25 text-primary-text" />
          {MISSING_FILTER.label}
          <span className="font-semibold text-primary-text">{MISSING_FILTER.month(month)}</span>
          <button
            type="button"
            title={MISSING_FILTER.remove}
            aria-label={MISSING_FILTER.remove}
            onClick={() => onChange({ store: search.store })}
            className="flex rounded-xs p-0.5 text-primary-text outline-none hover:bg-primary-line focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3" strokeWidth={2} />
          </button>
        </span>
        {storeChip}
      </>
    );
  } else {
    chips = (
      <>
        <DateRangeChip
          range={range}
          onChange={(next) => onChange(withRange(search, next, defaultRange))}
        />
        {storeChip}
        <ChoiceChip
          label={FILTERS.method}
          options={methodOptions}
          selected={search.method}
          onSelect={choose('method')}
        />
        <ChoiceChip
          label={FILTERS.responsibility}
          options={responsibilityOptions}
          selected={search.responsibility}
          onSelect={choose('responsibility')}
        />
        <ChoiceChip
          label={FILTERS.status}
          options={statusOptions}
          selected={search.status}
          onSelect={choose('status')}
        />
        <ChoiceChip
          label={FILTERS.owner}
          options={owners}
          selected={search.owner}
          onSelect={choose('owner')}
        />
      </>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3" data-testid="ledger-filters">
      <div className="flex flex-wrap items-center gap-2">{chips}</div>
      {clearable && (
        <Button variant="text-link" size="text" onClick={onClear}>
          {FILTERS.clear}
        </Button>
      )}
    </div>
  );
}
