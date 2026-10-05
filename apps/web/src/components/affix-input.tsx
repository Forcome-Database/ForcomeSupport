import type * as React from 'react';
import { controlClass } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/*
 * 带后缀的输入框（原型 input_box(suffix=…)）：外框与输入框同一套，输入中、报错时的边线与光晕跟着里面的输入框走；
 * 右侧是后缀——比例的「%」、数量的「件 · 1–10」写成 12 的最淡次要色文字，金额的币种是一个下拉（由使用处放进来）。
 * 数字用等宽（tabular-nums）。h 给高度（比例表里是 28）。输入框禁用时外框同输入框的禁用（浅色边线、浅灰底、占位色字）。
 */
export function AffixInput({
  suffix,
  className,
  inputClassName,
  ...props
}: React.ComponentProps<'input'> & {
  suffix: React.ReactNode;
  inputClassName?: string;
}) {
  return (
    <div
      className={cn(
        controlClass,
        'flex items-center gap-2 pr-2.5 pl-2.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/14 has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:ring-3 has-[input[aria-invalid=true]]:ring-destructive/12 has-[input:disabled]:border-border has-[input:disabled]:bg-muted',
        className,
      )}
    >
      <input
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent text-body text-foreground tabular-nums outline-none placeholder:text-placeholder disabled:text-placeholder',
          inputClassName,
        )}
        {...props}
      />
      {typeof suffix === 'string' ? (
        <span className="shrink-0 text-12 text-subtle-foreground">{suffix}</span>
      ) : (
        suffix
      )}
    </div>
  );
}
