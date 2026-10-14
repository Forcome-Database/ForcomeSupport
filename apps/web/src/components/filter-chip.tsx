import { Check, ChevronDown, Lock } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { toDate, toValue } from '@/components/date-field';
import { Calendar } from '@/components/ui/calendar';
import { Command, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/*
 * 筛选芯片（原型 filter_chip()，P13 筛选行与 P27 共用）：高 28、8 圆角、12 / 500 次要色，「名称：值」的值 600；
 * 有值时浅主色底与描边、值为主色。单选芯片的下拉是浮层里的命令列表（设计规范「筛选器为 Popover 内的 Command 列表」），
 * 第一项「全部」清除该条件。区间日历照原型 range_picker()：起止两天实心主色，中间浅主色。
 */

const COLON = '：';
const ALL = '全部';

/** 一个选项：值与叫法 */
export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/** 筛选芯片的外观（原型 filter_chip()）；shown 是芯片上写的值，为 null 时只写名称 */
export function ChipFace({
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
          {label}
          {COLON}
          <span className={cn('font-semibold', active ? 'text-primary-text' : 'text-foreground')}>
            {shown}
          </span>
        </>
      )}
      <ChevronDown className="size-3 text-subtle-foreground" />
    </button>
  );
}

/**
 * 锁定的筛选芯片（原型 K18 ①「操作人：李婷 🔒」）：浅灰底、值 600 深色、右侧锁，不能点开；悬停说明为什么锁定
 */
export function LockedChip({
  label,
  value,
  reason,
}: {
  label: string;
  value: string;
  reason: string;
}) {
  return (
    <span
      title={reason}
      className="inline-flex h-7 items-center gap-1 rounded-md border bg-muted px-2.5 text-12 whitespace-nowrap text-muted-foreground"
    >
      {label}
      {COLON}
      <span className="font-semibold text-ink-2">{value}</span>
      <Lock className="size-3 text-subtle-foreground" />
    </span>
  );
}

/** 单选的筛选芯片：浮层里第一项「全部」清除该条件，选中的项打勾 */
export function ChoiceChip({
  label,
  options,
  selected,
  showAll = false,
  onSelect,
}: {
  label: string;
  options: readonly FilterOption[];
  selected: string | undefined;
  /** 没选时也写值「全部」（原型「店铺：全部」「操作人：全部」） */
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
          shown={current ? current.label : showAll ? ALL : null}
          active={current !== undefined}
        />
      </PopoverTrigger>
      <PopoverContent className="w-45 p-0" aria-label={label}>
        <Command>
          <CommandList>
            {item(undefined, ALL)}
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
const RANGE_END =
  '[&[data-selected=true]>button]:bg-primary [&[data-selected=true]>button]:font-bold [&[data-selected=true]>button]:text-primary-foreground [&[data-selected=true]>button]:shadow-none';
const RANGE_DAYS = {
  selected: '',
  range_start: RANGE_END,
  range_end: RANGE_END,
  range_middle:
    '[&[data-selected=true]>button]:rounded-none [&[data-selected=true]>button]:bg-primary-soft [&[data-selected=true]>button]:text-primary-text [&[data-selected=true]>button]:shadow-none',
};

/** 选好的起止（日期 `YYYY-MM-DD`，含两端） */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/**
 * 区间日历（放在浮层里）：点第一天开始新的区间，点第二天即选好（起止颠倒时对调）。
 * start 是已点的第一天（由使用方保存，浮层关闭时清掉）；latest 是能选的最后一天（P17 不能选今天之后，待办 24 Q3），之后的日子置灰，
 * 没有已选的区间时打开在它所在的月份（按服务端的今天，开发测试环境 CLOCK_START 时与浏览器不同）
 */
export function RangeCalendar({
  range,
  start,
  latest,
  onStart,
  onPick,
}: {
  range: DateRange | null;
  start: string | null;
  latest?: string;
  onStart: (day: string) => void;
  onPick: (range: DateRange) => void;
}) {
  const shown = start
    ? { from: toDate(start), to: undefined }
    : range
      ? { from: toDate(range.from), to: toDate(range.to) }
      : undefined;
  return (
    <Calendar
      mode="range"
      classNames={RANGE_DAYS}
      selected={shown}
      defaultMonth={shown?.from ?? (latest ? toDate(latest) : undefined)}
      {...(latest ? { disabled: { after: toDate(latest) } } : {})}
      onSelect={(_range, day) => {
        const picked = toValue(day);
        if (!start) {
          onStart(picked);
          return;
        }
        const [from, to] = start <= picked ? [start, picked] : [picked, start];
        onPick({ from, to });
      }}
    />
  );
}
