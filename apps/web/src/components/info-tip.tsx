import { Info } from 'lucide-react';
import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * 收进 ⓘ 的说明（原型 info_tip()）：短标题常显（ⓘ 14 最浅次要色 + 12 次要色字），全文在悬停说明里；
 * 悬停、键盘聚焦或点击都展开（PRD P18「悬停或点击展开」）。
 */
export function InfoTip({ label, tip }: { label: string; tip: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex cursor-help items-center gap-1 rounded-sm text-12 whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="size-3.5 text-subtle-foreground" />
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
