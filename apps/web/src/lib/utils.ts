import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * globals.css 里自定义的字号（设计规范刻度 text-11 … text-24、数字角标的 text-10 与随密度变化的 text-body 等）、随密度变化的间距与阴影。
 * 要告诉 tailwind-merge 它们属于哪一类：否则字号会被当成文字颜色、与 text-primary-foreground 之类互相覆盖，
 * 自定义阴影与组件默认的 shadow-xs 也不会互相覆盖（两个都留下，谁生效看样式表顺序）。
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['10', '11', '12', '13', '14', '16', '20', '24', 'body', 'minor', 'badge'],
      spacing: ['queue-row', 'queue', 'table-row', 'panel-x', 'panel-y'],
      shadow: ['card', 'pop', 'press'],
    },
  },
});

/** 合并 Tailwind 类名（shadcn/ui 约定） */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
