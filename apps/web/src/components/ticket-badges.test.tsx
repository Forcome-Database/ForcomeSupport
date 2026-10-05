import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TicketSourceLabel } from './ticket-badges';

/*
 * P04 来源列（PRD P04「来源（非客户时显示徽标）」，原型 p1_row 与 source_badge()，待办 10）：
 * 客户只写「客户」；生产厂、其他供应商为 flow 色调徽标，分别带工厂、货车图标。
 */

describe('来源标注', () => {
  it('客户只写「客户」（最淡的次要色），没有徽标', () => {
    const html = renderToString(<TicketSourceLabel source="customer" />);
    expect(html).toContain('>客户<');
    expect(html).toContain('text-subtle-foreground');
    expect(html).not.toContain('data-slot="badge"');
  });

  it('生产厂、其他供应商为 flow 徽标，图标在文字之前', () => {
    for (const [source, label, icon] of [
      ['producer', '生产厂', 'lucide-factory'],
      ['other_supplier', '其他供应商', 'lucide-truck'],
    ] as const) {
      const html = renderToString(<TicketSourceLabel source={source} />);
      expect(html).toContain('data-slot="badge"');
      expect(html).toContain('bg-flow-soft');
      expect(html).toMatch(new RegExp(`${icon}.*</svg>${label}</span>`));
    }
  });
});
