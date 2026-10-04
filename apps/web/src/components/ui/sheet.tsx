import { X } from 'lucide-react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 右侧抽屉（shadcn Sheet，按原型 drawer() 与 drawer_over() 改过默认样式；设置页的新增与编辑用它，PRD D-20 ⑤）：
 * 页面上盖一层遮罩，抽屉贴右侧、高度占满、白底、左侧 1px 边线、lg 阴影；
 * 标题区（内边距 16 / 20 / 14、下边浅线）：16 / 600 标题 + 12 次要色说明，右侧 16 的关闭 ×；
 * 表单区（内边距 16 / 20、间距 14，超出时滚动）；底部按钮区（内边距 12 / 20、上边浅线、浅灰底，按钮靠右、间距 8）。
 * 只做右侧一种。关闭（Esc、点遮罩、×）都经 onOpenChange(false)，有未保存修改时由使用处决定是否先确认（G8）。
 */

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex h-full flex-col border-l bg-card text-body text-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right-10 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right-10 data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

/** 标题区：标题、说明与关闭 ×（× 经 onOpenChange(false) 关闭） */
function SheetHeader({
  title,
  description,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        'flex items-start gap-3 border-b border-border-soft px-5 pt-4 pb-3.5',
        className,
      )}
    >
      <div className="flex flex-1 flex-col gap-1">
        <SheetPrimitive.Title className="text-16 font-semibold text-foreground">
          {title}
        </SheetPrimitive.Title>
        {description ? (
          <SheetPrimitive.Description className="text-12 leading-normal text-muted-foreground">
            {description}
          </SheetPrimitive.Description>
        ) : (
          <SheetPrimitive.Description className="sr-only">{title}</SheetPrimitive.Description>
        )}
      </div>
      <SheetPrimitive.Close
        aria-label="关闭"
        className="rounded-sm text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" />
      </SheetPrimitive.Close>
    </div>
  );
}

/** 表单区：超出时滚动 */
function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-body"
      className={cn('flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4', className)}
      {...props}
    />
  );
}

/** 底部按钮区：按钮靠右 */
function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'flex justify-end gap-2 border-t border-border-soft bg-muted px-5 py-3',
        className,
      )}
      {...props}
    />
  );
}

export { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader };
