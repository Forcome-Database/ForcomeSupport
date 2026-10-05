import { DayPicker } from '@daypicker/react';
import { zhCN } from '@daypicker/react/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * 日历（shadcn Calendar 的写法，按原型 date_picker() 改过样式；底下是 DayPicker v10，包名 @daypicker/react，不引它自带的样式表）：
 * 宽 236、内边距 10 / 12、间距 6；头部「2026 年 9 月」13 / 600，两侧 14 的翻月箭头；星期从周一开始，「一 … 日」12 / 600 最淡的次要色；
 * 日期格 30 × 28、6 圆角、12 等宽数字；今天主色字加 1px 主色描边，选中为主色实心白字；不可选的日期浅色划线。
 * 只显示本月的日期（不显示上下月补位）。
 */

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'] as const;

function Calendar({ className, ...props }: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      locale={zhCN}
      weekStartsOn={1}
      showOutsideDays={false}
      formatters={{
        formatCaption: (month) => `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`,
        formatWeekdayName: (day) => WEEKDAY_NAMES[day.getDay()] ?? '',
      }}
      className={cn('w-59 px-3 py-2.5', className)}
      classNames={{
        root: 'relative',
        months: 'flex flex-col',
        month: 'flex flex-col gap-1.5',
        nav: 'absolute inset-x-3 top-2.5 flex h-5 items-center justify-between',
        button_previous:
          'flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        button_next:
          'flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        month_caption: 'flex h-5 items-center justify-center',
        caption_label: 'text-13 font-semibold text-foreground',
        month_grid: 'border-collapse',
        weekdays: 'flex',
        weekday:
          'flex h-7 w-7.5 items-center justify-center text-12 font-semibold text-subtle-foreground',
        weeks: 'flex flex-col gap-0.5',
        week: 'flex',
        day: 'p-0',
        day_button:
          'flex h-7 w-7.5 items-center justify-center rounded-sm text-12 text-foreground tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        today:
          '[&>button]:font-bold [&>button]:text-primary [&>button]:shadow-[inset_0_0_0_1px_var(--color-primary)]',
        // 选中写在带属性的选择器里，与「今天」同时成立时以选中为准
        selected:
          '[&[data-selected=true]>button]:bg-primary [&[data-selected=true]>button]:font-bold [&[data-selected=true]>button]:text-primary-foreground [&[data-selected=true]>button]:shadow-none',
        disabled: '[&>button]:text-placeholder [&>button]:line-through',
        hidden: 'invisible',
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? (
            <ChevronLeft className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
