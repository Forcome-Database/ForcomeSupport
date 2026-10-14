import { readFileSync } from 'node:fs';
import {
  assignStoreMessages,
  messageSourceLabels,
  ticketInboundPeriodLabels,
  recipientHeaderLabels,
  ticketChannelLabels,
  ticketStatuses,
  ticketStatusLabels,
  type TicketStatus,
  unassignedSlaTargetLabels,
} from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { channelLabel } from '@/components/ticket-badges';
import { pages } from '@/lib/pages';
import {
  COLUMNS,
  DRILL,
  EMPTY,
  EMPTY_TITLE,
  EMPTY_VALUE,
  FILTERS,
  LIVE_NOTE,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  PAGER,
  SLA_REPLIED,
  SORT_ARROWS,
  UNASSIGNED,
} from './p04-copy';
import { drillChipWords, drillCountWords, drillNoteWords } from './p04-words';

/*
 * P04 的界面文案与原型逐字一致（CLAUDE.md「文案逐字照原型」，ADR 0007 修订）：直接读原型生成物——第一期参照页
 * P04_Tickets、P04_Tickets_drill 与状态板 StatesInbox（I10、I16）；原型没画的下钻写法核对 PRD P04「第一阶段」v2.32。
 * 原型改了而代码没跟上、或反过来，都会失败。
 */

const read = (path: string) =>
  readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
const P04 = read('design/spec/phase1/P04_Tickets.dc.html');
const STATES_INBOX = read('design/StatesInbox.dc.html');
const DRILL_PAGE = read('design/spec/phase1/P04_Tickets_drill.dc.html');
const PRD_C = read('design/spec/prd_c.md');

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
    expectText(P04, LIVE_NOTE);
  });

  it('九列表头逐字一致，顺序与原型相同；SLA 剩余（默认 ↑）与最近来信（↕）是排序表头', () => {
    for (const title of Object.values(COLUMNS)) expectText(P04, title);
    // 表头从「工单号」起（之前的筛选行也有「来源」「状态」等字样）
    const header = P04.indexOf(`>${COLUMNS.number}<`);
    const positions = Object.values(COLUMNS).map((title) => P04.indexOf(`>${title}<`, header));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(P04).toContain(
      `>${COLUMNS.sla}<span style="font-size: 11px;">${SORT_ARROWS.asc}</span>`,
    );
    expect(P04).toContain(
      `>${COLUMNS.lastInbound}<span style="font-size: 11px;">${SORT_ARROWS.none}</span>`,
    );
  });

  it('筛选行：六枚芯片，最近来信默认「近 30 天」；SLA 列等客户写「已回复」', () => {
    for (const label of [
      FILTERS.status,
      FILTERS.channel,
      FILTERS.store,
      FILTERS.site,
      FILTERS.source,
    ]) {
      expectText(P04, label);
    }
    expect(P04).toContain(`>${FILTERS.inbound}：<span`);
    expectText(P04, ticketInboundPeriodLabels['30d']);
    expectText(P04, SLA_REPLIED);
  });

  it('分页：条数、每页条数与默认排序的说明，上一页 · 页码 · 下一页，禁用时悬停写原因', () => {
    expectText(P04, `${PAGER.summary(16, 20)} · ${PAGER.defaultOrder}`);
    expectText(P04, PAGER.prev);
    expectText(P04, PAGER.next);
    expectText(P04, PAGER.position(1, 1));
    expect(P04).toContain(`title="${PAGER.first}"`);
    expect(P04).toContain(`title="${PAGER.last(16, 20)}"`);
  });

  it('来源列：客户只写「客户」，生产厂是带图标的徽标（文字紧跟在图标之后）', () => {
    expectText(P04, messageSourceLabels.customer);
    expect(P04).toContain(`</svg>${messageSourceLabels.producer}</div>`);
    expect(messageSourceLabels).toMatchObject({
      customer: '客户',
      producer: '生产厂',
      other_supplier: '其他供应商',
    });
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
  it('空状态：标题、「当前筛选：…」与清除筛选逐字一致', () => {
    expectText(STATES_INBOX, EMPTY_TITLE);
    expectText(
      STATES_INBOX,
      EMPTY.description(
        [EMPTY.filter('状态', '转人工'), EMPTY.filter('店铺', 'forcome.mx')],
        true,
        13,
      ),
    );
    expectText(STATES_INBOX, FILTERS.clear);
  });
});

