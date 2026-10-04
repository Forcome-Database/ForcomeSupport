import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 加载骨架（shadcn Skeleton，设计规范第 9 节「每个列表和面板都要设计加载状态」）：浅灰轨道色、8 圆角、呼吸动效；
 * 原型 skel() 是静止的浅灰渐变，这里用 shadcn 的脉冲代替（组件库差异）。尺寸由使用处给。
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-secondary', className)}
      {...props}
    />
  );
}

export { Skeleton };
