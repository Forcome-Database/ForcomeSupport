import { Label as LabelPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 字段名（shadcn Label，按原型 field() 的标签改过）：12 / 600、次要深色字；required 时后面跟红色星号；
 * note 是紧跟在后面的灰色短注（原型 lbl_note()，如「负责人 * 该店铺唯一的售后负责人，已默认」，常规字重、最淡的次要色）。
 */
function Label({
  className,
  required = false,
  note,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & { required?: boolean; note?: string }) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('text-12 font-semibold text-ink-2 select-none', className)}
      {...props}
    >
      {children}
      {required && (
        <span aria-hidden className="ml-0.5 text-destructive-text">
          *
        </span>
      )}
      {note && <span className="ml-1.5 font-normal text-subtle-foreground">{note}</span>}
    </LabelPrimitive.Root>
  );
}

export { Label };
