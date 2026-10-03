import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 按钮（shadcn Button，按设计规范板第 4、12 节改过默认样式）：
 * variant 对应原型 btn() 的 primary → default、secondary → outline、ghost、link；
 * size：sm 28 / default 32 / lg 36，字号 12 / 13 / 14；圆角 8；焦点环 ring-2 + offset-2；
 * 禁用时浅灰底、占位色字（必须另给悬停说明原因，原型 btn(reason=)）。
 * 危险、警示、浅色强调等变体等第一次用到的待办按原型补上，不留未核对过的默认样式。
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:border-secondary disabled:bg-secondary disabled:text-placeholder disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          'border-primary bg-primary font-semibold text-primary-foreground shadow-pop hover:border-primary-hover hover:bg-primary-hover active:border-primary-active active:bg-primary-active',
        outline:
          'border-input bg-card font-medium text-ink-2 shadow-xs hover:bg-accent active:bg-border active:shadow-press',
        ghost:
          'border-transparent bg-transparent font-medium text-muted-foreground hover:bg-accent active:bg-border active:shadow-press',
        link: 'border-transparent bg-transparent px-0.5 font-semibold text-primary underline-offset-3 hover:underline',
      },
      size: {
        sm: 'h-7 px-2.5 text-12',
        default: 'h-8 px-3 text-13',
        lg: "h-9 px-4 text-14 [&_svg:not([class*='size-'])]:size-4",
        icon: 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
