import {
  DEFAULT_TICKET_INBOUND_PERIOD,
  messageSourceLabels,
  sites,
  ticketChannelLabels,
  ticketChannels,
  ticketInboundPeriodLabels,
  ticketInboundPeriods,
  ticketSources,
  ticketStatuses,
  ticketStatusLabels,
  type TicketDateRange,
  type TicketDrill,
  type TicketInboundPeriod,
} from '@forcome/contracts';
import { ChartColumn, Check, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ChipFace, ChoiceChip, RangeCalendar, type FilterOption } from '@/components/filter-chip';
import { Button } from '@/components/ui/button';
import { Command, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { A11Y, DRILL, FILTERS } from './p04-copy';
import { drillChipWords, inboundWords } from './p04-words';
import { withFilter, withoutDrill, type ChoiceFilter, type TicketsSearch } from './tickets-search';

/*
 * P04 的筛选行（原型 build_tickets.p1_filters()、I16、I10）：状态 · 渠道 · 店铺 · 站点 · 来源 · 最近来信（近 30 天，主色浅底），
 * 条件偏离默认时芯片后「清除筛选」（I10；下钻时「清除筛选」在计数行右侧，这里不重复）；右侧是客服主管的「未归属店铺 N」入口。
 * 从报表下钻进入时最前面多一枚可移除的「来自报表：条件 ×」芯片（原型 drill_chip()），与其余芯片之间一条竖线。
 * 最近来信的下拉：今天 · 近 7 天 · 近 30 天 · 近 90 天 · 自定义（Q1，没有「全部」）；自定义点开区间日历（同 P13、P27），
 * 点第二天即生效。
 */

const statusOptions: FilterOption[] = ticketStatuses.map((value) => ({
  value,
  label: ticketStatusLabels[value],
}));
const channelOptions: FilterOption[] = ticketChannels.map((value) => ({
  value,
  label: ticketChannelLabels[value],
}));
const siteOptions: FilterOption[] = sites.map((value) => ({ value, label: value }));
const sourceOptions: FilterOption[] = ticketSources.map((value) => ({
  value,
  label: messageSourceLabels[value],
}));

/** 最近来信：几种「近 N 天」与自定义（自定义点开区间日历，选好起止才生效） */
function InboundChip({
  period,
  range,
  onChange,
}: {
  period: TicketInboundPeriod;
  /** 这次按的起止（接口返回；加载前为 null） */
  range: TicketDateRange | null;
  onChange: (next: { inbound: TicketInboundPeriod; from?: string; to?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  const toggle = (next: boolean) => {
    setOpen(next);
    setPicking(false);
    setStart(null);
  };
  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <ChipFace label={FILTERS.inbound} shown={inboundWords(period, range)} active />
      </PopoverTrigger>
      <PopoverContent
        className={picking ? 'w-auto p-0' : 'w-45 p-0'}
        aria-label={picking ? A11Y.customRange : FILTERS.inbound}
      >
        {picking ? (
          <RangeCalendar
            range={period === 'custom' ? range : null}
            start={start}
            onStart={setStart}
            onPick={(picked) => {
              toggle(false);
              onChange({ inbound: 'custom', ...picked });
            }}
          />
        ) : (
          <Command>
            <CommandList>
              {ticketInboundPeriods.map((value) => (
                <CommandItem
                  key={value}
                  value={value}
                  aria-current={value === period || undefined}
                  onSelect={() => {
                    if (value === 'custom') {
                      setPicking(true);
                      return;
                    }
                    toggle(false);
                    onChange({ inbound: value });
                  }}
                >
                  {ticketInboundPeriodLabels[value]}
                  {value === period && <Check className="text-primary" />}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** 「来自报表：条件 ×」（原型 drill_chip()：浅主色底与描边，图表图标与值为主色深一档，× 移除这条筛选） */
function DrillChip({ words, onRemove }: { words: string; onRemove: () => void }) {
  return (
    <span
      data-testid="drill-chip"
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-primary-line bg-primary-soft pr-1.5 pl-2 text-12 font-medium whitespace-nowrap text-muted-foreground"
    >
      <ChartColumn className="size-3.25 text-primary-text" />
      {DRILL.chip}：<span className="font-semibold text-primary-text">{words}</span>
      <button
        type="button"
        title={DRILL.remove}
        aria-label={DRILL.remove}
        onClick={onRemove}
        className="flex rounded-xs p-0.5 text-primary-text outline-none hover:bg-primary-line focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3" strokeWidth={2} />
      </button>
    </span>
  );
}

export function TicketFilterBar({
  search,
  inbound,
  drill,
  today,
  stores,
  clearable,
  entry,
  onChange,
  onClear,
}: {
  search: TicketsSearch;
  /** 这次按的最近来信（接口返回；加载前为 null） */
  inbound: TicketDateRange | null;
  drill: TicketDrill | null;
  /** 今天（服务端时钟的北京时间日期；下钻芯片的日期按它决定写不写年份） */
  today: string;
  stores: readonly FilterOption[];
  /** 筛选行上的「清除筛选」（条件偏离默认、且不是下钻——下钻时它在计数行右侧） */
  clearable: boolean;
  /** 右侧客服主管的「未归属店铺 N」入口；其他成员没有 */
  entry: ReactNode;
  onChange: (next: TicketsSearch) => void;
  onClear: () => void;
}) {
  const choose = (key: ChoiceFilter) => (value: string | undefined) =>
    onChange(withFilter(search, { [key]: value }));
  return (
    <div className="flex min-h-7 items-center justify-between gap-3" data-testid="ticket-filters">
      <div className="flex flex-wrap items-center gap-1.5">
        {drill && (
          <>
            <DrillChip
              words={drillChipWords(drill, today)}
              onRemove={() => onChange(withoutDrill(search))}
            />
            <div aria-hidden className="mx-0.5 h-5 w-px bg-border" />
          </>
        )}
        <ChoiceChip
          label={FILTERS.status}
          options={statusOptions}
          selected={search.status}
          onSelect={choose('status')}
        />
        <ChoiceChip
          label={FILTERS.channel}
          options={channelOptions}
          selected={search.channel}
          onSelect={choose('channel')}
        />
        <ChoiceChip
          label={FILTERS.store}
          options={stores}
          selected={search.store}
          onSelect={choose('store')}
        />
        <ChoiceChip
          label={FILTERS.site}
          options={siteOptions}
          selected={search.site}
          onSelect={choose('site')}
        />
        <ChoiceChip
          label={FILTERS.source}
          options={sourceOptions}
          selected={search.source}
          onSelect={choose('source')}
        />
        <InboundChip
          period={search.inbound ?? DEFAULT_TICKET_INBOUND_PERIOD}
          range={inbound}
          onChange={({ inbound: period, from, to }) =>
            onChange(
              withFilter(search, {
                inbound: period === DEFAULT_TICKET_INBOUND_PERIOD ? undefined : period,
                from,
                to,
              }),
            )
          }
        />
        {clearable && (
          <Button variant="text-link" size="text" className="ml-1.5" onClick={onClear}>
            {FILTERS.clear}
          </Button>
        )}
      </div>
      {entry}
    </div>
  );
}