describe('从报表下钻（P04_Tickets_drill、I16 ②，PRD P04「第一阶段」v2.32）', () => {
  const drill = {
    kind: 'triggered',
    range: { from: '2026-09-10', to: '2026-09-10' },
    letter: null,
    channel: null,
    origin: 'daily-bar',
  } as const;

  it('「来自报表：条件 ×」芯片（只写条件）与移除的悬停说明', () => {
    expect(DRILL_PAGE).toContain(
      `</svg>${DRILL.chip}：<span style="font-weight: 600; color: #4338ca;">${drillChipWords(drill, '2026-09-11')}</span>`,
    );
    expect(DRILL_PAGE).toContain(`title="${DRILL.remove}"`);
  });

  it('计数行：「共 73 条」、出处与条件、右侧「清除筛选」', () => {
    expectText(
      DRILL_PAGE,
      drillCountWords({ kind: 'triggered', events: 73, letters: null, tickets: 73 }),
    );
    expectText(DRILL_PAGE, drillNoteWords(drill, '2026-09-11'));
    expectText(DRILL_PAGE, FILTERS.clear);
  });

  it('原型没画的写法照 PRD：按封计、事件数多于工单数、出处与最近来信的选项', () => {
    for (const words of [
      '「{日期} 到达 · 客户来信 · 已回复」',
      '「{日期} 到达 · 亚马逊来信 · 未达标」',
      `「${DRILL.eventsCount(75, 73)}」`,
      `「${DRILL.lettersCount(11, 9)}」`,
      '「每日工单量」图例「亚马逊」',
      '指标「工单量」「首响中位数」「SLA 达标率（亚马逊）」',
    ]) {
      expect(PRD_C, words).toContain(words);
    }
    const periods = Object.values(ticketInboundPeriodLabels).slice(0, 4).join(' · ');
    expect(PRD_C).toContain(
      `最近来信（${periods} · ${ticketInboundPeriodLabels.custom}，默认近 30 天`,
    );
  });
});

describe('未归属店铺来信队列（I17 与补充小样，第一期参照页 P04_Tickets_unassigned、_empty；待办 15）', () => {
  const QUEUE = read('design/spec/phase1/P04_Tickets_unassigned.dc.html');
  const EMPTY = read('design/spec/phase1/P04_Tickets_unassigned_empty.dc.html');
  const PRD = read('design/spec/prd_c.md');

  it('入口：「仅客服主管可见」与按钮「未归属店铺」后接计数', () => {
    for (const html of [P04, QUEUE, EMPTY]) {
      expectText(html, UNASSIGNED.entryHint);
      expect(html).toContain(`</svg>${UNASSIGNED.entry} <div`);
    }
  });

  it('标题行、提示条与五列表头逐字一致、同序', () => {
    expect(QUEUE).toContain(`>${UNASSIGNED.title}</div>`);
    expectText(QUEUE, UNASSIGNED.scope);
    expectText(QUEUE, UNASSIGNED.noteTitle(2));
    expectText(QUEUE, UNASSIGNED.noteDescription);
    const header = QUEUE.indexOf(`>${UNASSIGNED.columns.mail}<`);
    const positions = Object.values(UNASSIGNED.columns).map((title) =>
      QUEUE.indexOf(`>${title}<`, header),
    );
    expect(positions.every((p) => p > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('一行的写法：识别依据的头字段、「未登记」、发件域、SLA 目标、下拉占位与「指定」', () => {
    expectText(QUEUE, recipientHeaderLabels['delivered-to']);
    expectText(QUEUE, recipientHeaderLabels.to);
    expectText(QUEUE, UNASSIGNED.unregistered);
    expectText(QUEUE, UNASSIGNED.fromDomain('marketplace.amazon.ca'));
    expectText(QUEUE, unassignedSlaTargetLabels.platform);
    expectText(QUEUE, unassignedSlaTargetLabels.internal);
    expectText(QUEUE, UNASSIGNED.storePlaceholder);
    expectText(QUEUE, UNASSIGNED.assign);
  });

  it('队列为空：空状态标题；没有提示条', () => {
    expectText(EMPTY, UNASSIGNED.empty);
    expect(EMPTY.includes('封来信识别不出店铺')).toBe(false);
  });

  it('撤销浮层与两种提交失败的浮层（I17 ②⑤⑥）', () => {
    expectText(STATES_INBOX, UNASSIGNED.undoTitle('forcome.mx'));
    expectText(STATES_INBOX, UNASSIGNED.undoDescription);
    expectText(STATES_INBOX, `${UNASSIGNED.failedAction}失败：网络不可用`);
    expectText(STATES_INBOX, UNASSIGNED.stillQueued);
    expectText(STATES_INBOX, `${UNASSIGNED.failedAction}失败：${UNASSIGNED.taken}`);
    expectText(STATES_INBOX, assignStoreMessages.placedIn('forcome.mx'));
  });

  it('「指定」没选店铺时置灰，悬停说明逐字照原型（I17 的 title）与 PRD', () => {
    expect(QUEUE).toContain(`title="${UNASSIGNED.assignDisabled}"`);
    expect(STATES_INBOX).toContain(`title="${UNASSIGNED.assignDisabled}"`);
    expect(PRD).toContain(`悬停「${UNASSIGNED.assignDisabled}」`);
  });
});
