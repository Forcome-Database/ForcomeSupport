import { Tabs as TabsPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 页签（shadcn Tabs，line 样式；按原型 tabs() 改过默认样式，设计规范第 12 节「tabs → Tabs（line 样式）：选中下划线 2px，计数用 Badge」）：
 * 一行页签、底部 1px 边线、间距 16；页签 13 / 500 次要色、上 10 下 11 左右 4；选中 13 / 600 主色深字，下方 2px 主色下划线
 * （左右各收 4、压在边线上）。计数见 TabsCount。
 * 第一个使用者是站内通知面板的「全部 · 未读」（G10，待办 31）。
 */
function Tabs(props: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex items-center gap-4 border-b', className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "group relative flex items-center gap-1.5 px-1 pt-2.5 pb-2.75 text-13 font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:font-semibold data-[state=active]:text-primary-text data-[state=active]:after:absolute data-[state=active]:after:inset-x-1 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-t-xs data-[state=active]:after:bg-primary data-[state=active]:after:content-['']",
        className,
      )}
      {...props}
    />
  );
}

/** 页签的内容（P20「成员 · 角色权限」起用）：不加样式，布局由使用处给 */
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('outline-none', className)}
      {...props}
    />
  );
}

/**
 * 页签上的计数（原型 tabs() 的计数块）：11 / 600、6 圆角、左右 5、行高 16、没有边线；选中浅主色底主色深字，未选中浅灰底灰字。
 * 设计规范的对照写「计数用 Badge」，这里有意单写：Badge 带 1px 边线、左右 7、行高 18，套用它要把这些全覆盖掉（ADR 0007 修订）
 */
function TabsCount({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="tabs-count"
      className={cn(
        'rounded-sm bg-secondary px-1.25 text-11 leading-4 font-semibold text-subtle-foreground group-data-[state=active]:bg-primary-soft group-data-[state=active]:text-primary-text',
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger };
