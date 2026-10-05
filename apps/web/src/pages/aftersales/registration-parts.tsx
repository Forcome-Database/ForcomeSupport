import {
  currencies,
  ratioGroupLabels,
  ratioGroups,
  type Currency,
  type RatioGroup,
} from '@forcome/contracts';
import type * as React from 'react';
import { AffixInput } from '@/components/affix-input';
import { FieldError } from '@/components/form-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { A11Y, DRAWER, EMPTY_VALUE } from './p13-copy';
import {
  amountText,
  factoryPercents,
  formatUsdCents,
  shareCents,
  type FeeForm,
  type RatioSideForm,
} from './registration-form';

/*
 * 新建登记抽屉的部件（S14，原型 build_ledger.py 的 fsec()、money_field()、ratio_rows()）：分节标题、金额 + 币种、三组承担比例表。
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

/** 金额 + 币种（原型 money_field()：输入框右侧是 USD / CAD / MXN 的下拉，左边一条细线隔开） */
export function MoneyInput({
  id,
  label,
  value,
  onChange,
  invalid,
}: {
  id: string;
  label: string;
  value: FeeForm;
  onChange: (value: FeeForm) => void;
  invalid: boolean;
}) {
  return (
    <AffixInput
      id={id}
      inputMode="decimal"
      autoComplete="off"
      placeholder="0.00"
      value={value.amount}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      onChange={(event) => onChange({ ...value, amount: amountText(event.target.value) })}
      className="pr-1"
      suffix={
        <Select
          value={value.currency}
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
 * 金额与两方承担按美元实时算（groupCents：组里有非美元的费用时写「—」，汇率随待办 20）；比例填错的组两方承担写「—」，
 * 错误写在这一组下方，合计写「有比例错误，合计暂不计算」。
 */
export function RatioTable({
  idOf,
  ratios,
  groupAmounts,
  errors,
  onChange,
}: {
  idOf: (group: RatioGroup, side: 'fsh' | 'factory') => string;
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
