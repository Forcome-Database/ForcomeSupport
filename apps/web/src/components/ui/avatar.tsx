import { Avatar as AvatarPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 头像（shadcn Avatar，按原型 avatar() 改过默认样式）：圆形、无描边；
 * 内部成员用品牌渐变底、白字（设计规范第 1 节：渐变只用于 AI 标识、品牌标与内部成员头像）。
 * 尺寸：lg 32（头像菜单）、default 30（顶栏）、sm 24；字号按原型取尺寸的 0.42 并不小于 11。
 * 色调：member（默认，内部成员，渐变底白字）、amber（生产厂对接人，浅黄底、深黄粗体字，原型 tone='amber'）；
 * 客户等其他色调等用到的待办按原型补上。
 */
function Avatar({
  className,
  size = 'default',
  tone = 'member',
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: 'lg' | 'default' | 'sm';
  tone?: 'member' | 'amber';
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      data-tone={tone}
      className={cn(
        'group/avatar relative flex size-7.5 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-8 data-[size=sm]:size-6',
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
        'flex size-full items-center justify-center rounded-full bg-brand-gradient text-12 font-semibold text-white group-data-[size=lg]/avatar:text-13 group-data-[size=sm]/avatar:text-11 group-data-[tone=amber]/avatar:bg-warning-soft group-data-[tone=amber]/avatar:bg-none group-data-[tone=amber]/avatar:font-bold group-data-[tone=amber]/avatar:text-warning-text',
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback };
