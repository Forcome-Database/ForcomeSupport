import type {
  OrderCard,
  TicketDetail,
  TicketMessage,
  TicketStatusStep,
  TicketTimelineEvent,
} from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import {
  autoCloseWords,
  closeRuleWords,
  dayLabel,
  durationWords,
  eventWords,
  orderWords,
  slaLine,
  stepWords,
} from './p05-words';

const iso = (at: string) => new Date(at).toISOString();

const step = (overrides: Partial<TicketStatusStep>): TicketStatusStep => ({
  at: iso('2026-09-04T10:12:00+08:00'),
  event: 'inbound',
  from: null,
  to: 'awaiting_reply',
  trigger: 'system',
  actorName: '系统',
  closeReason: null,
  ...overrides,
});

describe('时间的写法（北京时间）', () => {
  it('日期分隔条写「09-04 周五」', () => {
    expect(dayLabel(iso('2026-09-04T10:12:00+08:00'))).toBe('09-04 周五');
    expect(dayLabel(iso('2026-09-05T23:59:00+08:00'))).toBe('09-05 周六');
    expect(dayLabel(iso('2026-09-06T00:30:00+08:00'))).toBe('09-06 周日');
  });

  it('首次回复时长：不足 1 小时写分钟，不足 1 天写「6h 32m」（分钟补两位），满 1 天写「1d 3h」', () => {
    expect(durationWords(28 * 60_000)).toBe('28m');
    expect(durationWords((6 * 60 + 32) * 60_000)).toBe('6h 32m');
    expect(durationWords((2 * 60 + 5) * 60_000 + 59_000)).toBe('2h 05m');
    expect(durationWords((27 * 60 + 10) * 60_000)).toBe('1d 3h');
    expect(durationWords(0)).toBe('0m');
  });
});

describe('元信息与状态流转卡头的自动关闭（Q6 d）', () => {
  const detail = (status: TicketDetail['ticket']['status'], extra: Partial<TicketDetail> = {}) =>
    ({
      ticket: { status },
      autoClose: null,
      statusFlow: [],
      ...extra,
    }) as unknown as TicketDetail;

  it('已解决、等客户写状态前缀；待回复照 PRD 例句不写', () => {
    expect(
      autoCloseWords(
        detail('resolved', {
          autoClose: { at: iso('2026-09-17T09:00:00+08:00'), reason: 'resolved_no_inbound' },
        }),
      ),
    ).toBe('已解决 · 7 天无来信将于 09-17 09:00 自动关闭（已解决后无来信）');
    expect(
      autoCloseWords(
        detail('awaiting_customer', {
          autoClose: { at: iso('2026-09-17T10:05:00+08:00'), reason: 'customer_no_reply' },
        }),
      ),
    ).toBe('等客户 · 7 天无来信将于 09-17 10:05 自动关闭（客户未回复）');
    expect(
      autoCloseWords(
        detail('awaiting_reply', {
          autoClose: { at: iso('2026-09-24T16:00:00+08:00'), reason: 'reply_not_detected' },
        }),
      ),
    ).toBe('14 天无新来信将于 09-24 16:00 自动关闭（未识别到回复）');
  });

  it('已关闭写实际关闭时刻与原因', () => {
    expect(
      autoCloseWords(
        detail('closed', {
          statusFlow: [
            step({}),
            step({
              at: iso('2026-09-09T10:30:00+08:00'),
              event: 'idle_7_days',
              from: 'awaiting_customer',
              to: 'closed',
              closeReason: 'customer_no_reply',
            }),
          ],
        }),
      ),
    ).toBe('已关闭 · 09-09 10:30 自动关闭（客户未回复）');
  });

  it('状态流转卡头：未关闭写规则，已关闭不写', () => {
    expect(closeRuleWords('resolved')).toBe('已解决 7 天无来信自动关闭');
    expect(closeRuleWords('awaiting_reply')).toBe('待回复 14 天无新来信自动关闭');
    expect(closeRuleWords('awaiting_customer')).toBe('等客户 7 天无来信自动关闭');
    expect(closeRuleWords('closed')).toBeNull();
  });
});

