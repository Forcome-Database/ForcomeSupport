import {
  AUDIT_SEARCH_MAX,
  auditActionFilterOptions,
  auditObjectTypeLabels,
  auditPeriods,
  phase1AuditObjectTypes,
  type AuditPeriod,
  type AuditRange,
} from '@forcome/contracts';
import { Link2, Search } from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';
import { ChoiceChip, LockedChip, RangeCalendar, type FilterOption } from '@/components/filter-chip';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { withFilter, type AuditSearch } from './audit-search';
import { A11Y, FILTERS, OWN_ONLY, PERIODS } from './p27-copy';

/*
 * P27 的筛选行（原型 build_audit.audit_filters()、K18、补充小样 ④）：时间（今天 · 近 7 天 · 自定义，分段控件）| 操作人 ·
 * 对象类型 · 动作（单选芯片，没选写「全部」）· 对象编号搜索；右侧「筛选条件写在地址栏」。条件都在地址栏（PRD P27）。
 * 只能看自己的角色，操作人芯片锁定为本人（K18 ①）。自定义点开为区间日历（同 P13 费用发生日），点第二天即生效。
 * 选了对象类型后动作只列该类型的动作与越权访问被拒；已选的动作不属于新类型时清掉。
 */

const typeOptions: FilterOption[] = phase1AuditObjectTypes.map((type) => ({
  value: type,
  label: auditObjectTypeLabels[type],
}));

/** 搜索框输入后多久写进地址栏 */
const SEARCH_DELAY_MS = 300;

/** 时间：分段控件；「自定义」点开区间日历（选好起止才切过去） */
function PeriodControl({
  search,
  range,
  onChange,
}: {
  search: AuditSearch;
  range: AuditRange | null;
  onChange: (next: AuditSearch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  const period: AuditPeriod = search.period ?? 'today';
  const close = (next: boolean) => {
    setOpen(next);
    setStart(null);
  };
  return (
    <Popover open={open} onOpenChange={close}>
      <ToggleGroup
        type="single"
        aria-label={A11Y.period}
        value={period}
        onValueChange={(value) => {
          if (value === 'today' || value === 'week') {
            onChange(withFilter(search, { period: value, from: undefined, to: undefined }));
          }
        }}
      >
        {auditPeriods.map((value) =>
          value === 'custom' ? (
            <PopoverAnchor key={value} asChild>
              <ToggleGroupItem value={value} onClick={() => close(true)}>
                {PERIODS[value]}
              </ToggleGroupItem>
            </PopoverAnchor>
          ) : (
            <ToggleGroupItem key={value} value={value}>
              {PERIODS[value]}
            </ToggleGroupItem>
          ),
        )}
      </ToggleGroup>
      <PopoverContent className="w-auto p-0" aria-label={A11Y.customRange}>
        <RangeCalendar
          range={period === 'custom' && range ? range : null}
          start={start}
          onStart={setStart}
          onPick={(picked) => {
            close(false);
            onChange(withFilter(search, { period: 'custom', ...picked }));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** 对象编号搜索（原型 search_box()：宽 200、高 32，没填时浅灰底）；输入停 300ms 后写进地址栏 */
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  // 地址栏变了（清除筛选、回退）时跟上（渲染时调整，不经 effect）
  if (value !== shown) {
    setShown(value);
    setDraft(value);
  }
  const search = useEffectEvent((q: string) => onSearch(q));
  useEffect(() => {
    if (draft.trim() === value) return;
    const timer = setTimeout(() => search(draft.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, value]);
  // 原型 search_box() 与 input_box() 不同：边线是浅的一档（--border），没填时浅灰底，左侧搜索图标
  return (
    <div className="relative w-50">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.75 -translate-y-1/2 text-subtle-foreground" />
      <Input
        type="search"
        value={draft}
        maxLength={AUDIT_SEARCH_MAX}
        placeholder={FILTERS.search}
        aria-label={FILTERS.search}
        onChange={(event) => setDraft(event.target.value)}
        className={cn(
          'border-border pr-2 pl-8.5 [&::-webkit-search-cancel-button]:hidden',
          draft ? 'bg-card' : 'bg-muted',
        )}
      />
    </div>
  );
}

export function AuditFilterBar({
  search,
  range,
  actors,
  lockedActor,
  onChange,
}: {
  search: AuditSearch;
  /** 这次按的时间（接口返回；加载前为 null） */
  range: AuditRange | null;
  actors: readonly FilterOption[];
  /** 只能看自己的角色：操作人锁定为本人（写本人姓名） */
  lockedActor: string | null;
  onChange: (next: AuditSearch) => void;
}) {
  const actions = auditActionFilterOptions(search.type);
  return (
    <div className="flex items-center justify-between gap-3" data-testid="audit-filters">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodControl search={search} range={range} onChange={onChange} />
        <div aria-hidden className="h-4 w-px bg-border" />
        {lockedActor !== null ? (
          <LockedChip label={FILTERS.actor} value={lockedActor} reason={OWN_ONLY.title} />
        ) : (
          <ChoiceChip
            label={FILTERS.actor}
            options={actors}
            selected={search.actor}
            showAll
            onSelect={(actor) => onChange(withFilter(search, { actor }))}
          />
        )}
        <ChoiceChip
          label={FILTERS.type}
          options={typeOptions}
          selected={search.type}
          showAll
          onSelect={(value) => {
            const type = typeOptions.find((option) => option.value === value)?.value as
              AuditSearch['type'] | undefined;
            const keep =
              search.action &&
              auditActionFilterOptions(type).some((option) => option.value === search.action);
            onChange(withFilter(search, { type, action: keep ? search.action : undefined }));
          }}
        />
        <ChoiceChip
          label={FILTERS.action}
          options={actions}
          selected={search.action}
          showAll
          onSelect={(action) => onChange(withFilter(search, { action }))}
        />
        <SearchBox
          value={search.q ?? ''}
          onSearch={(q) => onChange(withFilter(search, { q: q || undefined }))}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1 text-12 whitespace-nowrap text-subtle-foreground">
        <Link2 className="size-3.25" />
        {FILTERS.urlNote}
      </div>
    </div>
  );
}
