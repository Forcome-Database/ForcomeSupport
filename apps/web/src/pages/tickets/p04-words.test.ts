import { ticketDrillOf, type TicketDrill, type TicketListQuery } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import {
  drillChipWords,
  drillCountWords,
  drillDateWords,
  drillNoteWords,
  filterSummary,
  inboundWords,
} from './p04-words';

/*
 * P04 拼句子（PRD P04「第一阶段」v2.32，协调者 2026-10-14 决定 Q3）：「来自报表」芯片只写条件，计数行写数量与出处；
 * 原型画了的那一种（「每日工单量」09-10 的柱）逐字对上 P04_Tickets_drill，其余照 PRD 的写法。
 */

const TODAY = '2026-09-11';

const drillOf = (query: TicketListQuery): TicketDrill => {
  const drill = ticketDrillOf(query);
  if (!drill) throw new Error('没有下钻');
  return drill;
};

describe('下钻的日期', () => {
  it('单天「09-10」，区间「09-04 至 09-10」，不在今年的写全年份', () => {
    expect(drillDateWords({ from: '2026-09-10', to: '2026-09-10' }, TODAY)).toBe('09-10');
    expect(drillDateWords({ from: '2026-09-04', to: '2026-09-10' }, TODAY)).toBe('09-04 至 09-10');
    expect(drillDateWords({ from: '2025-12-29', to: '2026-01-04' }, '2026-01-05')).toBe(
      '2025-12-29 至 01-04',
    );
    expect(drillDateWords({ from: '2025-12-29', to: '2025-12-29' }, TODAY)).toBe('2025-12-29');
  });
});

describe('「来自报表」芯片（只写条件）', () => {
  it('工单量类：原型「09-10 新建或重开 · 客户来信」；图例带渠道时末尾加渠道', () => {
    expect(drillChipWords(drillOf({ drill: 'triggered', drillFrom: '2026-09-10' }), TODAY)).toBe(
      '09-10 新建或重开 · 客户来信',
    );
    expect(
      drillChipWords(
        drillOf({
          drill: 'triggered',
          drillFrom: '2026-09-04',
          drillTo: '2026-09-10',
          drillChannel: 'shopify_email',
        }),
        TODAY,
      ),
    ).toBe('09-04 至 09-10 新建或重开 · 客户来信 · Shopify 与邮件');
  });

  it('首响类「到达 · 客户来信 · 已回复」，SLA 类「到达 · 亚马逊来信 · 未达标」', () => {
    expect(
      drillChipWords(
        drillOf({
          drill: 'arrived',
          drillFrom: '2026-09-04',
          drillTo: '2026-09-10',
          letter: 'replied',
        }),
        TODAY,
      ),
    ).toBe('09-04 至 09-10 到达 · 客户来信 · 已回复');
    expect(
      drillChipWords(
        drillOf({
          drill: 'arrived',
          drillFrom: '2026-09-04',
          drillTo: '2026-09-10',
          letter: 'missed',
          drillChannel: 'amazon',
        }),
        TODAY,
      ),
    ).toBe('09-04 至 09-10 到达 · 亚马逊来信 · 未达标');
    expect(
      drillChipWords(
        drillOf({ drill: 'arrived', drillFrom: '2026-09-10', letter: 'pending' }),
        TODAY,
      ),
    ).toBe('09-10 到达 · 客户来信 · 未到期');
  });

  it('只走地址栏：缺了起始日的当作没有下钻；按事件计时 letter 不起作用', () => {
    expect(ticketDrillOf({ drill: 'triggered' })).toBeNull();
    expect(
      ticketDrillOf({ drill: 'triggered', drillFrom: '2026-09-10', letter: 'missed' }),
    ).toMatchObject({ letter: null });
  });
});

