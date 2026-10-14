import { Ellipsis } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/*
 * 表格行尾的「更多 ⋯」菜单（原型 more_cell()；P13 台账、P20 成员表共用）：触发按钮打开时为浅主色底与描边；
 * 不可用的项禁用并悬停写原因（ADR 0007「待办 21 落地」修订：BlockedItem）。
 */

/** 行尾「更多 ⋯」的触发按钮（放在 DropdownMenu 里） */
export function RowMenuTrigger({ label }: { label: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={label}
        className="flex size-6 items-center justify-center rounded-sm text-subtle-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-primary-soft data-[state=open]:text-primary-text data-[state=open]:ring-1 data-[state=open]:ring-primary-line data-[state=open]:ring-inset"
      >
        <Ellipsis className="size-4" />
      </button>
    </DropdownMenuTrigger>
  );
}

/** 不可用的菜单项：禁用的样子，悬停写原因（Radix 的 disabled 收不到悬停，所以自己挡掉选择） */
export function BlockedItem({
  icon,
  label,
  reason,
  side = 'left',
}: {
  icon: ReactNode;
  label: string;
  reason: string;
  side?: ComponentProps<typeof TooltipContent>['side'];
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem
          aria-disabled
          onSelect={(event) => event.preventDefault()}
          className="text-placeholder focus:bg-transparent"
        >
          {icon}
          {label}
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side={side}>{reason}</TooltipContent>
    </Tooltip>
  );
}
