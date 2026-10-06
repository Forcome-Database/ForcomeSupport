import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHOPIFY_CONNECTION_NOTICES, shopifyAuditObject } from './shopify-copy';

/*
 * Shopify 连接异常与恢复的站内通知、审计对象与原型逐字一致（CLAUDE.md「文案逐字照原型」）：原型只画了 Gmail，Shopify 的写法由协调者
 * 2026-10-06 决定（套用待办 09 用户确认的 Gmail 写法），已回写到状态板 StatesAdmin 的 K20 补充小样（data.py 的 SHOPIFY_NOTICES、
 * SHOPIFY_AUDIT）。原型改了写法而代码没跟上、或反过来，都会失败。
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const STATES_ADMIN = read('../../../../../design/StatesAdmin.dc.html');

function expectText(html: string, text: string) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(html.includes(`>${text}<`), `原型里没有「${text}」`).toBe(true);
}

describe('Shopify 连接异常与恢复（G10 写法、11.4、E-01）', () => {
  it('连接异常：标题与说明（原型的示例店铺 forcome.mx）', () => {
    expectText(STATES_ADMIN, SHOPIFY_CONNECTION_NOTICES.disconnected.title);
    expectText(STATES_ADMIN, SHOPIFY_CONNECTION_NOTICES.disconnected.body('forcome.mx'));
  });

  it('恢复：标题与说明（补拉 2 笔订单）', () => {
    expectText(STATES_ADMIN, SHOPIFY_CONNECTION_NOTICES.recovered.title);
    expectText(STATES_ADMIN, SHOPIFY_CONNECTION_NOTICES.recovered.body('forcome.mx', 2));
  });

  it('对象：P18 · Shopify', () => {
    expectText(STATES_ADMIN, SHOPIFY_CONNECTION_NOTICES.object.label);
  });

  it('审计对象：Shopify · 店铺（P27 的渠道记录）', () => {
    expect(STATES_ADMIN).toContain(
      `>${shopifyAuditObject({ id: 'x', name: 'forcome.mx' }).objectLabel} · 恢复连接<`,
    );
  });
});
