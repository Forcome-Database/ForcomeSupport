import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 命令列表（shadcn Command，底下是 cmdk；设计规范组件对照「filter_chip → 筛选器为 Popover 内的 Command 列表」）：
 * 放在浮层里，内边距 5；选项与下拉菜单同一套（正文字号、次要深色字、内边距 7 / 10、6 圆角，键盘或悬停聚焦时浅灰底），
 * 选中的项浅主色底、主色字，右侧打勾（原型 S13 补充小样 option_list()）。第一期的筛选项少，不放搜索框；
 * 选人的列表（P20「从钉钉添加」的成员，人多）上方有搜索框 CommandInput（搜索图标、13 号字，下边线隔开列表）
 * 与没有匹配时的 CommandEmpty。
 */

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn('flex flex-col text-popover-foreground outline-none', className)}
      {...props}
    />
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn('max-h-75 overflow-y-auto p-1.25', className)}
      {...props}
    />
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex h-9 items-center gap-2 border-b px-3">
      <Search className="size-3.75 shrink-0 text-subtle-foreground" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent text-13 text-foreground outline-none placeholder:text-placeholder',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('px-2.5 py-1.75 text-12 text-muted-foreground', className)}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "flex cursor-default items-center justify-between gap-2 rounded-sm px-2.5 py-1.75 text-body text-ink-2 outline-none select-none data-[selected=true]:bg-accent aria-[current=true]:bg-primary-soft aria-[current=true]:text-primary-text [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandEmpty, CommandInput, CommandItem, CommandList };
