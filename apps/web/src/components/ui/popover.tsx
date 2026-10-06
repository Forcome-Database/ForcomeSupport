import { Popover as PopoverPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 浮层（shadcn Popover，按原型的弹出层改过默认样式，与下拉菜单同一套）：白底、1px 边线、12 圆角、md 阴影，
 * 放在触发处下方 6px。日期字段的日历（原型 date_picker()）用它。
 */
function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

/** 浮层的定位锚点：触发处另有自己的行为时（如分段控件里的「自定义」）用它定位，开关由使用处控制 */
function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

/**
 * 浮层关闭（退场动画结束、卸载）时 Radix 默认把焦点还给它的触发处；但退场的那 200 毫秒里焦点可能已经去了别处——
 * 比如选完一个筛选紧接着点开另一个筛选：点击还没被记成「点在浮层外」浮层就卸载了，焦点被抢回旧的触发处，
 * 刚打开的浮层以为焦点移出而自己关掉。焦点已在别的元素上时不还；焦点原在浮层里（卸载后落到 body）时照常还给触发处。
 */
function keepFocusIfMoved(event: Event): void {
  const active = document.activeElement;
  if (active && active !== document.body) event.preventDefault();
}

function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-lg border bg-popover text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (!event.defaultPrevented) keepFocusIfMoved(event);
        }}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
