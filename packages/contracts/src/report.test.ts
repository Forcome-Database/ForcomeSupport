import { describe, expect, it } from 'vitest';
import {
  isEmptyTicketReport,
  reportDrillQuery,
  reportPreviousRange,
  reportRange,
  slaRate,
} from './report';
import { ticketDrillOf, ticketInboundRange, ticketListQuerySchema } from './ticket-list';

/*
 * P17 工单部分的期间、对比的上一周期与下钻条件（PRD P17「指标口径」v2.34、K19，待办 24；协调者 2026-10-14 决定 Q2、Q3）。
 * 示例取原型：演示日 09-11，近 7 天 09-05 至 09-11，09-10 的柱。
 */

const TODAY = '2026-09-11';

describe('期间（近 7 天默认 · 本月 · 自定义）', () => {
  it('近 7 天含今天；本月从 1 日到今天', () => {
    expect(reportRange({}, TODAY)).toEqual({ period: '7d', from: '2026-09-05', to: TODAY });
    expect(reportRange({ period: 'month' }, TODAY)).toEqual({
      period: 'month',
      from: '2026-09-01',
      to: TODAY,
    });
  });

  it('自定义：起止颠倒时对调，没给的一端取今天，晚于今天的取今天（不能选今天之后）', () => {
    expect(reportRange({ period: 'custom', from: '2026-09-03', to: '2026-09-01' }, TODAY)).toEqual({
      period: 'custom',
      from: '2026-09-01',
      to: '2026-09-03',
    });
    expect(reportRange({ period: 'custom', from: '2026-09-08' }, TODAY)).toMatchObject({
      from: '2026-09-08',
      to: TODAY,
    });
    expect(
      reportRange({ period: 'custom', from: '2026-09-08', to: '2026-10-02' }, TODAY),
    ).toMatchObject({
      from: '2026-09-08',
      to: TODAY,
    });
  });
});

describe('对比的上一周期', () => {
  it('近 7 天对比之前 7 天；自定义对比之前等长区间', () => {
    expect(reportPreviousRange(reportRange({}, TODAY))).toEqual({
      from: '2026-08-29',
      to: '2026-09-04',
    });
    expect(
      reportPreviousRange(
        reportRange({ period: 'custom', from: '2026-09-01', to: '2026-09-03' }, TODAY),
      ),
    ).toEqual({ from: '2026-08-29', to: '2026-08-31' });
  });

  it('本月对比上月同期：上月 1 日到上月同一天，上月没有这一天取月末；1 月对比上一年 12 月', () => {
    expect(reportPreviousRange(reportRange({ period: 'month' }, TODAY))).toEqual({
      from: '2026-08-01',
      to: '2026-08-11',
    });
    expect(reportPreviousRange(reportRange({ period: 'month' }, '2026-03-31'))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(reportPreviousRange(reportRange({ period: 'month' }, '2027-01-05'))).toEqual({
      from: '2026-12-01',
      to: '2026-12-05',
    });
  });
});

describe('达标率与无数据', () => {
  it('达标率 = 达标 ÷（达标 + 未达标）；分母为 0 时为空（AC-P1-12：分母 2，达标率 50%）', () => {
    expect(slaRate({ met: 1, counted: 2 })).toBe(50);
    expect(slaRate({ met: 0, counted: 0 })).toBeNull();
  });

  it('工单量为 0 且没有到达的客户来信才是无数据（K4）', () => {
    const none = { volume: 0, firstResponseMs: null, sla: { met: 0, counted: 0 } };
    expect(isEmptyTicketReport({ current: none, arrived: 0 })).toBe(true);
    expect(isEmptyTicketReport({ current: none, arrived: 1 })).toBe(false);
    expect(isEmptyTicketReport({ current: { ...none, volume: 1 }, arrived: 0 })).toBe(false);
  });
});

describe('下钻到 P04 的条件（与指标同口径，参数是 P04 的 ticketListQuerySchema）', () => {
  const week = { range: { from: '2026-09-05', to: TODAY } };

  it('柱：只给 drillFrom 为单天、按事件计，出处 daily-bar；起始日在近 30 天内时不写最近来信', () => {
    const query = reportDrillQuery({ from: 'daily-bar', date: '2026-09-10' }, week, TODAY);
    expect(query).toEqual({ drill: 'triggered', drillFrom: '2026-09-10', origin: 'daily-bar' });
    expect(ticketListQuerySchema.parse(query)).toEqual(query);
    expect(ticketDrillOf(query)).toMatchObject({
      kind: 'triggered',
      range: { from: '2026-09-10', to: '2026-09-10' },
    });
  });

  it('指标与查看明细按期间；首响带已回复，SLA 带亚马逊与未达标；图例带渠道；带报表的店铺与站点', () => {
    const store = '0190a0b0-0000-7000-8000-000000000001';
    const filters = { ...week, store, site: 'MX' as const };
    expect(reportDrillQuery({ from: 'metric-volume' }, filters, TODAY)).toEqual({
      drill: 'triggered',
      drillFrom: '2026-09-05',
      drillTo: TODAY,
      origin: 'metric-volume',
      store,
      site: 'MX',
    });
    expect(reportDrillQuery({ from: 'metric-first-response' }, week, TODAY)).toMatchObject({
      drill: 'arrived',
      letter: 'replied',
      origin: 'metric-first-response',
    });
    expect(reportDrillQuery({ from: 'metric-sla' }, week, TODAY)).toMatchObject({
      drill: 'arrived',
      letter: 'missed',
      drillChannel: 'amazon',
      origin: 'metric-sla',
    });
    expect(
      reportDrillQuery({ from: 'daily-legend', channel: 'shopify_email' }, week, TODAY),
    ).toMatchObject({ drill: 'triggered', drillChannel: 'shopify_email', origin: 'daily-legend' });
    expect(reportDrillQuery({ from: 'daily-detail' }, week, TODAY)).toMatchObject({
      drill: 'triggered',
      origin: 'daily-detail',
    });
  });

  it('起始日早于近 30 天的起点：一并带自定义「起始日 至 今天」，P04 的最近来信不会筛掉下钻对象', () => {
    // 近 30 天的起点是 08-13：08-13 起不写，08-12 起要带
    expect(
      reportDrillQuery(
        { from: 'metric-volume' },
        { range: { from: '2026-08-13', to: TODAY } },
        TODAY,
      ),
    ).not.toHaveProperty('inbound');
    const query = reportDrillQuery(
      { from: 'metric-volume' },
      { range: { from: '2026-08-12', to: '2026-08-31' } },
      TODAY,
    );
    expect(query).toMatchObject({ inbound: 'custom', from: '2026-08-12', to: TODAY });
    expect(ticketInboundRange(query, TODAY)).toEqual({
      period: 'custom',
      from: '2026-08-12',
      to: TODAY,
    });
  });
});
