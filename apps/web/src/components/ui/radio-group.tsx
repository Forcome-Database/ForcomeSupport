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

/**
 * 卡片式单选（原型 radio_card()，设计规范组件对照「radio_card 为 RadioGroup 的卡片样式」）：等分一行，1px 边线、12 圆角、
 * 内边距 10 / 12、间距 10；左侧同一个 16 的圆，右侧 13 / 600 标题与 12 次要色说明（行高 1.5）；
 * 选中为主色边线、浅主色底与 3px 浅主色光晕；键盘聚焦用 ring-2 焦点环；禁用时没选中的卡片为浅灰底（原型 radio_card(disabled)）。
 */
function RadioCard({
  className,
  title,
  description,
  ...props
}: Omit<React.ComponentProps<typeof RadioGroupPrimitive.Item>, 'title'> & {
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-card"
      className={cn(
        'group/card flex min-w-0 flex-1 items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-invalid:border-destructive data-[disabled]:pointer-events-none data-[state=checked]:border-primary data-[state=checked]:bg-primary-soft data-[state=checked]:ring-3 data-[state=checked]:ring-primary/10 data-[state=unchecked]:data-[disabled]:bg-muted',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="mt-0.5 size-4 shrink-0 rounded-full border-[1.5px] border-input bg-card group-data-[state=checked]/card:border-[5px] group-data-[state=checked]/card:border-primary"
      />
      <span className="flex min-w-0 flex-col gap-0.75">
        <span className="text-13 font-semibold text-foreground">{title}</span>
        {description && (
          <span className="text-12 leading-normal text-muted-foreground">{description}</span>
        )}
      </span>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioCard, RadioGroup, RadioGroupItem };
