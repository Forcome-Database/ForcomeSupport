import { Check, ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import type * as React from 'react';
import { controlClass } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/*
 * 下拉选择（shadcn Select，按原型 select_box() 改过默认样式）：触发器与输入框同一套（高 32、深一档边线、8 圆角、
 * 左右 10、正文字号，右侧 14 的向下箭头；未选时占位色；打开时主色边线 + 浅主色光晕；aria-invalid 时红色边线 + 浅红光晕）。
 * 弹出层与菜单同一套（白底、1px 边线、12 圆角、md 阴影、内边距 5），选项为菜单项样式、选中项右侧主色勾。
 */

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

/**
 * variant="inline"：嵌在输入框右侧的小下拉（原型 money_field() 的币种「USD ▾」）：没有外框，左边一条细线隔开，
 * 12 / 600 次要深色字、12 的箭头；外框与输入中、报错的样子由外面的输入框给。
 */
function SelectTrigger({
  className,
  children,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { variant?: 'default' | 'inline' }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        variant === 'inline'
          ? 'flex h-6 shrink-0 items-center gap-0.5 border-l border-input bg-transparent pr-1.5 pl-2 text-12 font-semibold whitespace-nowrap text-ink-2 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring'
          : cn(
              controlClass,
              'flex items-center justify-between gap-2 px-2.5 whitespace-nowrap select-none data-placeholder:text-placeholder *:data-[slot=select-value]:truncate',
            ),
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          className={cn(
            'pointer-events-none shrink-0 text-subtle-foreground',
            variant === 'inline' ? 'size-3' : 'size-3.5',
          )}
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-x-hidden overflow-y-auto rounded-lg border bg-popover p-1.25 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.75 pr-8 pl-2.5 text-body text-ink-2 outline-none select-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:text-placeholder',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="pointer-events-none absolute right-2.5 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5 text-primary" strokeWidth={2.2} />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
