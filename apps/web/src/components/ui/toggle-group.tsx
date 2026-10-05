import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 分段控件（shadcn ToggleGroup，按原型 seg() 改过默认样式，设计规范第 12 节「seg → Tabs / ToggleGroup（胶囊样式）」）：
 * 浅灰轨道（8 圆角、内边距 3、间距 2）；选项 13 / 500 次要色、上下 4 左右 10；选中项白底、1px 边线、6 圆角、轻阴影、
 * 13 / 600 主色深字（上下 3，加上边线后与未选中的同高）。只做单选；页内切换用它，页面跳转用链接（ADR 0007 修订）。
 */
function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & { type: 'single' }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn('inline-flex items-center gap-0.5 rounded-md bg-secondary p-0.75', className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        'rounded-sm border border-transparent px-2.5 py-0.75 text-13 font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:border-border data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-primary-text data-[state=on]:shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
