import { describe, expect, it } from 'vitest';
import {
  clearedSearch,
  currentSort,
  isDefaultSearch,
  sortedBy,
  ticketQueryOf,
  ticketsSearchSchema,
  withFilter,
  withoutDrill,
} from './tickets-search';

/*
 * P04 地址栏里的条件（待办 18）：经 zod 校验写进地址栏，可分享与回退；从地址栏直接打开带筛选或下钻参数的 P04 能还原条件。
 */

describe('地址栏的条件', () => {
  it('带筛选、下钻、排序与页码的地址原样还原（页面按它显示芯片与计数行）', () => {
    const search = ticketsSearchSchema.parse({
      status: 'awaiting_reply',
      channel: 'amazon',
      store: '8adf47ec-435b-55d3-bd18-f3429dbee2df',
      site: 'US',
      source: 'customer',
      inbound: 'custom',
      from: '2026-09-01',
      to: '2026-09-11',
      drill: 'triggered',
      drillFrom: '2026-09-10',
      drillChannel: 'amazon',
      origin: 'daily-bar',
      sort: 'last_inbound',
      dir: 'asc',
      page: 2,
    });
    expect(search).toMatchObject({ status: 'awaiting_reply', drill: 'triggered', page: 2 });
    // 交给接口的条件与地址栏同名，去掉页面视图
    expect(ticketQueryOf({ ...search, view: 'unassigned' })).toEqual({
      status: 'awaiting_reply',
      channel: 'amazon',
      store: '8adf47ec-435b-55d3-bd18-f3429dbee2df',
      site: 'US',
      source: 'customer',
      inbound: 'custom',
      from: '2026-09-01',
      to: '2026-09-11',
      drill: 'triggered',
      drillFrom: '2026-09-10',
      drillChannel: 'amazon',
      origin: 'daily-bar',
      sort: 'last_inbound',
      dir: 'asc',
      page: 2,
    });
  });

  it('写错的条件丢掉，其余照用；地址栏手写的页码数字两种都认，1 不写', () => {
    expect(
      ticketsSearchSchema.parse({
        status: 'open',
        channel: 'amazon',
        inbound: 'all',
        drillFrom: '09-10',
        letter: 'late',
        origin: 'somewhere',
        sort: 'subject',
        page: '1',
      }),
    ).toEqual({ channel: 'amazon' });
    expect(ticketsSearchSchema.parse({ page: '3' })).toEqual({ page: 3 });
  });

  it('最近来信不是自定义时不带起止', () => {
    expect(ticketQueryOf({ inbound: '7d', from: '2026-09-01', to: '2026-09-02' })).toEqual({
      inbound: '7d',
    });
  });
});

describe('默认与清除', () => {
  it('默认：最近来信近 30 天、其余都没选、没有下钻；排序与页码不算筛选', () => {
    expect(isDefaultSearch({})).toBe(true);
    expect(isDefaultSearch({ inbound: '30d', sort: 'last_inbound', page: 2 })).toBe(true);
    expect(isDefaultSearch({ inbound: '7d' })).toBe(false);
    expect(isDefaultSearch({ site: 'MX' })).toBe(false);
    expect(isDefaultSearch({ drill: 'triggered', drillFrom: '2026-09-10' })).toBe(false);
    // 缺了起始日的下钻当作没有
    expect(isDefaultSearch({ drill: 'triggered' })).toBe(true);
  });

  it('清除筛选回到默认、保留排序；移除「来自报表」只去掉下钻条件；改筛选回到第一页', () => {
    const search = {
      status: 'closed' as const,
      drill: 'arrived' as const,
      drillFrom: '2026-09-04',
      drillTo: '2026-09-10',
      letter: 'missed' as const,
      drillChannel: 'amazon' as const,
      origin: 'metric-sla' as const,
      sort: 'last_inbound' as const,
      dir: 'desc' as const,
      page: 3,
    };
    expect(clearedSearch(search)).toEqual({ sort: 'last_inbound', dir: 'desc' });
    expect(withoutDrill(search)).toEqual({
      status: 'closed',
      sort: 'last_inbound',
      dir: 'desc',
      page: undefined,
    });
    expect(withFilter(search, { site: 'US' })).toMatchObject({ site: 'US', page: undefined });
  });
});

describe('表头排序', () => {
  it('没写为 SLA 剩余 ↑；点 SLA 剩余反过来，再点回到默认（地址栏不写）', () => {
    expect(currentSort({})).toEqual({ sort: 'sla', dir: 'asc' });
    const desc = sortedBy({}, 'sla');
    expect(desc).toMatchObject({ sort: 'sla', dir: 'desc' });
    expect(sortedBy(desc, 'sla')).toMatchObject({ sort: undefined, dir: undefined });
  });

  it('点最近来信先 ↓ 最新在前，再点 ↑；换列回到第一页', () => {
    const latest = sortedBy({ page: 2 }, 'last_inbound');
    expect(latest).toMatchObject({ sort: 'last_inbound', dir: 'desc', page: undefined });
    expect(currentSort(sortedBy(latest, 'last_inbound'))).toEqual({
      sort: 'last_inbound',
      dir: 'asc',
    });
    expect(sortedBy(latest, 'sla')).toMatchObject({ sort: undefined, dir: undefined });
  });
});
