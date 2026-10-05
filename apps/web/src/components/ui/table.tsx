import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 表格（shadcn Table，按原型 table() 改过默认样式，设计规范第 8 节）：白底、1px 边线、12 圆角、轻阴影；
 * 表头浅灰底、下边线、11 / 600 最浅次要色、字距 0.02em、不换行，上下 9；数据行白底、下边浅线、正文字号，上下 10
 * （行高另由使用处给，如 P18 店铺表上下 12）；列间距 12、首尾列距边 16（单元格左右各 6，首尾列外侧 16）。
 * 列宽用 <colgroup> 照原型的 grid-template-columns 给定。排序、筛选、分页的表格再接 TanStack Table。
 * 工单列表（原型 tk_table()）的外框圆角是 8、表头 11 / 700 次要色、行上下 7，用 containerClassName 与单元格的 className 改。
 */

function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<'table'> & { containerClassName?: string }) {
  return (
    <div
      data-slot="table-container"
      className={cn('overflow-hidden rounded-lg border bg-card shadow-xs', containerClassName)}
    >
      <table
        data-slot="table"
        className={cn('w-full table-fixed border-collapse text-body', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('bg-muted', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={className} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-border-soft last:border-b-0 [thead_&]:border-b [thead_&]:border-border',
        className,
      )}
      {...props}
    />
  );
}

const edgeCells = 'first:pl-4 last:pr-4';

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'px-1.5 py-2.25 text-left align-middle text-11 font-semibold tracking-[0.02em] whitespace-nowrap text-subtle-foreground',
        edgeCells,
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('min-w-0 px-1.5 py-2.5 align-middle text-foreground', edgeCells, className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
