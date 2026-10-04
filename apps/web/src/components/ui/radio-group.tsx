import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 单选（shadcn RadioGroup，按原型 radio() 改过默认样式）：16 的圆，未选 1.5px 深一档边线，选中为 5px 主色边线（中间留白点）；
 * 键盘聚焦用设计规范的 ring-2 焦点环；禁用时浅边线。选项的文字由使用处用 <label> 放在右侧（正文 13、间距 8）。
 */

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('flex items-center gap-5', className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'size-4 shrink-0 rounded-full border-[1.5px] border-input bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:border-border data-[state=checked]:border-[5px] data-[state=checked]:border-primary',
        className,
      )}
      {...props}
    />
  );
}

export { RadioGroup, RadioGroupItem };
