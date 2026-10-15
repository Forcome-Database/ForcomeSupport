import {
  amazonDomains,
  auditLogSchema,
  noReplyMessages,
  ticketDetailSchema,
  ticketListSchema,
  type TicketDetail,
  type TicketListItem,
  type TicketMessage,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncExchangeRatesJob } from '../src/modules/core';
import { gmailClient, type FakeGmail, type FakeMailInput } from '../src/modules/integration';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * P05 工单详情与「标记无需回复」（待办 17；PRD P05「第一阶段」、I18、6.1 第一阶段迁移表、AC-P1-01；
 * 协调者 2026-10-07 决定 Q1–Q6）：Fake Gmail 放来信与我方回信 → 跑完任务 → 以坐席等角色调工单详情与标记、撤销接口断言。
 * 各用例用不同的客户，只断言自己的工单。
 */

const fixture = getDemoFixture();
const AUTO = fixture.stores.find((s) => s.name === 'Forcome Auto')!;
const DIRECT = fixture.stores.find((s) => s.name === 'Forcome Direct')!;
const RELAY_US = amazonDomains.US.relay;
const slug = (buyer: string) => buyer.toLowerCase().replace(/\W+/g, '.');
const relayOf = (buyer: string) => `${slug(buyer)}@${RELAY_US}`;
const iso = (at: string) => new Date(at).toISOString();

function amazonLetter(
  buyer: string,
  messageId: string,
  at: string,
  store: { mailbox: string } = AUTO,
): FakeMailInput {
  return {
    to: store.mailbox,
    from: { name: buyer, address: relayOf(buyer) },
    subject: 'Question about my order',
    text: `Hello from ${buyer}`,
    at,
    messageId,
  };
}

async function ticketList(client: ApiClient): Promise<TicketListItem[]> {
  const res = await client.get('/api/tickets');
  expect(res.status).toBe(200);
  return ticketListSchema.parse(await res.json()).tickets;
}

