import { Info, TriangleAlert } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 页内横幅（shadcn Alert，按原型 banner() 改过默认样式，设计规范第 7 节「横幅用于持续存在的情况」）：
 * 12 圆角、1px 同色调边线、内边距 10 / 12、间距 10；左侧 24 的同色调圆形图标块；13 / 600 标题、12 次要深色说明（行高 1.55）；
 * 操作按钮在右侧。已有 G7 用到的警示（warning）、新建登记保存报错用到的危险（danger，S14：标题为红字）与
 * P27「你只能看到自己的操作记录」用到的信息（info，K18 ①；持续说明，读屏按 status 播报）；成功第一次用到的待办照原型补上。
 */
const tones = {
  info: {
    box: 'border-info-line bg-info-banner',
    dot: 'bg-info-soft text-info',
    title: 'text-foreground',
    icon: Info,
    role: 'status',
  },
  warning: {
    box: 'border-warning-line bg-warning-banner',
    dot: 'bg-warning-banner-icon text-warning-text',
    title: 'text-foreground',
    icon: TriangleAlert,
    role: 'alert',
  },
  danger: {
    box: 'border-destructive-line bg-destructive-banner',
    dot: 'bg-destructive-soft-active text-destructive-text',
    title: 'text-destructive-text',
    icon: TriangleAlert,
    role: 'alert',
  },
} as const;

function Alert({
  tone,
  title,
  description,
  action,
  className,
}: {
  tone: keyof typeof tones;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const { box, dot, title: titleClass, icon: Icon, role } = tones[tone];
  return (
    <div
      role={role}
      data-slot="alert"
      className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5', box, className)}
    >
      <div className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', dot)}>
        <Icon className="size-3.5" strokeWidth={2} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
        <div className={cn('text-13 font-semibold', titleClass)}>{title}</div>
        {description && <div className="text-12 leading-[1.55] text-ink-2">{description}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
    </div>
  );
}

export { Alert };
