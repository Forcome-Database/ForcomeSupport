import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 徽标（shadcn Badge，按原型 chip() / state() / channel() 改过默认样式，设计规范第 6 节）：
 * 11 / 600、1px 同色调边线、6 圆角、左右 7、行高 18、不换行；dot 时前面一个 5px 同色圆点（状态一律带点，颜色由
 * 状态 → 色调的唯一映射决定，见各页面）。tone 对应原型 TONES：neutral、muted、outline、accent、success、warning、danger、info。
 * 渠道标识（亚马逊橙、Shopify 绿）是没有边线、左右 6 的另一种样式（ChannelBadge）。
 */
const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1.25 rounded-sm border px-1.75 text-11 leading-4.5 font-semibold whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-secondary bg-secondary text-ink-2',
        muted: 'border-border bg-background text-muted-foreground',
        outline: 'border-input bg-card text-ink-2',
        accent: 'border-primary-soft bg-primary-soft text-primary-text',
        success: 'border-success-soft bg-success-soft text-success-text',
        warning: 'border-warning-soft bg-warning-soft text-warning-text',
        danger: 'border-destructive-soft bg-destructive-soft text-destructive-text',
        info: 'border-info-soft bg-info-soft text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

function Badge({
  className,
  tone,
  dot = false,
  children,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span aria-hidden className="size-1.25 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const channelTones = {
  amazon: 'bg-channel-amazon-soft text-channel-amazon',
  shopify: 'bg-success-soft text-success-text',
  mail: 'bg-secondary text-muted-foreground',
} as const;

/** 渠道标识（原型 channel()）：亚马逊橙、Shopify 绿、邮件灰，没有边线 */
function ChannelBadge({
  channel,
  className,
  children,
}: {
  channel: keyof typeof channelTones;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      data-slot="channel-badge"
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm px-1.5 text-11 leading-4.5 font-semibold tracking-[0.01em] whitespace-nowrap',
        channelTones[channel],
        className,
      )}
    >
      {children}
    </span>
  );
}

export { Badge, ChannelBadge };
