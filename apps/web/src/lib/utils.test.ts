import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('合并 Tailwind 类名', () => {
  it('设计规范的字号刻度（text-11 … text-24、随密度的 text-body 等）不会被当成文字颜色吃掉', () => {
    expect(cn('text-primary-foreground', 'text-13')).toBe('text-primary-foreground text-13');
    expect(cn('text-muted-foreground', 'text-body')).toBe('text-muted-foreground text-body');
    // 数字角标的 10px（只用于数字）
    expect(cn('text-primary-foreground', 'text-10')).toBe('text-primary-foreground text-10');
  });

  it('同类的后者覆盖前者：字号对字号、颜色对颜色', () => {
    expect(cn('text-12', 'text-14')).toBe('text-14');
    expect(cn('text-minor', 'text-body')).toBe('text-body');
    expect(cn('text-muted-foreground', 'text-primary-text')).toBe('text-primary-text');
    expect(cn('h-10', 'h-table-row')).toBe('h-table-row');
    expect(cn('px-4', 'px-panel-x')).toBe('px-panel-x');
    expect(cn('shadow-xs', 'shadow-card')).toBe('shadow-card');
  });
});
