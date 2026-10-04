import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 按钮（shadcn Button，按设计规范板第 4、12 节改过默认样式）：
 * variant 对应原型 btn() 的 primary → default、secondary → outline、ghost、link、danger → destructive、
 * danger_outline → destructive-outline（G7「覆盖保存」、G8「放弃修改」）；
 * size：sm 28 / default 32 / lg 36，字号 12 / 13 / 14；icon 为 32 见方的图标按钮；圆角 8；焦点环 ring-2 + offset-2；
 * 禁用时浅灰底、占位色字（必须另给悬停说明原因，原型 btn(reason=)）；
 * 处理中（loading）时前面的图标换成转圈、透明度 0.85，并且不再响应点击，防止重复提交（设计规范第 4 节）。
 * 警示、浅色强调等变体第一次用到的待办按原型补上，不留未核对过的默认样式。
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:border-secondary disabled:bg-secondary disabled:text-placeholder disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          'border-primary bg-primary font-semibold text-primary-foreground shadow-pop hover:border-primary-hover hover:bg-primary-hover active:border-primary-active active:bg-primary-active active:shadow-press',
        outline:
          'border-input bg-card font-medium text-ink-2 shadow-xs hover:bg-accent active:bg-border active:shadow-press',
        ghost:
          'border-transparent bg-transparent font-medium text-muted-foreground hover:bg-accent active:bg-border active:shadow-press',
        link: 'border-transparent bg-transparent px-0.5 font-semibold text-primary underline-offset-3 hover:underline',
        destructive:
          'border-destructive bg-destructive font-semibold text-primary-foreground active:border-destructive-active active:bg-destructive-active active:shadow-press',
        'destructive-outline':
          'border-destructive-line bg-card font-medium text-destructive-text shadow-xs hover:bg-destructive-soft active:bg-destructive-soft-active active:shadow-press',
      },
      size: {
        sm: 'h-7 px-2.5 text-12',
        default: 'h-8 px-3 text-13',
        lg: "h-9 px-4 text-14 [&_svg:not([class*='size-'])]:size-4",
        /** 图标按钮（原型 icon_btn）：32 见方、图标 16，配 ghost 用于顶栏 */
        icon: "size-8 p-0 [&_svg:not([class*='size-'])]:size-4",
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
  loading = false,
  children,
  onClick,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** 处理中：把前面的图标换成转圈（调用方不再渲染自己的前置图标），点击无效 */
    loading?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }), loading && 'opacity-85')}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      {...props}
    >
      {/* asChild 时 Slot 只接受一个子元素，处理中的转圈由调用方自己放 */}
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
          {children}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