async function detailOf(client: ApiClient, number: string): Promise<TicketDetail> {
  const res = await client.get(`/api/tickets/${number}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ticketDetailSchema.parse(await res.json());
}

async function onlyTicketOf(client: ApiClient, customer: string): Promise<TicketDetail> {
  const tickets = (await ticketList(client)).filter((tk) => tk.customer.name === customer);
  expect(tickets).toHaveLength(1);
  return detailOf(client, tickets[0]!.number);
}

const inbound = (detail: TicketDetail) => detail.messages.filter((m) => m.direction === 'inbound');

function mark(client: ApiClient, number: string, message: TicketMessage) {
  return client.post(`/api/tickets/${number}/messages/${message.id}/no-reply`, {});
}

function undo(client: ApiClient, number: string, message: TicketMessage) {
  return client.post(`/api/tickets/${number}/messages/${message.id}/undo-no-reply`, {});
}

async function ok(res: Response): Promise<TicketDetail> {
  expect(res.status, await res.clone().text()).toBe(200);
  return ticketDetailSchema.parse(await res.json());
}

async function refused(res: Response, status: number, message: string): Promise<void> {
  expect(res.status).toBe(status);
  expect(((await res.json()) as { message: string }).message).toBe(message);
}

describe('标记无需回复（AC-P1-01）', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let agent: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness({ now: '2026-09-10T09:00:00+08:00' });
    await t.loadFixtures();
    // 本文件测 Gmail 收信，用到示例的 amz-auto@forcome.com（示例里是 163 企业邮箱，待办 35）
    await t.useGmailForFixtureMailboxes();
    gmail = t.clients.fake(gmailClient);
    await t.runJobs();
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  /** 一张待回复工单，两封未回复来信 */
  async function twoLetters(buyer: string): Promise<TicketDetail> {
    t.clock.set('2026-09-10T10:01:00+08:00');
    gmail.deliver(
      amazonLetter(buyer, `<${slug(buyer)}-1@buyer.example>`, '2026-09-10T09:50:00+08:00'),
    );
    gmail.deliver(
      amazonLetter(buyer, `<${slug(buyer)}-2@buyer.example>`, '2026-09-10T10:00:00+08:00'),
    );
    await t.runJobs();
    return onlyTicketOf(agent, buyer);
  }

  it('两封都标记 → 已解决、两封都不计 SLA；5 秒内撤销第二封 → 回到待回复、恢复计时；事件行与状态流转都留着，记审计', async () => {
    const before = await twoLetters('Ann Mark');
    const number = before.ticket.number;
    const [first, second] = inbound(before);
    expect(before.ticket.status).toBe('awaiting_reply');
    expect(inbound(before).map((m) => m.sla?.result)).toEqual(['pending', 'pending']);

    t.clock.set('2026-09-10T10:05:00+08:00');
    const one = await ok(await mark(agent, number, first!));
    // 还有一封未回复来信：工单不变，这封不计 SLA，卡上写操作人与时刻，生成一条没有状态变化的事件行
    expect(one.ticket.status).toBe('awaiting_reply');
    expect(inbound(one).map((m) => [m.noReply, m.sla?.result])).toEqual([
      [{ by: '李婷', at: iso('2026-09-10T10:05:00+08:00') }, 'not_required'],
      [null, 'pending'],
    ]);
    expect(one.events.at(-1)).toEqual({
      kind: 'no_reply',
      at: iso('2026-09-10T10:05:00+08:00'),
      action: 'mark',
      actorName: '李婷',
      messageId: first!.id,
      to: null,
    });

    t.clock.set('2026-09-10T10:06:00+08:00');
    const both = await ok(await mark(agent, number, second!));
    expect(both.ticket.status).toBe('resolved');
    expect(inbound(both).map((m) => m.sla?.result)).toEqual(['not_required', 'not_required']);
    expect(both.events.at(-1)).toMatchObject({ kind: 'no_reply', action: 'mark', to: 'resolved' });
    expect(both.statusFlow.at(-1)).toEqual({
      at: iso('2026-09-10T10:06:00+08:00'),
      event: 'all_marked_no_reply',
      from: 'awaiting_reply',
      to: 'resolved',
      trigger: 'member',
      actorName: '李婷',
      closeReason: null,
    });
    // 已解决 7 天无来信自动关闭，从最近一封来信起算
    expect(both.autoClose).toEqual({
      at: iso('2026-09-17T10:00:00+08:00'),
      reason: 'resolved_no_inbound',
    });

    t.clock.set('2026-09-10T10:06:04+08:00');
    const undone = await ok(await undo(agent, number, second!));
    expect(undone.ticket.status).toBe('awaiting_reply');
    expect(inbound(undone).map((m) => [m.noReply?.by ?? null, m.sla?.result])).toEqual([
      ['李婷', 'not_required'],
      [null, 'pending'],
    ]);
    // 历史不删：标记两行、撤销追加一行；状态流转 新建 → 已解决 → 待回复
    expect(undone.events.filter((e) => e.kind === 'no_reply').map((e) => [e.action, e.to])).toEqual(
      [
        ['mark', null],
        ['mark', 'resolved'],
        ['undo', 'awaiting_reply'],
      ],
    );
    expect(undone.statusFlow.map((s) => [s.event, s.to, s.actorName])).toEqual([
      ['inbound', 'awaiting_reply', '系统'],
      ['all_marked_no_reply', 'resolved', '李婷'],
      ['undo_mark_no_reply', 'awaiting_reply', '李婷'],
    ]);
    expect(undone.autoClose).toEqual({
      at: iso('2026-09-24T10:00:00+08:00'),
      reason: 'reply_not_detected',
    });

    const records = (await t.auditRecords({ objectType: 'ticket' })).filter(
      (r) => r.objectLabel === number,
    );
    expect(records.map((r) => [r.action, r.actorName, r.objectType, r.storeId])).toEqual([
      ['ticket.mark_no_reply', '李婷', 'ticket', AUTO.id],
      ['ticket.mark_no_reply', '李婷', 'ticket', AUTO.id],
      ['ticket.undo_no_reply', '李婷', 'ticket', AUTO.id],
    ]);
    const letter = { name: 'Ann Mark', at: iso('2026-09-10T10:00:00+08:00') };
    expect(records.at(1)).toMatchObject({
      before: { message: letter, noReply: null, status: 'awaiting_reply' },
      after: {
        message: letter,
        noReply: { name: '李婷', at: iso('2026-09-10T10:06:00+08:00') },
        status: 'resolved',
      },
    });
    expect(records.at(2)).toMatchObject({
      before: { noReply: { name: '李婷' }, status: 'resolved' },
      after: { noReply: null, status: 'awaiting_reply' },
    });
  });

  it('P27：标记无需回复记在工单对象上（摘要、前后值、点进 P05 的工单号），按工单的店铺过滤（10.2）', async () => {
    const detail = await twoLetters('Hal Audit');
    const number = detail.ticket.number;
    t.clock.set('2026-09-10T10:05:00+08:00');
    await ok(await mark(agent, number, inbound(detail)[0]!));
    t.clock.set('2026-09-10T10:06:00+08:00');
    await ok(await mark(agent, number, inbound(detail)[1]!));

    const auditOf = async (client: ApiClient) => {
      const res = await client.get(`/api/audit?type=ticket&q=${number}`);
      expect(res.status).toBe(200);
      return auditLogSchema.parse(await res.json()).entries;
    };
    const entries = await auditOf(await t.loginAs('客服主管'));
    expect(
      entries.map((e) => [e.actionLabel, e.objectLabel, e.ticketNumber, e.summary, e.more]),
    ).toEqual([
      ['标记无需回复', number, number, '工单状态：待回复 → 已解决', 2],
      ['标记无需回复', number, number, '无需回复：— → 李婷 · 09-10 10:05', 0],
    ]);
    expect(entries[0]!.fields.map((f) => [f.label, f.before, f.after, f.changed])).toEqual([
      ['来信', 'Hal Audit · 09-10 10:00', 'Hal Audit · 09-10 10:00', false],
      ['工单状态', '待回复', '已解决', true],
      ['无需回复', '—', '李婷 · 09-10 10:06', true],
    ]);

    const memberId = await t.addMember({
      name: '只管 Forcome Direct 的主管',
      dept: 'FSH / 客服部',
      roles: ['supervisor'],
      allStores: false,
      storeIds: [DIRECT.id],
    });
    expect(await auditOf(await t.loginAs({ memberId }))).toEqual([]);
  });

  it('撤销：超过时限不能撤销（服务端多留 5 秒网络时间），只有标记的人能撤销，没标记的没有可撤销的', async () => {
    const detail = await twoLetters('Bea Late');
    const number = detail.ticket.number;
    const [first, second] = inbound(detail);
    t.clock.set('2026-09-10T10:05:00+08:00');
    await ok(await mark(agent, number, first!));
    await refused(await undo(agent, number, second!), 400, noReplyMessages.notMarked);

    const supervisor = await t.loginAs('客服主管');
    await refused(await undo(supervisor, number, first!), 403, noReplyMessages.notYours);

    t.clock.set('2026-09-10T10:05:10.001+08:00');
    await refused(await undo(agent, number, first!), 400, noReplyMessages.undoExpired);
    t.clock.set('2026-09-10T10:05:00+08:00');
    await ok(await mark(agent, number, second!));
    t.clock.set('2026-09-10T10:05:10+08:00');
    expect((await ok(await undo(agent, number, second!))).ticket.status).toBe('awaiting_reply');
  });

  it('已被回复的来信、已标记的来信、我方发出的消息不能标记；已关闭工单的来信不能标记（接口拒绝）', async () => {
    t.clock.set('2026-09-10T10:01:00+08:00');
    gmail.deliver(amazonLetter('Cal Done', '<cal-1@buyer.example>', '2026-09-10T10:00:00+08:00'));
    await t.runJobs();
    gmail.send({
      from: AUTO.mailbox,
      to: relayOf('Cal Done'),
      subject: 'Re: Question about my order',
      text: 'Hi Cal',
      at: '2026-09-10T10:20:00+08:00',
      headers: { 'In-Reply-To': '<cal-1@buyer.example>' },
    });
    t.clock.set('2026-09-10T10:21:00+08:00');
    await t.runJobs();
    const replied = await onlyTicketOf(agent, 'Cal Done');
    expect(replied.ticket.status).toBe('awaiting_customer');
    await refused(
      await mark(agent, replied.ticket.number, inbound(replied)[0]!),
      400,
      noReplyMessages.replied,
    );
    const ours = replied.messages.find((m) => m.direction === 'outbound')!;
    await refused(await mark(agent, replied.ticket.number, ours), 404, noReplyMessages.notFound);

    const detail = await twoLetters('Dee Twice');
    const number = detail.ticket.number;
    await ok(await mark(agent, number, inbound(detail)[0]!));
    await refused(
      await mark(agent, number, inbound(detail)[0]!),
      409,
      noReplyMessages.marked('李婷'),
    );
    // 别的工单里的来信：没有这封来信
    await refused(await mark(agent, number, inbound(replied)[0]!), 404, noReplyMessages.notFound);

    // 14 天无新来信 → 已关闭：剩下那封未回复来信也不能再标记
    t.clock.set('2026-09-24T10:00:00+08:00');
    await t.scanTimeLimits();
    const closed = await detailOf(await t.loginAs('坐席'), number);
    expect(closed.ticket.status).toBe('closed');
    expect(closed.autoClose).toBeNull();
    await refused(
      await mark(await t.loginAs('坐席'), number, inbound(closed)[1]!),
      400,
      noReplyMessages.closed,
    );
  });

  it('被标记的来信不是未回复来信：另一封被回复后工单转等客户；之后的新来信让已解决的工单回到待回复', async () => {
    const detail = await twoLetters('Eve Thanks');
    const number = detail.ticket.number;
    t.clock.set('2026-09-10T10:05:00+08:00');
    await ok(await mark(agent, number, inbound(detail)[1]!));
    gmail.send({
      from: AUTO.mailbox,
      to: relayOf('Eve Thanks'),
      subject: 'Re: Question about my order',
      text: 'Hi Eve',
      at: '2026-09-10T10:30:00+08:00',
      headers: { 'In-Reply-To': '<eve.thanks-1@buyer.example>' },
    });
    t.clock.set('2026-09-10T10:31:00+08:00');
    await t.runJobs();
    const replied = await detailOf(agent, number);
    expect(replied.ticket.status).toBe('awaiting_customer');
    // 被标记的仍是无需回复，回复不改它
    expect(inbound(replied).map((m) => m.sla?.result)).toEqual(['met', 'not_required']);
  });

  it('知识库负责人、售后负责人看得到详情，但不能标记无需回复（403）', async () => {
    const detail = await twoLetters('Fay Read');
    for (const role of ['知识库负责人', '售后负责人']) {
      const client = await t.loginAs(role);
      expect((await detailOf(client, detail.ticket.number)).ticket.number).toBe(
        detail.ticket.number,
      );
      expect((await mark(client, detail.ticket.number, inbound(detail)[0]!)).status).toBe(403);
    }
    // 管理员没有「查看工单」
    expect(
      (await mark(await t.loginAs('管理员'), detail.ticket.number, inbound(detail)[0]!)).status,
    ).toBe(403);
    expect((await detailOf(agent, detail.ticket.number)).ticket.status).toBe('awaiting_reply');
  });

  it('其他店铺的工单：详情与标记都 403，审计记下越权访问（E-24）', async () => {
    t.clock.set('2026-09-10T11:01:00+08:00');
    gmail.deliver(
      amazonLetter('Gus Other', '<gus-1@buyer.example>', '2026-09-10T11:00:00+08:00', DIRECT),
    );
    await t.runJobs();
    const detail = await onlyTicketOf(agent, 'Gus Other');
    const memberId = await t.addMember({
      name: '只管 Forcome Auto 的坐席',
      dept: 'FSH / 客服部',
      roles: ['agent'],
      allStores: false,
      storeIds: [AUTO.id],
    });
    const narrow = await t.loginAs({ memberId });
    expect((await narrow.get(`/api/tickets/${detail.ticket.number}`)).status).toBe(403);
    expect((await mark(narrow, detail.ticket.number, inbound(detail)[0]!)).status).toBe(403);
    const denied = await t.auditRecords({ action: 'access.denied' });
    expect(
      denied.slice(-2).map((r) => [r.actorName, r.objectType, r.objectLabel, r.storeId]),
    ).toEqual([
      ['只管 Forcome Auto 的坐席', 'ticket', detail.ticket.number, DIRECT.id],
      ['只管 Forcome Auto 的坐席', 'ticket', detail.ticket.number, DIRECT.id],
    ]);
    expect((await detailOf(agent, detail.ticket.number)).ticket.status).toBe('awaiting_reply');
    // P27 按记录的店铺过滤（自己的记录也一样）：她看不到这两条，所以工单对象的工单号不必再按范围查——看得到的工单都在范围里
    const res = await narrow.get(`/api/audit?q=${detail.ticket.number}`);
    expect(auditLogSchema.parse(await res.json()).entries).toEqual([]);
  });
});

describe('P05 按示例夹具（P1_OLIVER）渲染', () => {
  let t: TestHarness;
  let agent: ApiClient;
  const timeline = fixture.ticketTimeline;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    // 本文件测 Gmail 收信，用到示例的 amz-auto@forcome.com（示例里是 163 企业邮箱，待办 35）
    await t.useGmailForFixtureMailboxes();
    // 与 worker 启动时一样：Fake 从示例数据夹具回放来信与我方回复；时钟在演示时刻，不平移
    t.clients.replayFixtures(fixture);
    await t.enqueue(syncExchangeRatesJob, {});
    await t.runJobs();
    await t.scanTimeLimits();
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  async function oliver(): Promise<TicketDetail> {
    return onlyTicketOf(agent, 'Oliver Grant');
  }

  it('全程记录：五封消息带正文，我方回复写发件邮箱，第三封标记「无需回复 · 李婷 · 09:05」；事件行按时刻', async () => {
    const detail = await oliver();
    expect(detail.ticket).toMatchObject({ status: 'resolved', orderNumber: '204-5566778-9900112' });
    expect(detail.mailbox).toBe(timeline.mailbox);
    expect(
      detail.messages.map((m) => [m.direction, m.arrivedAt, m.from.address === timeline.mailbox]),
    ).toEqual(timeline.entries.map((e) => [e.direction, iso(e.at), e.direction === 'outbound']));
    // 正文只显示留言：亚马逊买家消息的「Begin message」「End message」与后面的订单号不显示（回放照平台的写法带订单号）
    expect(detail.messages.map((m) => m.body)).toEqual(timeline.entries.map((e) => e.body));
    expect(detail.messages.map((m) => m.noReply)).toEqual(
      timeline.entries.map((e) =>
        e.markedNoReply ? { by: '李婷', at: iso(e.markedNoReply.at) } : null,
      ),
    );
    expect(
      detail.events.map((e) =>
        e.kind === 'status' ? [e.at, e.event, e.to] : [e.at, e.action, e.to],
      ),
    ).toEqual([
      [iso('2026-09-04T10:12:00+08:00'), 'inbound', 'awaiting_reply'],
      [iso('2026-09-04T10:40:00+08:00'), 'reply_detected', 'awaiting_customer'],
      [iso('2026-09-05T08:58:00+08:00'), 'inbound', 'awaiting_reply'],
      [iso('2026-09-05T15:30:00+08:00'), 'reply_detected', 'awaiting_customer'],
      [iso('2026-09-10T09:00:00+08:00'), 'inbound', 'awaiting_reply'],
      [iso('2026-09-10T09:05:00+08:00'), 'mark', 'resolved'],
    ]);
  });

  it('SLA 结果、状态流转与自动关闭预计同 P1_OLIVER', async () => {
    const detail = await oliver();
    expect(inbound(detail).map((m) => [m.arrivedAt, m.firstReplyAt, m.sla?.result])).toEqual([
      [iso('2026-09-04T10:12:00+08:00'), iso('2026-09-04T10:40:00+08:00'), 'met'],
      [iso('2026-09-05T08:58:00+08:00'), iso('2026-09-05T15:30:00+08:00'), 'met'],
      [iso('2026-09-10T09:00:00+08:00'), null, 'not_required'],
    ]);
    const STATUS = { 待回复: 'awaiting_reply', 等客户: 'awaiting_customer', 已解决: 'resolved' };
    expect(detail.statusFlow.map((s) => [s.to, s.at, s.actorName])).toEqual(
      timeline.statusFlow.map((s) => [STATUS[s.status as keyof typeof STATUS], iso(s.at), s.actor]),
    );
    expect(detail.autoClose).toEqual({
      at: iso(timeline.autoCloseAt),
      reason: 'resolved_no_inbound',
    });
  });

  it('订单卡：平台镜像（已发货、更新于 08-26、CA$67.99 ≈ $49.99、MFN、承诺送达、多伦多、Canada Post 单号）', async () => {
    const detail = await oliver();
    expect(detail.order).toEqual({
      number: '204-5566778-9900112',
      platform: 'amazon',
      status: 'SHIPPED',
      cancelled: false,
      updatedAt: iso('2026-08-26T16:20:00+08:00'),
      syncedAt: expect.any(String) as string,
      items: [{ title: '车载吸尘器 V2 黑色', quantity: 1 }],
      total: { amount: '67.99', currency: 'CAD' },
      usd: '49.99',
      fulfillmentChannel: 'MFN',
      promisedDeliveryBy: iso('2026-08-27T23:59:00+08:00'),
      shipTo: { city: 'Toronto', province: 'ON', country: 'CA' },
      tracking: [{ company: 'Canada Post', number: '7316204855219087' }],
    });
  });

  it('Valeria Ríos 由李婷 09-09 08:45 标记无需回复，工单已解决；没有关联订单的订单卡为空', async () => {
    const detail = await onlyTicketOf(agent, 'Valeria Ríos');
    expect(detail.ticket.status).toBe('resolved');
    expect(detail.order).toBeNull();
    expect(inbound(detail).map((m) => m.noReply)).toEqual([
      { by: '李婷', at: iso('2026-09-09T08:45:00+08:00') },
    ]);
  });

  it('已关闭的工单：状态流转最后一步是按时关闭，时刻为到期时刻；没有自动关闭预计', async () => {
    const closed = (await ticketList(agent)).find((tk) => tk.status === 'closed')!;
    const detail = await detailOf(agent, closed.number);
    expect(detail.autoClose).toBeNull();
    expect(detail.statusFlow.at(-1)).toMatchObject({
      event: 'idle_7_days',
      to: 'closed',
      closeReason: 'customer_no_reply',
      at: iso('2026-09-09T10:30:00+08:00'),
    });
    expect(detail.order?.platform).toBe('shopify');
    expect(detail.order).toMatchObject({
      fulfillmentChannel: null,
      promisedDeliveryBy: null,
      usd: null,
    });
  });

  it('Shopify 联系表单只显示表单里的留言；生产厂工单的自动回复照常在全程记录里', async () => {
    const olivia = await onlyTicketOf(agent, 'Olivia Turner');
    expect(olivia.ticket.orderNumber).toBe('#1063');
    expect(inbound(olivia)[0]!.body).toBe('Vacuum loses suction after a few weeks');
    const fqd = await onlyTicketOf(agent, 'FQD 品质部');
    expect(
      fqd.messages.map((m) => [m.direction, m.channel, m.autoReply, m.autoReplyHeader, m.source]),
    ).toEqual([
      ['inbound', 'email', false, null, 'producer'],
      ['outbound', null, true, 'Auto-Submitted: auto-replied', null],
    ]);
    // 直邮的正文取示例数据（原型 I18 ② 的生产厂来信）
    const producer = fixture.tickets.find((t) => t.customer === 'FQD 品质部')!;
    expect(inbound(fqd)[0]!.body).toBe(producer.body);
  });
});
