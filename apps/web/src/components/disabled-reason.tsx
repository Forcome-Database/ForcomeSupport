import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * 不可用的控件悬停写原因（设计规范「禁用要悬停说明原因」）：禁用的按钮、下拉收不到悬停，外面包一层可聚焦的 span 接住
 * 悬停与键盘焦点；reason 为 null（可用）时原样渲染子元素。行内补登的「保存」、登记抽屉没选店铺时的负责人、P27 分页共用
 */
export function DisabledReason({
  reason,
  children,
}: {
  reason: string | null;
  children: ReactNode;
}) {
  if (reason === null) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
