import { describe, expect, it } from 'vitest';
import { displayBody } from './body';

describe('P05 显示的正文', () => {
  it('有纯文本部分时用纯文本，统一换行、去掉首尾空白', () => {
    expect(
      displayBody({ text: '\r\nHi there,\r\nthe cable is broken.\r\n\r\n', html: '<p>x</p>' }),
    ).toBe('Hi there,\nthe cable is broken.');
  });

  it('只有 HTML 时转成文字：段落与换行保留，链接不带地址，图片去掉', () => {
    expect(
      displayBody({
        text: null,
        html: '<html><head><style>p{}</style></head><body><p>Hello <b>Forcome</b>,</p><p>see <a href="https://x.example">this</a><br>thanks<img src="a.png" alt="logo"></p></body></html>',
      }),
    ).toBe('Hello Forcome,\n\nsee this\nthanks');
  });

  it('纯文本部分是空白时也用 HTML', () => {
    expect(displayBody({ text: '  \n ', html: '<div>Only html</div>' })).toBe('Only html');
  });

  it('都没有时为空', () => {
    expect(displayBody({ text: null, html: null })).toBe('');
  });

  it('Shopify 联系表单只取表单里的留言（Body 栏之后的全部，可以多行）', () => {
    const form = [
      "You received a new message from your online store's contact form.",
      'Country Code: US',
      'Name: Olivia Turner',
      'Email: olivia.turner@example.com',
      'Phone Number:',
      'Order number: #1063',
      'Body:',
      'Vacuum loses suction after a few weeks.',
      '',
      'Thanks!',
    ].join('\n');
    expect(displayBody({ text: form, html: null, relay: 'shopify' })).toBe(
      'Vacuum loses suction after a few weeks.\n\nThanks!',
    );
  });

  it('留言写在 Body 同一行时也取到；找不到 Body 栏的照原文', () => {
    expect(
      displayBody({ text: 'Name: A\nbody: Where is my order?', html: null, relay: 'shopify' }),
    ).toBe('Where is my order?');
    expect(displayBody({ text: 'Name: A\nHello', html: null, relay: 'shopify' })).toBe(
      'Name: A\nHello',
    );
  });

  it('亚马逊买家消息只取「Begin message」与「End message」之间的留言；没有这两行的照原文', () => {
    const relayed = [
      '------------- Begin message -------------',
      '',
      "Hi, the charger cable doesn't work.",
      'No light at all.',
      '',
      '------------- End message -------------',
      '',
      'For Your Information: To help arrive at the best solution, Amazon may review messages.',
      'Order ID: 204-5566778-9900112',
    ].join('\r\n');
    expect(displayBody({ text: relayed, html: null, relay: 'amazon' })).toBe(
      "Hi, the charger cable doesn't work.\nNo light at all.",
    );
    expect(displayBody({ text: 'Hello\nOrder ID: 1', html: null, relay: 'amazon' })).toBe(
      'Hello\nOrder ID: 1',
    );
    // 不是经平台中转的（直邮）不截取
    expect(displayBody({ text: relayed, html: null })).toContain('Order ID: 204-5566778-9900112');
  });
});
