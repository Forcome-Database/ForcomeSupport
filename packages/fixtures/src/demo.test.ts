import { describe, expect, it } from 'vitest';
import { demoFixture, sumUsd } from './index';

// 夹具转换规则见 scripts/fixtures/export_demo_fixture.py；这里在 JSON 层核对按原型数据验收的数字
describe('示例数据夹具（design/spec/data.py → JSON）', () => {
  it('第一期工单 16 张：p1_tickets() 的 13 张加 3 张第一期补充工单', () => {
    expect(demoFixture.tickets).toHaveLength(16);
    expect(new Set(demoFixture.tickets.map((t) => t.no)).size).toBe(16);
    expect(new Set(demoFixture.tickets.map((t) => t.status))).toEqual(
      new Set(['待回复', '等客户', '已解决', '已关闭']),
    );
  });

  it('台账费用合计 $188.79（AC-RP-01 的原型数字；待确认的单已丢弃）', () => {
    const fees = demoFixture.ledger.flatMap((row) => Object.values(row.fees));
    expect(sumUsd(fees)).toBe('188.79');
    expect(demoFixture.ledger).toHaveLength(12);
    expect(demoFixture.ledger.map((row) => row.no)).not.toContain('S-20260911-0022');
  });

  it('第一期台账一律为手工登记，登记人取负责人', () => {
    for (const row of demoFixture.ledger) {
      expect(row.createdVia).toBe('手工登记');
      expect(row.registeredByKey).toBe(row.ownerKey);
    }
  });

  it('Fake 汇率固定为演示汇率：1 USD = 18.00 MXN、1.36 CAD', () => {
    expect(demoFixture.exchangeRates).toEqual({
      base: 'USD',
      quotes: { MXN: '18.00', CAD: '1.36' },
    });
    // 额外赔偿 MX$889.00 按 18.00 折算并冻结为 $49.39（四舍五入到分）
    const mateo = demoFixture.ledger.find((row) => row.no === 'S-20260911-0020');
    expect(mateo?.fees.compensation).toEqual({
      amount: '889.00',
      currency: 'MXN',
      usd: '49.39',
      rateDate: '2026-09-10',
    });
  });

  it('P05 时间线取 Oliver Grant 的工单（I18）', () => {
    const timeline = demoFixture.ticketTimeline;
    expect(timeline.ticket).toBe('T-20260904-0098');
    expect(demoFixture.tickets.map((t) => t.no)).toContain(timeline.ticket);
    expect(timeline.statusFlow.at(-1)).toEqual({
      status: '已解决',
      at: '2026-09-10T09:05:00+08:00',
      actor: '李婷',
      event: '标记无需回复',
    });
  });

  it('工单与台账引用的店铺、成员都在夹具里', () => {
    const storeKeys = new Set(demoFixture.stores.map((s) => s.key));
    const memberKeys = new Set(demoFixture.members.map((m) => m.key));
    for (const t of demoFixture.tickets) expect(storeKeys).toContain(t.storeKey);
    for (const row of demoFixture.ledger) {
      expect(storeKeys).toContain(row.storeKey);
      expect(memberKeys).toContain(row.ownerKey);
    }
  });

  it('演示时刻是 2026-09-11 10:20 北京时间', () => {
    expect(new Date(demoFixture.meta.now).toISOString()).toBe('2026-09-11T02:20:00.000Z');
  });
});

describe('sumUsd：按分累加，避免浮点误差', () => {
  it('跳过未填（null）的费用项', () => {
    expect(sumUsd([{ usd: '0.10' }, { usd: '0.20' }, null])).toBe('0.30');
  });

  it('没有费用时为 0.00', () => {
    expect(sumUsd([])).toBe('0.00');
  });
});
