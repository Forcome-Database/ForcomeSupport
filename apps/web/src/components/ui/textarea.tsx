import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 多行输入（shadcn Textarea，按原型 textarea_box() 改过默认样式）：边线、圆角、光晕与输入框同一套；内边距 8 / 10、底部留 20 放计数，
 * 正文 13（紧凑 12）、行高 1.55；counter 时右下角写「已输入 / 上限」（11、最淡的次要色，有错误时红字）。
 */
function Textarea({
  className,
  counter,
  ...props
}: React.ComponentProps<'textarea'> & { counter?: string }) {
  return (
    <div className="relative">
      <textarea
        data-slot="textarea"
        className={cn(
          'block w-full min-w-0 resize-y rounded-md border border-input bg-card px-2.5 pt-2 pb-5 text-body leading-[1.55] text-foreground transition-colors outline-none placeholder:text-placeholder hover:border-input-hover focus:border-primary focus:ring-3 focus:ring-primary/14 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/12 disabled:pointer-events-none disabled:border-border disabled:bg-muted',
          className,
        )}
        {...props}
      />
      {counter && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute right-2.5 bottom-1.5 text-11 text-subtle-foreground',
            props['aria-invalid'] && 'text-destructive-text',
          )}
        >
          {counter}
        </span>
      )}
    </div>
  );
}

export { Textarea };
