import { TriangleAlert, X } from 'lucide-react';
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 确认弹窗（shadcn AlertDialog，按原型 dialog() 与 scrim() 改过默认样式；G6 二次确认、G7 覆盖确认、G8 未保存离开）：
 * 遮罩居中；白底、16 圆角、lg 阴影；标题区（内边距 18 / 20 / 0）：警示色调时左侧 36 的浅黄圆角图标块，16 / 600 标题，
 * 右侧 16 的关闭 ×（等同「取消」）；正文区（内边距 14 / 20 / 18）；底部按钮区（内边距 12 / 20、上边浅线、浅灰底，按钮靠右、间距 8）。
 * 默认焦点由使用处放在「取消」或「继续编辑」上（G6、G8），Esc 取消。
 */

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay
        data-slot="alert-dialog-overlay"
        className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-card text-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

/** 标题区：tone="warning" 时带浅黄图标块；× 等同「取消」 */
function AlertDialogHeader({
  title,
  tone,
  className,
}: {
  title: React.ReactNode;
  tone?: 'warning';
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-3 px-5 pt-4.5', className)}>
      {tone === 'warning' && (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning-soft">
          <TriangleAlert className="size-4.5 text-warning-text" strokeWidth={2} />
        </div>
      )}
      <AlertDialogPrimitive.Title className="flex-1 text-16 font-semibold text-foreground">
        {title}
      </AlertDialogPrimitive.Title>
      <AlertDialogPrimitive.Cancel
        aria-label="关闭"
        className="rounded-sm text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" />
      </AlertDialogPrimitive.Cancel>
    </div>
  );
}

/** 正文区：说明文字（AlertDialog 的 Description） */
function AlertDialogBody({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn('px-5 pt-3.5 pb-4.5 text-muted-foreground', className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex justify-end gap-2 border-t border-border-soft bg-muted px-5 py-3',
        className,
      )}
      {...props}
    />
  );
}

/** 「取消」类按钮：包住 Button（asChild） */
function AlertDialogCancel(props: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return <AlertDialogPrimitive.Cancel asChild {...props} />;
}

export {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
};
