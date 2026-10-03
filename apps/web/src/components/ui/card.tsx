import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 卡片（shadcn Card，按原型 card() 改过默认样式）：白底、1px 边线、12 圆角、内边距 14 / 16、
 * 间距 10、轻阴影。登录卡片（G11）等变体在使用处用令牌类名覆盖（圆角 16、阴影 card）。
 * 卡片标题（原型 label()）等子组件等第一次用到的待办按原型补上。
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

export { Card };
