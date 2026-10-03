import { Avatar as AvatarPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 头像（shadcn Avatar，按原型 avatar() 改过默认样式）：圆形、无描边；
 * 内部成员用品牌渐变底、白字（设计规范第 1 节：渐变只用于 AI 标识、品牌标与内部成员头像）。
 * 尺寸：default 30（顶栏）、sm 24；字号按原型取尺寸的 0.42 并不小于 11。
 * 客户、生产厂等其他色调等用到的待办按原型补上。
 */
function Avatar({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: 'default' | 'sm';
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        'group/avatar relative flex size-7.5 shrink-0 overflow-hidden rounded-full select-none data-[size=sm]:size-6',
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
        'flex size-full items-center justify-center rounded-full bg-brand-gradient text-12 font-semibold text-white group-data-[size=sm]/avatar:text-11',
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback };
