import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHANNEL_ALERT_COPY, VIEW_CHANNEL_STATUS } from './channel-alert-copy';

/*
 * 全站横幅与原型逐字一致（CLAUDE.md「文案逐字照原型」）：G4（GlobalStates，坐席视角，没有按钮）与 K7（StatesAdmin，
 * 管理员视角，带「查看渠道状态」）是同一种写法（待办 09 Q1 用户确认）。原型的示例时刻为 09-11 10:05。
 */

const read = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
const GLOBAL_STATES = read('design/GlobalStates.dc.html');
const STATES_ADMIN = read('design/StatesAdmin.dc.html');

function expectText(html: string, text: string | undefined) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(html.includes(`>${text}<`), `原型里没有「${text}」`).toBe(true);
}

describe('G4 集成中断横幅（K7 同一写法）', () => {
  it('Gmail：标题与说明', () => {
    const gmail = CHANNEL_ALERT_COPY.gmail;
    for (const html of [GLOBAL_STATES, STATES_ADMIN]) {
      expectText(html, gmail.title);
      expectText(html, gmail.description('09-11 10:05'));
    }
  });

  it('163 企业邮箱：标题与说明（K20 补充小样，D-28，待办 34 原型 G4_BANNER_QIYE）', () => {
    const qiye = CHANNEL_ALERT_COPY.qiye163;
    expectText(STATES_ADMIN, qiye.title);
    expectText(STATES_ADMIN, qiye.description('09-11 10:05'));
  });

  it('Shopify：标题与说明（K20 补充小样，协调者 2026-10-06 决定）', () => {
    const shopify = CHANNEL_ALERT_COPY.shopify;
    expectText(STATES_ADMIN, shopify.title);
    expectText(STATES_ADMIN, shopify.description('09-11 10:05'));
  });

  it('亚马逊：标题与说明（K20 补充小样，待办 12 Q3 协调者 2026-10-06 决定）', () => {
    const amazon = CHANNEL_ALERT_COPY.amazon;
    expectText(STATES_ADMIN, amazon.title);
    expectText(STATES_ADMIN, amazon.description('09-11 10:05'));
  });

  it('管理员看到的「查看渠道状态」', () => {
    expectText(STATES_ADMIN, VIEW_CHANNEL_STATUS);
  });
});
