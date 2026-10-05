import {
  aftersalesStatusLabels,
  aftersalesStatuses,
  handlingMethodLabels,
  handlingMethods,
  responsibilities,
  responsibilityLabels,
  type FeeDateRange,
} from '@forcome/contracts';
import { Check, ChevronDown, Filter, X } from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Command, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { type ChoiceFilter, type LedgerSearch, rangeLabel } from './ledger-search';
import { EMPTY, FILTERS, MISSING_FILTER } from './p13-copy';

/*
 * P13 的筛选行（PRD P13「第一阶段」、S13 与补充小样，用户确认 10-05）：费用发生日 · 店铺 · 处理方式 · 责任 · 状态 · 负责人。
 * 芯片照原型 filter_chip()：高 28、8 圆角、12 / 500 次要色，「名称：值」的值 600；有值时浅主色底与描边、值为主色。
 * 费用发生日默认本月（接口补上，芯片写这次按的起止），点开为区间日历，选好起止即生效；其余芯片单选，下拉是浮层里的命令列表
 * （设计规范「筛选器为 Popover 内的 Command 列表」），第一项「全部」清除该条件；店铺没选时写「店铺：全部」，其余没选只写名称。
 * 条件偏离默认时右侧「清除筛选」。点完整率「筛出缺字段」后只有「缺字段的已完成单」芯片与店铺芯片（只随店铺）。
 */

/** 一个选项：值与叫法 */
export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/** 筛选芯片的外观（原型 filter_chip()）；shown 是芯片上写的值，为 null 时只写名称 */
function ChipFace({
  label,
  shown,
  active,
  ...props
}: { label: string; shown: string | null; active: boolean } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-md border pr-2 pl-2.5 text-12 font-medium whitespace-nowrap text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-primary-line bg-primary-soft hover:bg-primary-soft' : 'bg-card',
      )}
      {...props}
    >
      {shown === null ? (
        label
      ) : (
        <>
          {label}：
          <span className={cn('font-semibold', active ? 'text-primary-text' : 'text-foreground')}>
            {shown}
          </span>
        </>
      )}
      <ChevronDown className="size-3 text-subtle-foreground" />
    </button>
  );
}

/** 单选的筛选芯片：浮层里第一项「全部」清除该条件，选中的项打勾 */
function ChoiceChip({
  label,
  options,
  selected,
  showAll = false,
  onSelect,
}: {
  label: string;
  options: readonly FilterOption[];
  selected: string | undefined;
  /** 没选时也写值「全部」（店铺芯片，原型「店铺：全部」） */
  showAll?: boolean;
  onSelect: (value: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === selected);
  const pick = (value: string | undefined) => {
    setOpen(false);
    onSelect(value);
  };
  const item = (value: string | undefined, text: string) => {
    const chosen = value === current?.value;
    return (
      <CommandItem
        key={value ?? ''}
        value={value ?? ''}
        aria-current={chosen || undefined}
        onSelect={() => pick(value)}
      >
        {text}
        {chosen && <Check className="text-primary" />}
      </CommandItem>
    );
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipFace
          label={label}
          shown={current ? current.label : showAll ? FILTERS.all : null}
          active={current !== undefined}
        />
      </PopoverTrigger>
      <PopoverContent className="w-45 p-0" aria-label={label}>
        <Command>
          <CommandList>
            {item(undefined, FILTERS.all)}
            {options.map((option) => item(option.value, option.label))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 区间日历的日期格（原型 range_picker()）：起止两天主色实心白字，中间的浅主色底、主色字、不圆角；不用单选日历的「选中」样式。
 * 写在带属性的选择器里，与「今天」同时成立时以区间为准
 */
const RANGE_DAYS = {
  selected: '',
  range_start:
    '[&[data-selected=true]>button]:bg-primary [&[data-selected=true]>button]:font-bold [&[data-selected=true]>button]:text-primary-foreground [&[data-selected=true]>button]:shadow-none',
  range_end:
    '[&[data-selected=true]>button]:bg-primary [&[data-selected=true]>button]:font-bold [&[data-selected=true]>button]:text-primary-foreground [&[data-selected=true]>button]:shadow-none',
  range_middle:
    '[&[data-selected=true]>button]:rounded-none [&[data-selected=true]>button]:bg-primary-soft [&[data-selected=true]>button]:text-primary-text [&[data-selected=true]>button]:shadow-none',
};

function toDate(value: string): Date {
  const [y = 1970, m = 1, d = 1] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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
  const shown = start
    ? { from: toDate(start), to: undefined }
    : range
      ? { from: toDate(range.from), to: toDate(range.to) }
      : undefined;
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
        <Calendar
          mode="range"
          classNames={RANGE_DAYS}
          selected={shown}
          defaultMonth={shown?.from}
          onSelect={(_range, day) => {
            const picked = toValue(day);
            if (!start) {
              setStart(picked);
              return;
            }
            const [from, to] = start <= picked ? [start, picked] : [picked, start];
            setStart(null);
            setOpen(false);
            onChange({ from, to });
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
        [MISSING_FILTER.label.replace('：', ''), MISSING_FILTER.month(month)],
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
        <DateRangeChip range={range} onChange={(next) => onChange({ ...search, ...next })} />
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
