import { Avatar as AvatarPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 头像（shadcn Avatar，按原型 avatar() 改过默认样式）：圆形、无描边；
 * 内部成员用品牌渐变底、白字（设计规范第 1 节：渐变只用于 AI 标识、品牌标与内部成员头像）。
 * 尺寸：lg 32（头像菜单）、default 30（顶栏）、md 28（P20 成员表）、sm 24、xs 22（P27 操作人）；字号按原型取尺寸的 0.42 并不小于 11。
 * 色调：member（默认，内部成员，渐变底白字）；浅底粗体字的几种按原型 avatar() 的 tone——amber（浅黄，生产厂对接人、
 * P27 的售后负责人）、green（浅绿，P27 的坐席）、grey（浅灰，P27 的管理员与「系统」）、violet（浅紫，P27 的知识库负责人）。
 * 客户等其他色调等用到的待办按原型补上。
 */
export type AvatarTone = 'member' | 'amber' | 'green' | 'grey' | 'violet';

function Avatar({
  className,
  size = 'default',
  tone = 'member',
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: 'lg' | 'default' | 'md' | 'sm' | 'xs';
  tone?: AvatarTone;
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      data-tone={tone}
      className={cn(
        'group/avatar relative flex size-7.5 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-8 data-[size=md]:size-7 data-[size=sm]:size-6 data-[size=xs]:size-5.5',
        className,
      )}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-brand-gradient text-12 font-semibold text-white group-data-[size=lg]/avatar:text-13 group-data-[size=md]/avatar:text-11 group-data-[size=sm]/avatar:text-11 group-data-[size=xs]/avatar:text-11',
        // 浅底粗体字的色调：去掉渐变，换成同色调的浅底与深字
        'group-data-[tone=amber]/avatar:bg-warning-soft group-data-[tone=amber]/avatar:text-warning-text',
        'group-data-[tone=green]/avatar:bg-success-soft group-data-[tone=green]/avatar:text-success-text',
        'group-data-[tone=grey]/avatar:bg-secondary group-data-[tone=grey]/avatar:text-ink-2',
        'group-data-[tone=violet]/avatar:bg-flow-soft group-data-[tone=violet]/avatar:text-flow',
        'group-data-[tone=amber]/avatar:bg-none group-data-[tone=amber]/avatar:font-bold group-data-[tone=green]/avatar:bg-none group-data-[tone=green]/avatar:font-bold group-data-[tone=grey]/avatar:bg-none group-data-[tone=grey]/avatar:font-bold group-data-[tone=violet]/avatar:bg-none group-data-[tone=violet]/avatar:font-bold',
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback };
