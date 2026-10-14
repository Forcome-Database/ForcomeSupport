import { reportPeriodLabels, reportPeriods, sites, type ReportDateRange } from '@forcome/contracts';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { ChoiceChip, RangeCalendar, type FilterOption } from '@/components/filter-chip';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { A11Y, FILTERS } from './p17-copy';
import { rangeWords } from './p17-words';
import { withFilter, type ReportsSearch } from './reports-search';

/*
 * P17 的筛选行（原型 p17_p1()、K19，K3、K4 第一阶段补充小样）：时间（近 7 天 · 本月 · 自定义，分段控件）、这次的起止、竖线、
 * 店铺 · 站点（单选芯片，没选写「全部」）。条件都在地址栏。自定义点开区间日历（同 P13、P27），点第二天即生效，今天之后的日子
 * 置灰（Q3）。加载超过 300ms 时芯片后写「正在加载 · 更新于 10:12」（K3）；条件偏离默认时芯片后「清除筛选」（K4）。
 * 「调整筛选」（K4）由页面打开这里的自定义日历，所以日历开着与否由页面保存。
 */

const siteOptions: FilterOption[] = sites.map((value) => ({ value, label: value }));

/** 时间：分段控件；「自定义」点开区间日历（选好起止才切过去） */
function PeriodControl({
  search,
  range,
  today,
  open,
  onOpenChange,
  onChange,
}: {
  search: ReportsSearch;
  range: ReportDateRange | null;
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (next: ReportsSearch) => void;
}) {
  const [start, setStart] = useState<string | null>(null);
  const period = search.period ?? '7d';
  const toggle = (next: boolean) => {
    onOpenChange(next);
    setStart(null);
  };
  return (
    <Popover open={open} onOpenChange={toggle}>
      <ToggleGroup
        type="single"
        aria-label={A11Y.period}
        value={period}
        onValueChange={(value) => {
          if (value === '7d' || value === 'month') onChange(withFilter(search, { period: value }));
        }}
      >
        {reportPeriods.map((value) =>
          value === 'custom' ? (
            <PopoverAnchor key={value} asChild>
              <ToggleGroupItem value={value} onClick={() => toggle(true)}>
                {reportPeriodLabels[value]}
              </ToggleGroupItem>
            </PopoverAnchor>
          ) : (
            <ToggleGroupItem key={value} value={value}>
              {reportPeriodLabels[value]}
            </ToggleGroupItem>
          ),
        )}
      </ToggleGroup>
      <PopoverContent className="w-auto p-0" aria-label={A11Y.customRange}>
        <RangeCalendar
          range={period === 'custom' && range ? range : null}
          start={start}
          latest={today}
          onStart={setStart}
          onPick={(picked) => {
            toggle(false);
            onChange(withFilter(search, { period: 'custom', ...picked }));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function ReportFilterBar({
  search,
  range,
  today,
  stores,
  loading,
  clearable,
  pickerOpen,
  onPickerOpenChange,
  onChange,
  onClear,
}: {
  search: ReportsSearch;
  /** 这次按的起止（接口返回；加载前为 null） */
  range: ReportDateRange | null;
  today: string;
  stores: readonly FilterOption[];
  /** 加载超过 300ms：芯片后写「正在加载 · 更新于 …」（K3）；不在加载时为 null */
  loading: string | null;
  clearable: boolean;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onChange: (next: ReportsSearch) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="report-filters">
      <PeriodControl
        search={search}
        range={range}
        today={today}
        open={pickerOpen}
        onOpenChange={onPickerOpenChange}
        onChange={onChange}
      />
      {range && (
        <span className="text-12 whitespace-nowrap text-muted-foreground tabular-nums">
          {rangeWords(range, today)}
        </span>
      )}
      <div aria-hidden className="h-4 w-px bg-border" />
      <ChoiceChip
        label={FILTERS.store}
        options={stores}
        selected={search.store}
        showAll
        onSelect={(store) => onChange(withFilter(search, { store }))}
      />
      <ChoiceChip
        label={FILTERS.site}
        options={siteOptions}
        selected={search.site}
        showAll
        onSelect={(value) =>
          onChange(withFilter(search, { site: sites.find((site) => site === value) ?? undefined }))
        }
      />
      {loading && (
        <span
          className="inline-flex items-center gap-1.5 text-12 whitespace-nowrap text-muted-foreground"
          data-testid="report-loading"
        >
          <Loader2 className="size-3.5 animate-spin text-primary" strokeWidth={2.2} />
          {loading}
        </span>
      )}
      {clearable && (
        <Button variant="text-link" size="text" onClick={onClear}>
          {FILTERS.clear}
        </Button>
      )}
    </div>
  );
}