describe('事件行与状态流转的写法（Q6 e）', () => {
  const status = (s: Partial<TicketStatusStep>): TicketTimelineEvent => ({
    kind: 'status',
    ...step(s),
  });
  const noReply = (
    action: 'mark' | 'undo',
    to: TicketTimelineEvent['to'],
  ): TicketTimelineEvent => ({
    kind: 'no_reply',
    at: iso('2026-09-10T09:05:00+08:00'),
    action,
    actorName: '李婷',
    messageId: '00000000-0000-7000-8000-000000000000',
    to,
  });

  it('系统事件', () => {
    expect(eventWords(status({}))).toEqual({ actor: '系统', text: '新建工单，状态「待回复」' });
    expect(eventWords(status({ from: 'awaiting_customer' })).text).toBe('新来信，回到「待回复」');
    expect(eventWords(status({ event: 'inbound_reopen', from: 'closed' })).text).toBe(
      '同一订单来信，重开为「待回复」',
    );
    expect(
      eventWords(
        status({ event: 'reply_detected', from: 'awaiting_reply', to: 'awaiting_customer' }),
      ).text,
    ).toBe('识别到我方回复，转「等客户」');
    expect(
      eventWords(status({ event: 'idle_7_days', to: 'closed', closeReason: 'customer_no_reply' }))
        .text,
    ).toBe('7 天无来信，关闭（客户未回复）');
    expect(
      eventWords(status({ event: 'idle_14_days', to: 'closed', closeReason: 'reply_not_detected' }))
        .text,
    ).toBe('14 天无新来信，关闭（未识别到回复）');
  });

  it('标记与撤销：引起状态变化的写目标状态，没有的只写动作', () => {
    expect(eventWords(noReply('mark', 'resolved'))).toEqual({
      actor: '人工',
      text: '李婷标记无需回复，转「已解决」',
    });
    expect(eventWords(noReply('mark', null)).text).toBe('李婷标记无需回复');
    expect(eventWords(noReply('undo', 'awaiting_reply')).text).toBe(
      '李婷撤销标记无需回复，回到「待回复」',
    );
    expect(eventWords(noReply('undo', null)).text).toBe('李婷撤销标记无需回复');
  });

  it('状态流转每步写「触发方 · 事件」，实际关闭的那步后面写关闭原因', () => {
    expect(stepWords(step({}))).toBe('系统 · 新建');
    expect(stepWords(step({ from: 'awaiting_customer' }))).toBe('系统 · 新来信');
    expect(stepWords(step({ event: 'reply_detected', to: 'awaiting_customer' }))).toBe(
      '系统 · 识别到我方回复',
    );
    expect(
      stepWords(step({ event: 'all_marked_no_reply', actorName: '李婷', trigger: 'member' })),
    ).toBe('李婷 · 标记无需回复');
    expect(
      stepWords(step({ event: 'undo_mark_no_reply', actorName: '李婷', trigger: 'member' })),
    ).toBe('李婷 · 撤销标记无需回复');
    expect(stepWords(step({ event: 'inbound_reopen' }))).toBe('系统 · 重开');
    expect(
      stepWords(step({ event: 'idle_7_days', to: 'closed', closeReason: 'customer_no_reply' })),
    ).toBe('系统 · 7 天无来信（客户未回复）');
    expect(
      stepWords(step({ event: 'idle_14_days', to: 'closed', closeReason: 'reply_not_detected' })),
    ).toBe('系统 · 14 天无新来信（未识别到回复）');
  });
});

describe('SLA 结果一行（Q6 b、c）', () => {
  const now = new Date('2026-09-10T10:20:00+08:00');
  const letter = (overrides: Partial<TicketMessage>): TicketMessage => ({
    id: '00000000-0000-7000-8000-000000000000',
    direction: 'inbound',
    mailbox: 'amz-direct@forcome.com',
    from: { name: 'Oliver Grant', address: 'x@marketplace.amazon.ca' },
    source: 'customer',
    channel: 'amazon',
    subject: 'Hi',
    arrivedAt: iso('2026-09-10T04:40:00+08:00'),
    alsoSentTo: [],
    autoReply: false,
    autoReplyHeader: null,
    firstReplyAt: null,
    sla: { target: 'platform', dueAt: iso('2026-09-11T04:40:00+08:00'), result: 'pending' },
    body: 'Hi',
    noReply: null,
    ...overrides,
  });

  it('达标与回复晚于截止的未达标写首次回复时长', () => {
    expect(
      slaLine(
        letter({
          firstReplyAt: iso('2026-09-10T05:08:00+08:00'),
          sla: { target: 'platform', dueAt: iso('2026-09-11T04:40:00+08:00'), result: 'met' },
        }),
        now,
      ),
    ).toEqual({
      arrival: '09-10 04:40 来信',
      result: '首次回复 28m',
      note: '达标',
      tone: 'success',
    });
    expect(
      slaLine(
        letter({
          firstReplyAt: iso('2026-09-11T07:50:00+08:00'),
          sla: { target: 'platform', dueAt: iso('2026-09-11T04:40:00+08:00'), result: 'missed' },
        }),
        now,
      ),
    ).toMatchObject({ result: '首次回复 1d 3h', note: '未达标', tone: 'danger' });
  });

  it('还没回复：剩余按 R-SL-03 着色（内部目标加「· 内部」），过了截止写已超时、未达标', () => {
    expect(slaLine(letter({}), new Date('2026-09-10T23:00:00+08:00'))).toMatchObject({
      result: '剩 5h 40m',
      note: '未到期',
      tone: 'warning',
    });
    expect(
      slaLine(
        letter({
          sla: { target: 'internal', dueAt: iso('2026-09-11T04:40:00+08:00'), result: 'pending' },
        }),
        now,
      ),
    ).toMatchObject({ result: '剩 18h 20m · 内部', note: '未到期', tone: 'neutral' });
    expect(
      slaLine(
        letter({
          sla: { target: 'platform', dueAt: iso('2026-09-10T08:15:00+08:00'), result: 'missed' },
        }),
        now,
      ),
    ).toMatchObject({ result: '已超时 2h 05m', note: '未达标', tone: 'danger' });
    // 过了截止、每分钟的扫描还没改成未达标的，照样写未达标
    expect(
      slaLine(
        letter({
          sla: { target: 'platform', dueAt: iso('2026-09-10T10:00:00+08:00'), result: 'pending' },
        }),
        now,
      ),
    ).toMatchObject({ result: '已超时 0h 20m', note: '未达标', tone: 'danger' });
  });

  it('无需回复写标记人，不计；生产厂、其他供应商的来信不计', () => {
    expect(
      slaLine(
        letter({
          noReply: { by: '李婷', at: iso('2026-09-10T09:05:00+08:00') },
          sla: {
            target: 'platform',
            dueAt: iso('2026-09-11T04:40:00+08:00'),
            result: 'not_required',
          },
        }),
        now,
      ),
    ).toMatchObject({ result: '无需回复 · 李婷', note: '不计', tone: 'muted' });
    expect(slaLine(letter({ source: 'producer', sla: null }), now)).toMatchObject({
      result: '生产厂来信',
      note: '不计（生产厂）',
      tone: 'muted',
    });
    expect(slaLine(letter({ source: 'other_supplier', sla: null }), now)).toMatchObject({
      result: '其他供应商来信',
      note: '不计（其他供应商）',
    });
  });
});

