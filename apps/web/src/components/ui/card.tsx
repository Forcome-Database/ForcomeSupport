import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 卡片（shadcn Card，按原型 card() 改过默认样式）：白底、1px 边线、12 圆角、内边距 14 / 16、
 * 间距 10、轻阴影。登录卡片（G11）等变体在使用处用令牌类名覆盖（圆角 16、阴影 card）。
 */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-2.5 rounded-lg border bg-card px-4 py-3.5 text-13 text-card-foreground shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

/** 卡片小标题（原型 label()）：12px 半粗、字距 0.03em、说明色 */
function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('text-12 font-semibold tracking-[0.03em] text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Card, CardTitle };
