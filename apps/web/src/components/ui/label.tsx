import { Label as LabelPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 字段名（shadcn Label，按原型 field() 的标签改过）：12 / 600、次要深色字；required 时后面跟红色星号。
 */
function Label({
  className,
  required = false,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & { required?: boolean }) {
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
    </LabelPrimitive.Root>
  );
}

export { Label };
