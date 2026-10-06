import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AMAZON_CONNECTION_NOTICES, amazonAuditObject } from './amazon-copy';

/*
 * 亚马逊连接异常与恢复的站内通知、审计对象与原型逐字一致（CLAUDE.md「文案逐字照原型」）：原型只画了 Gmail，亚马逊的写法由协调者
 * 2026-10-06 决定（待办 12 Q4、Q5，套用 Shopify 的写法），已回写到状态板 StatesAdmin 的 K20 补充小样（data.py 的 AMAZON_NOTICES、
 * AMAZON_AUDIT）。原型改了写法而代码没跟上、或反过来，都会失败。
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const STATES_ADMIN = read('../../../../../design/StatesAdmin.dc.html');

function expectText(html: string, text: string) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(html.includes(`>${text}<`), `原型里没有「${text}」`).toBe(true);
}

describe('亚马逊连接异常与恢复（G10 写法、11.4、E-01）', () => {
  it('连接异常：标题与说明（原型的示例店铺 Forcome Auto）', () => {
    expectText(STATES_ADMIN, AMAZON_CONNECTION_NOTICES.disconnected.title);
    expectText(STATES_ADMIN, AMAZON_CONNECTION_NOTICES.disconnected.body('Forcome Auto'));
  });

  it('恢复：标题与说明（补拉 2 笔订单）', () => {
    expectText(STATES_ADMIN, AMAZON_CONNECTION_NOTICES.recovered.title);
    expectText(STATES_ADMIN, AMAZON_CONNECTION_NOTICES.recovered.body('Forcome Auto', 2));
  });

  it('对象：P18 · 亚马逊 SP-API', () => {
    expectText(STATES_ADMIN, AMAZON_CONNECTION_NOTICES.object.label);
  });

  it('审计对象：亚马逊 SP-API · 店铺（P27 的渠道记录）', () => {
    expect(STATES_ADMIN).toContain(
      `>${amazonAuditObject({ id: 'x', name: 'Forcome Auto' }).objectLabel} · 恢复连接<`,
    );
  });
});
