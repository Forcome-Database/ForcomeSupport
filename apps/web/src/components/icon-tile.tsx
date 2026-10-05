import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 图标块的色调：成功、警示、危险为浅色调底配文字色，muted 为浅线色底配次要色 */
export type IconTileTone = 'success' | 'warning' | 'danger' | 'muted';

const tones: Record<IconTileTone, string> = {
  success: 'bg-success-soft text-success-text',
  warning: 'bg-warning-soft text-warning-text',
  danger: 'bg-destructive-soft text-destructive-text',
  muted: 'bg-border-soft text-muted-foreground',
};

/**
 * 带色调底的图标块（8 圆角）：默认 32 见方、图标 18（原型 tile()，P18 渠道卡的卡头）；sm 为 28 见方、图标 15、描边 2
 * （原型 notif_item() 的类型图标，站内通知面板）
 */
export function IconTile({
  icon: Icon,
  tone,
  size = 'default',
}: {
  icon: LucideIcon;
  tone: IconTileTone;
  size?: 'default' | 'sm';
}) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md',
        size === 'sm' ? 'size-7' : 'size-8',
        tones[tone],
      )}
    >
      <Icon
        className={size === 'sm' ? 'size-3.75' : 'size-4.5'}
        strokeWidth={size === 'sm' ? 2 : 1.75}
      />
    </span>
  );
}