describe('订单卡（Q1、Q2）', () => {
  const amazon: OrderCard = {
    number: '204-5566778-9900112',
    platform: 'amazon',
    status: 'SHIPPED',
    cancelled: false,
    updatedAt: iso('2026-08-26T16:20:00+08:00'),
    syncedAt: iso('2026-09-10T09:02:00+08:00'),
    items: [{ title: '车载吸尘器 V2 黑色', quantity: 1 }],
    total: { amount: '67.99', currency: 'CAD' },
    usd: '49.99',
    fulfillmentChannel: 'MFN',
    promisedDeliveryBy: iso('2026-08-27T23:59:00+08:00'),
    shipTo: { city: 'Toronto', province: 'ON', country: 'CA' },
    tracking: [{ company: 'Canada Post', number: '7316204855219087' }],
  };

  it('亚马逊订单照原型（状态写平台履约状态，日期写「更新于」）', () => {
    expect(orderWords(amazon, new Date('2026-09-10T09:05:00+08:00'))).toEqual({
      synced: '平台镜像 · 最近同步 09:02',
      status: '已发货',
      updated: '更新于 08-26',
      items: '车载吸尘器 V2 黑色 ×1',
      amount: 'CA$67.99（≈ $49.99）',
      fulfillment: 'MFN（自发货）',
      promise: '08-27',
      shipTo: 'Toronto, ON, CA',
      carrier: 'Canada Post 7316204855219087',
    });
  });

  it('Shopify 订单没有履约方式与承诺送达；没有值写「—」；同步不在今天时带日期', () => {
    const shopify: OrderCard = {
      ...amazon,
      number: '#1057',
      platform: 'shopify',
      status: 'UNFULFILLED',
      total: { amount: '54.99', currency: 'USD' },
      usd: null,
      fulfillmentChannel: null,
      promisedDeliveryBy: null,
      shipTo: { city: 'San Francisco', province: 'CA', country: 'US' },
      tracking: [],
      items: [
        { title: 'V2 车载吸尘器 黑色', quantity: 1 },
        { title: 'HEPA 滤芯', quantity: 2 },
      ],
    };
    expect(orderWords(shopify, new Date('2026-09-11T10:20:00+08:00'))).toMatchObject({
      synced: '平台镜像 · 最近同步 09-10 09:02',
      status: '未发货',
      items: 'V2 车载吸尘器 黑色 ×1、HEPA 滤芯 ×2',
      amount: '$54.99',
      fulfillment: null,
      promise: null,
      carrier: '—',
    });
    expect(orderWords({ ...shopify, cancelled: true }, new Date()).status).toBe('已取消');
    expect(orderWords({ ...amazon, status: 'SOMETHING_NEW' }, new Date()).status).toBe(
      'SOMETHING_NEW',
    );
    expect(
      orderWords({ ...amazon, total: null, usd: null, shipTo: null, items: [] }, new Date()),
    ).toMatchObject({ amount: '—', shipTo: '—', items: '—' });
  });
});
