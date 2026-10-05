import { readFileSync } from 'node:fs';
import {
  ticketChannelLabels,
  ticketStatuses,
  ticketStatusLabels,
  type TicketStatus,
} from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { channelLabel } from '@/components/ticket-badges';
import { pages } from '@/lib/pages';
import { COLUMNS, EMPTY_TITLE, EMPTY_VALUE, PAGE_DESCRIPTION, PAGE_TITLE } from './p04-copy';

/*
 * P04 的界面文案与原型逐字一致（CLAUDE.md「文案逐字照原型」，ADR 0007 修订）：直接读原型生成物——第一期参照页
 * P04_Tickets 与状态板 StatesInbox（I10）。原型改了而代码没跟上、或反过来，都会失败。
 */

const read = (path: string) =>
  readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
const P04 = read('design/spec/phase1/P04_Tickets.dc.html');
const STATES_INBOX = read('design/StatesInbox.dc.html');

/** 原型里有这段界面文字，且是一个元素的完整文本 */
function expectText(html: string, text: string) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(html.includes(`>${text}<`), `原型里没有「${text}」`).toBe(true);
}

describe('P04 第一期参照页', () => {
  it('页头与顶栏导航的页面名逐字一致', () => {
    expectText(P04, PAGE_TITLE);
    expectText(P04, PAGE_DESCRIPTION);
    expectText(P04, pages.tickets.label);
    expectText(P04, EMPTY_VALUE);
  });

  it('待办 08 的六列表头逐字一致（来源、订单号、SLA 剩余随 10、14、16、18）', () => {
    for (const title of Object.values(COLUMNS)) expectText(P04, title);
  });

  it('渠道与站点徽标、状态徽标照原型的写法', () => {
    expectText(P04, channelLabel('amazon', 'US'));
    expectText(P04, channelLabel('shopify', 'MX'));
    expectText(P04, channelLabel('email', 'US'));
    expect(ticketChannelLabels).toEqual({ amazon: '亚马逊', shopify: 'Shopify', email: '邮件' });
    // 状态徽标带一个圆点：文字紧跟在圆点之后
    for (const status of ticketStatuses) {
      expect(P04).toContain(`</div>${ticketStatusLabels[status satisfies TicketStatus]}</div>`);
    }
  });
});

describe('I10 筛选无结果', () => {
  it('空状态标题逐字一致（08 没有筛选，只显示标题，10-05 协调者确认）', () => {
    expectText(STATES_INBOX, EMPTY_TITLE);
  });
});
