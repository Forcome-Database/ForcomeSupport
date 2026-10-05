import { businessDate } from '@forcome/calendar';
import { CalendarDays } from 'lucide-react';
import { useState, type Ref } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { controlClass } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/*
 * 日期字段（设计规范组件对照「日期字段 → Calendar + Popover（DatePicker）」；原型 input_box(…, icon_name='calendar', mono=True)）：
 * 外观与输入框同一套，左侧 16 的日历图标，值写 YYYY-MM-DD（等宽数字），没选时写占位；点开是日历浮层，选一天即关闭。
 * 值是北京时间的日期字符串（YYYY-MM-DD），日历里的「今天」也按北京时间。
 */

/** YYYY-MM-DD → 本地时区那一天的 Date（日历按本地日期显示；值本身是北京时间的日期字符串） */
export function toDate(value: string): Date {
  const [y = 1970, m = 1, d = 1] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 日历选中的 Date → YYYY-MM-DD */
export function toValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function DateField({
  id,
  value,
  onChange,
  placeholder,
  invalid = false,
  disabled = false,
  ref,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  /** 禁用（编辑登记里锁定的字段）：浅灰底、占位色字，打不开日历 */
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const today = toDate(businessDate(new Date()));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={ref}
          id={id}
          type="button"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className={cn(controlClass, 'flex items-center gap-2 px-2.5 text-left')}
        >
          <CalendarDays aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
          <span className={cn('truncate tabular-nums', !value && 'text-placeholder')}>
            {value || placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <Calendar
          mode="single"
          today={today}
          defaultMonth={value ? toDate(value) : today}
          selected={value ? toDate(value) : undefined}
          onSelect={(date) => {
            if (date) onChange(toValue(date));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
