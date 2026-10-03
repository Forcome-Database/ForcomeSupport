import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('按钮的处理中态（设计规范第 4 节）', () => {
  it('处理中时前面加转圈并标 aria-busy', () => {
    const html = renderToString(<Button loading>登录</Button>);
    expect(html).toContain('animate-spin');
    expect(html).toContain('aria-busy="true"');
  });

  it('asChild 时只渲染调用方给的那一个元素（Radix Slot 只接受一个子元素）', () => {
    const html = renderToString(
      <Button asChild loading>
        <a href="/x">链接</a>
      </Button>,
    );
    expect(html).toMatch(/^<a [^>]*aria-busy="true"/);
    expect(html).not.toContain('animate-spin');
  });
});
