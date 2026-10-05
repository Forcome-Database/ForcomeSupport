import {
  currencies,
  ratioGroupLabels,
  ratioGroups,
  type Currency,
  type RatioGroup,
} from '@forcome/contracts';
import { Pencil } from 'lucide-react';
import type * as React from 'react';
import { AffixInput } from '@/components/affix-input';
import { FieldError } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatUsdCents } from '@/lib/cents';
import { cn } from '@/lib/utils';
import { A11Y, DRAWER, EDIT, EMPTY_VALUE } from './p13-copy';
import {
  amountText,
  rateText,
  factoryPercents,
  shareCents,
  type FeeForm,
  type RatioSideForm,
} from './registration-form';

/*
 * 新建登记与编辑登记抽屉的部件（S14，原型 build_ledger.py 的 fsec()、money_field()、ratio_rows()、edit_drawer()）：分节标题、
 * 金额 + 币种、三组承担比例表，编辑登记的「修改汇率」与「1 USD = [输入框] 币种」。
 */

/** 分节（原型 fsec()）：20 的浅主色圆标写序号 + 14 / 700 标题（必填带星号），右侧 12 的灰字；节与节之间细线分隔 */
export function FormSection({
  n,
  title,
  required = false,
  note,
  first = false,
  children,
}: {
  n: number;
  title: string;
  required?: boolean;
  note?: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn('flex flex-col gap-2.5', !first && 'border-t border-border-soft pt-3')}
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-11 font-bold text-primary-text">
            {n}
          </span>
          <h3 className="text-14 font-bold text-foreground">
            {title}
            {required && (
              <span aria-hidden className="ml-0.5 text-destructive-text">
                *
              </span>
            )}
          </h3>
        </div>
        {note && <span className="text-12 whitespace-nowrap text-subtle-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** 金额 + 币种（原型 money_field()：输入框右侧是 USD / CAD / MXN 的下拉，左边一条细线隔开）；disabled 时两者都锁定 */
export function MoneyInput({
  id,
  label,
  value,
  onChange,
  invalid,
  disabled = false,
}: {
  id: string;
  label: string;
  value: FeeForm;
  onChange: (value: FeeForm) => void;
  invalid: boolean;
  disabled?: boolean;
}) {
  return (
    <AffixInput
      id={id}
      inputMode="decimal"
      autoComplete="off"
      placeholder="0.00"
      disabled={disabled}
      value={value.amount}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      onChange={(event) => onChange({ ...value, amount: amountText(event.target.value) })}
      className="pr-1"
      suffix={
        <Select
          value={value.currency}
          disabled={disabled}
          onValueChange={(currency) => {
            if (!currency) return;
            onChange({ ...value, currency: currency as Currency });
          }}
        >
          <SelectTrigger variant="inline" aria-label={A11Y.currency(label)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {currencies.map((currency) => (
              <SelectItem key={currency} value={currency}>
                {currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

const RATIO_GRID =
  'grid grid-cols-[72px_64px_minmax(0,1fr)_minmax(0,1fr)_76px_76px] items-center gap-2';

/**
 * 三组承担比例（原型 ratio_rows()）：费用组 · 金额 · FSH % · 工厂 % · FSH 承担 · 工厂承担；改一侧另一侧自动补足 100。
 * 金额与两方承担按美元实时算（groupCents：非美元按费用发生日的汇率折算，汇率还没取到或没有时这一组写「—」）；比例填错的组两方承担写「—」，
 * 错误写在这一组下方，合计写「有比例错误，合计暂不计算」。
 */
export function RatioTable({
  idOf,
  ratios,
  groupAmounts,
  errors,
  onChange,
  disabled = false,
}: {
  idOf: (group: RatioGroup, side: 'fsh' | 'factory') => string;
  /** 锁定（编辑登记里只读或补登时比例已填） */
  disabled?: boolean;
  ratios: Readonly<Record<RatioGroup, RatioSideForm>>;
  /** 各组金额（分，美元）；不能算时为 null */
  groupAmounts: Readonly<Record<RatioGroup, number | null>>;
  errors: Readonly<Partial<Record<RatioGroup, { fsh?: string; factory?: string }>>>;
  onChange: (group: RatioGroup, side: 'fsh' | 'factory', raw: string) => void;
}) {
  const percents = factoryPercents(ratios);
  // 有比例错误（保存后接口报的，或已经填了但不是 0–100 的整数）时合计暂不计算（S8、S14）
  const anyError = ratioGroups.some(
    (group) =>
      errors[group]?.fsh ||
      errors[group]?.factory ||
      (percents[group] === null && (ratios[group].fsh !== '' || ratios[group].factory !== '')),
  );
  const rows = ratioGroups.map((group) => {
    const amount = groupAmounts[group];
    const percent = percents[group];
    const groupErrors = errors[group];
    const bad = Boolean(groupErrors?.fsh || groupErrors?.factory);
    const share = amount !== null && percent !== null && !bad ? shareCents(amount, percent) : null;
    const messages = [groupErrors?.fsh, groupErrors?.factory].filter((m): m is string =>
      Boolean(m),
    );
    return { group, amount, groupErrors, bad, share, messages };
  });
  const sum = (pick: (share: { fsh: number; factory: number }) => number) =>
    rows.reduce<number | null>(
      (total, row) => (total === null || !row.share ? null : total + pick(row.share)),
      0,
    );
  const fshTotal = sum((share) => share.fsh);
  const factoryTotal = sum((share) => share.factory);
  const h = DRAWER.ratioHeaders;
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn(RATIO_GRID, 'text-11 font-semibold text-subtle-foreground')}>
        <span>{h.group}</span>
        <span className="text-right">{h.amount}</span>
        <span>{h.fsh}</span>
        <span>{h.factory}</span>
        <span className="text-right">{h.fshShare}</span>
        <span className="text-right">{h.factoryShare}</span>
      </div>
      {rows.map(({ group, amount, groupErrors, bad, share, messages }) => {
        const side = (s: 'fsh' | 'factory') => (
          <AffixInput
            id={idOf(group, s)}
            inputMode="numeric"
            autoComplete="off"
            placeholder={bad && ratios[group][s] === '' ? EMPTY_VALUE : undefined}
            aria-label={A11Y.ratio(ratioGroupLabels[group], s === 'fsh' ? h.fsh : h.factory)}
            aria-invalid={groupErrors?.[s] ? true : undefined}
            aria-describedby={messages.length > 0 ? `${idOf(group, 'factory')}-error` : undefined}
            value={ratios[group][s]}
            disabled={disabled}
            onChange={(event) => onChange(group, s, event.target.value)}
            className="h-7"
            suffix="%"
          />
        );
        return (
          <div key={group} className="flex flex-col gap-1">
            <div className={RATIO_GRID}>
              <span className="text-12 font-semibold text-ink-2">{ratioGroupLabels[group]}</span>
              <span className="text-right text-12 text-muted-foreground tabular-nums">
                {amount === null ? EMPTY_VALUE : formatUsdCents(amount)}
              </span>
              {side('fsh')}
              {side('factory')}
              <span className="text-right text-12 text-ink-2 tabular-nums">
                {share ? formatUsdCents(share.fsh) : EMPTY_VALUE}
              </span>
              <span className="text-right text-12 text-ink-2 tabular-nums">
                {share ? formatUsdCents(share.factory) : EMPTY_VALUE}
              </span>
            </div>
            {messages.length > 0 && (
              <div className="pl-36">
                <FieldError id={`${idOf(group, 'factory')}-error`} messages={messages} />
              </div>
            )}
          </div>
        );
      })}
      <div
        className={cn(
          'flex justify-end text-12 font-semibold tabular-nums',
          anyError ? 'text-destructive-text' : 'text-foreground',
        )}
      >
        {anyError
          ? DRAWER.ratioTotalError
          : DRAWER.ratioTotal(
              fshTotal === null ? EMPTY_VALUE : formatUsdCents(fshTotal),
              factoryTotal === null ? EMPTY_VALUE : formatUsdCents(factoryTotal),
            )}
      </div>
    </div>
  );
}

/**
 * 修改汇率时金额框下的那一行（S14 补充小样之三）：「1 USD = [输入框] 币种」（12 次要色、输入框高 28 宽 96、等宽数字），
 * 汇率填错的报错写在它下方
 */
export function RateInput({
  id,
  label,
  currency,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  currency: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-12 text-muted-foreground">
        <span>{EDIT.ratePrefix}</span>
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          aria-label={A11Y.rate(label)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-7 w-24 tabular-nums"
          value={value}
          onChange={(event) => onChange(rateText(event.target.value))}
        />
        <span>{currency}</span>
      </div>
      {error && <FieldError id={`${id}-error`} messages={[error]} />}
    </div>
  );
}

/**
 * 费用一节下方的「修改汇率」（S14 编辑登记小图与补充小样之三）：主色链接（带笔形图标）+ 灰字说明；点开后链接变灰不可再点；
 * 不是售后负责人时禁用并悬停说明原因
 */
export function RateLine({
  state,
  onStart,
}: {
  state: 'idle' | 'editing' | 'denied';
  onStart: () => void;
}) {
  const link =
    state === 'idle' ? (
      <Button type="button" variant="text-link" size="text" onClick={onStart}>
        {EDIT.rateLink}
        <Pencil />
      </Button>
    ) : (
      <span
        tabIndex={state === 'denied' ? 0 : undefined}
        aria-disabled
        className={cn(
          'inline-flex items-center gap-1 rounded-xs text-12 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
          state === 'denied' ? 'text-placeholder' : 'text-subtle-foreground',
        )}
      >
        {EDIT.rateLink}
        <Pencil className="size-3" />
      </span>
    );
  return (
    <div className="flex items-center gap-2">
      {state === 'denied' ? (
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent>{EDIT.rateDenied}</TooltipContent>
        </Tooltip>
      ) : (
        link
      )}
      <span className="text-12 text-subtle-foreground">{EDIT.rateNote}</span>
    </div>
  );
}
