import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 滚动区（shadcn ScrollArea，设计规范第 12 节「三栏面板 · 滚动区 → ScrollArea」）：内容超出时出现细滚动条
 * （宽 10、内边距 1，拇指为 border 色的圆条），不占内容宽度。第一个使用者是站内通知面板的列表（G10，待办 31）。
 * 高度由使用处给（如 max-h-…，或放进有最大高度的纵向 flex 里），内容不超出时没有滚动条；内容宽度跟随视口，长文字照常截断。
 */
function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      // 纵向 flex：滚动区本身被外层 flex 压到最大高度以内时，视口跟着收缩并出现滚动条
      className={cn('relative flex flex-col overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        // Radix 给内容包了一层 display: table 的 div，会被不换行的内容撑宽，截断（truncate）失效；改成块级
        className="min-h-0 w-full flex-1 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:block!"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        data-slot="scroll-area-scrollbar"
        orientation="vertical"
        className="flex h-full w-2.5 touch-none border-l border-l-transparent p-px select-none"
      >
        <ScrollAreaPrimitive.Thumb
          data-slot="scroll-area-thumb"
          className="relative flex-1 rounded-full bg-border"
        />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export { ScrollArea };