describe('计数行', () => {
  it('事件数等于工单数时「共 73 条」（原型）；多次重开时「共 75 次新建或重开 · 73 张工单」', () => {
    expect(drillCountWords({ kind: 'triggered', events: 73, letters: null, tickets: 73 })).toBe(
      '共 73 条',
    );
    expect(drillCountWords({ kind: 'triggered', events: 75, letters: null, tickets: 73 })).toBe(
      '共 75 次新建或重开 · 73 张工单',
    );
  });

  it('按封计「共 11 封来信 · 9 张工单」', () => {
    expect(drillCountWords({ kind: 'arrived', events: null, letters: 11, tickets: 9 })).toBe(
      '共 11 封来信 · 9 张工单',
    );
  });

  it('说明写出处与条件：原型的「每日工单量」柱逐字一致，其余出处照 PRD；没带出处写「条件与报表同口径」', () => {
    const bar = drillOf({ drill: 'triggered', drillFrom: '2026-09-10', origin: 'daily-bar' });
    expect(drillNoteWords(bar, TODAY)).toBe(
      '条件与报表「每日工单量」09-10 的柱同口径：客户来信触发的新建或重开 09-10',
    );
    const week = { drillFrom: '2026-09-04', drillTo: '2026-09-10' } as const;
    expect(
      drillNoteWords(
        drillOf({ drill: 'triggered', ...week, origin: 'daily-legend', drillChannel: 'amazon' }),
        TODAY,
      ),
    ).toBe(
      '条件与报表「每日工单量」图例「亚马逊」同口径：客户来信触发的新建或重开 09-04 至 09-10 · 亚马逊',
    );
    expect(
      drillNoteWords(drillOf({ drill: 'triggered', ...week, origin: 'daily-detail' }), TODAY),
    ).toBe('条件与报表「每日工单量」同口径：客户来信触发的新建或重开 09-04 至 09-10');
    expect(
      drillNoteWords(drillOf({ drill: 'triggered', ...week, origin: 'metric-volume' }), TODAY),
    ).toBe('条件与报表指标「工单量」同口径：客户来信触发的新建或重开 09-04 至 09-10');
    expect(
      drillNoteWords(
        drillOf({
          drill: 'arrived',
          ...week,
          letter: 'replied',
          origin: 'metric-first-response',
        }),
        TODAY,
      ),
    ).toBe('条件与报表指标「首响中位数」同口径：客户来信到达 09-04 至 09-10 · 已回复');
    expect(
      drillNoteWords(
        drillOf({
          drill: 'arrived',
          ...week,
          letter: 'missed',
          drillChannel: 'amazon',
          origin: 'metric-sla',
        }),
        TODAY,
      ),
    ).toBe('条件与报表指标「SLA 达标率（亚马逊）」同口径：亚马逊来信到达 09-04 至 09-10 · 未达标');
    expect(drillNoteWords(drillOf({ drill: 'triggered', drillFrom: '2026-09-10' }), TODAY)).toBe(
      '条件与报表同口径：客户来信触发的新建或重开 09-10',
    );
  });
});

describe('最近来信与「当前筛选」', () => {
  it('最近来信：几种「近 N 天」照叫法，自定义写起止', () => {
    expect(inboundWords('30d', null)).toBe('近 30 天');
    expect(inboundWords('today', null)).toBe('今天');
    expect(inboundWords('custom', { from: '2026-09-01', to: '2026-09-10' })).toBe(
      '2026-09-01 至 09-10',
    );
  });

  it('列表为空时「当前筛选」照 I10 的写法（「状态 已关闭 · 店铺 forcome.mx」），来自报表在最前、最近来信总写', () => {
    const stores = [{ value: 'mx', label: 'forcome.mx' }];
    expect(
      filterSummary(
        { status: 'closed', store: 'mx', source: 'producer' },
        { from: '2026-08-13', to: '2026-09-11' },
        stores,
        null,
        TODAY,
      ),
    ).toEqual(['状态 已关闭', '店铺 forcome.mx', '来源 生产厂', '最近来信 近 30 天']);
    expect(
      filterSummary(
        { channel: 'amazon', site: 'MX', inbound: '7d' },
        null,
        stores,
        drillOf({ drill: 'triggered', drillFrom: '2026-09-10' }),
        TODAY,
      ),
    ).toEqual([
      '来自报表 09-10 新建或重开 · 客户来信',
      '渠道 亚马逊',
      '站点 MX',
      '最近来信 近 7 天',
    ]);
  });
});
