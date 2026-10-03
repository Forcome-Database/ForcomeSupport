import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 空、无权限、失败的通用画面（原型 empty()，设计规范第 9 节）：浅靛蓝图标块 44、14px 标题、
 * 正文字号的说明（13，紧凑 12；最宽 340、居中）与一个操作；compact 用于卡片里（图标块 38、内边距 20，原型 compact=True）。
 * 加载失败（LoadError）、无权限（Forbidden，G2）、登录被拒（LoginDenied，G12）都由它拼成。
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.75',
        compact ? 'p-5' : 'px-6 py-9',
      )}
    >
      <div
        className={cn(
          'mb-1 flex items-center justify-center rounded-lg bg-primary-soft',
          compact ? 'size-9.5' : 'size-11',
        )}
      >
        <Icon className="size-5 text-primary-text" strokeWidth={1.75} />
      </div>
      <div className="text-14 font-semibold text-foreground">{title}</div>
      {description && (
        <div className="max-w-85 text-center text-body leading-[1.6] text-muted-foreground">
          {description}
        </div>
      )}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}
