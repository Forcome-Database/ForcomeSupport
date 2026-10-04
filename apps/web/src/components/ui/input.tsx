import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 输入框（shadcn Input，按原型 input_box() 改过默认样式）：高 32、1px 深一档的边线、8 圆角、左右 10、正文字号（13，紧凑 12）；
 * 悬停边线加深；输入中主色边线 + 3px 浅主色光晕；aria-invalid 时红色边线 + 浅红光晕（字段下方另写错误）；
 * 占位符与禁用用最浅的占位色，禁用为浅灰底。
 */
/**
 * 输入类控件共用的外观：输入框、下拉选择的触发器、站点多选的触发器都用它（原型 input_box() 与 select_box() 同一套）。
 * 打开中的下拉（data-state=open）与输入中一样显示主色边线与光晕。
 */
const controlClass =
  'h-8 w-full min-w-0 rounded-md border border-input bg-card text-body text-foreground transition-colors outline-none hover:border-input-hover focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/14 data-[state=open]:border-primary data-[state=open]:ring-3 data-[state=open]:ring-primary/14 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/12 disabled:pointer-events-none disabled:border-border disabled:bg-muted disabled:text-placeholder';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        controlClass,
        'px-2.5 placeholder:text-placeholder focus:border-primary focus:ring-3 focus:ring-primary/14',
        className,
      )}
      {...props}
    />
  );
}

export { controlClass, Input };
