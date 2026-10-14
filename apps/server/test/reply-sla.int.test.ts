import {
  amazonDomains,
  isUnrepliedInbound,
  SHOPIFY_CONTACT_FORM_SENDER,
  ticketDetailSchema,
  ticketListSchema,
  type TicketDetail,
  type TicketListItem,
  type TicketMessage,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  amazonOrdersClient,
  gmailClient,
  type FakeAmazonOrders,
  type FakeGmail,
  type FakeMailInput,
} from '../src/modules/integration';
import { attributeReplyJob } from '../src/modules/ticket';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 回复识别、SLA 与自动关闭（待办 16；规格「首次回复与 SLA」故事 50–54、「工单生命周期」故事 43–47，
 * PRD R-SL-01–R-SL-08、6.1 第一阶段迁移表，验收 AC-P1-02、03、04、AC-TK-07、13）：
 * Fake Gmail 放来信、在店铺邮箱的「已发送」里放我方回信 → 跑完任务（入库、「来信已接收」归并、「我方发信已同步」回复识别）→
 * 推进时钟、排一次每分钟的时限扫描 → 以坐席身份调 P04 / 工单详情接口断言状态、首次回复时间与 SLA 结果。
 * 时限扫描影响库里全部工单：各用例用不同的客户，只断言自己的工单。
 */

const stores = getDemoFixture().stores;
/** 亚马逊店铺（US）：亚马逊来信按平台 SLA 计 */
const AUTO = stores.find((s) => s.name === 'Forcome Auto')!;
/** Shopify 店铺：联系表单与直邮按内部目标计 */
const COM = stores.find((s) => s.name === 'forcome.com')!;

const RELAY_US = amazonDomains.US.relay;

const relayOf = (buyer: string) => `${buyer.toLowerCase().replace(/\W+/g, '.')}@${RELAY_US}`;

/** 亚马逊买家消息（经中转地址发到店铺邮箱）；Message-ID 由调用方给定，回信按它写 In-Reply-To */
function amazonLetter(buyer: string, messageId: string, at: string, text = 'Hello'): FakeMailInput {
  return {
    to: AUTO.mailbox,
    from: { name: buyer, address: relayOf(buyer) },
    subject: 'Question about my order',
    text,
    at,
    messageId,
  };
}

/** 店铺邮箱「已发送」里的我方回信（海帆或人工在原渠道发出） */
function reply(
  buyer: string,
  at: string,
  headers: Record<string, string> = {},
  overrides: { from?: string; threadId?: string } = {},
) {
  return {
    from: overrides.from ?? AUTO.mailbox,
    to: relayOf(buyer),
    subject: 'Re: Question about my order',
    text: 'Hi, sorry about the trouble.',
    at,
    headers,
    ...(overrides.threadId ? { threadId: overrides.threadId } : {}),
  };
}

async function ticketList(client: ApiClient): Promise<TicketListItem[]> {
  const res = await client.get('/api/tickets');
  expect(res.status).toBe(200);
  return ticketListSchema.parse(await res.json()).tickets;
}

async function ticketDetail(client: ApiClient, number: string): Promise<TicketDetail> {
  const res = await client.get(`/api/tickets/${number}`);
  expect(res.status).toBe(200);
  return ticketDetailSchema.parse(await res.json());
}

/** 某位客户的工单（各用例用不同的客户，互不影响） */
async function ticketsOf(client: ApiClient, customer: string): Promise<TicketListItem[]> {
  return (await ticketList(client)).filter((ticket) => ticket.customer.name === customer);
}

/** 某位客户唯一的一张工单与它的消息 */
async function onlyTicketOf(client: ApiClient, customer: string): Promise<TicketDetail> {
  const tickets = await ticketsOf(client, customer);
  expect(tickets).toHaveLength(1);
  return ticketDetail(client, tickets[0]!.number);
}

const inbound = (detail: TicketDetail) => detail.messages.filter((m) => m.direction === 'inbound');
const outbound = (detail: TicketDetail) =>
  detail.messages.filter((m) => m.direction === 'outbound');
const iso = (at: string) => new Date(at).toISOString();

/** 一封来信的首次回复与 SLA 结果，按断言的写法 */
function slaOf(message: TicketMessage) {
  return { firstReplyAt: message.firstReplyAt, result: message.sla?.result ?? null };
}

/** 等待表里回复某个 Message-ID 的我方回复有几封 */
async function waitingFor(t: TestHarness, rfcMessageId: string): Promise<number> {
  const { rows } = await t.runtime.db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM ticket.pending_reply WHERE ${rfcMessageId} = ANY(reply_to)`);
  return rows[0]!.n;
}

/** 工单的状态变更记录（事件、目标状态、触发方、关闭原因），按先后 */
async function statusChanges(t: TestHarness, number: string) {
  const { rows } = await t.runtime.db.execute<{
    event: string;
    to_status: string;
    trigger: string;
    close_reason: string | null;
  }>(sql`
    SELECT c.event, c.to_status, c.trigger, c.close_reason FROM ticket.status_change c
      JOIN ticket.ticket k ON k.id = c.ticket_id
     WHERE k.number = ${number} ORDER BY c.id`);
  return rows.map((r) => [r.event, r.to_status, r.trigger, r.close_reason]);
}

describe('回复识别与 SLA（R-SL-08）', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let agent: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    // 邮箱开始监听（之后到达的来信与「已发送」才同步进来）
    await t.runJobs();
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  it('AC-P1-02：待回复的工单，「已发送」同步到一封 In-Reply-To 指向该来信的回信 → 等客户；首次回复时间 = 回信 internalDate', async () => {
    t.clock.set('2026-09-10T10:13:00+08:00');
    gmail.deliver(amazonLetter('Nora Hale', '<p102@buyer.example>', '2026-09-10T10:12:00+08:00'));
    await t.runJobs();
    const before = await onlyTicketOf(agent, 'Nora Hale');
    expect(before.ticket.status).toBe('awaiting_reply');
    expect(inbound(before)[0]!.sla).toEqual({
      target: 'platform',
      dueAt: iso('2026-09-11T10:12:00+08:00'),
      result: 'pending',
    });

    t.clock.set('2026-09-10T10:41:00+08:00');
    gmail.send(
      reply('Nora Hale', '2026-09-10T10:40:00+08:00', { 'In-Reply-To': '<p102@buyer.example>' }),
    );
    await t.runJobs();

    const after = await onlyTicketOf(agent, 'Nora Hale');
    expect(after.ticket.status).toBe('awaiting_customer');
    expect(slaOf(inbound(after)[0]!)).toEqual({
      firstReplyAt: iso('2026-09-10T10:40:00+08:00'),
      result: 'met',
    });
    // 我方回信也进了全程记录：发件人是店铺邮箱，不是自动回复
    expect(outbound(after)).toEqual([
      expect.objectContaining({
        direction: 'outbound',
        mailbox: AUTO.mailbox,
        from: { name: '', address: AUTO.mailbox },
        source: null,
        autoReply: false,
        firstReplyAt: null,
        sla: null,
        arrivedAt: iso('2026-09-10T10:40:00+08:00'),
      }),
    ]);
    expect(await statusChanges(t, after.ticket.number)).toEqual([
      ['inbound', 'awaiting_reply', 'system', null],
      ['reply_detected', 'awaiting_customer', 'system', null],
    ]);
  });

  it('AC-P1-03：我方发出带 Auto-Submitted: auto-replied 的邮件 → 不算回复，工单保持待回复，消息照常入库并标「自动回复」', async () => {
    t.clock.set('2026-09-10T11:01:00+08:00');
    gmail.deliver(amazonLetter('Owen Park', '<p103@buyer.example>', '2026-09-10T11:00:00+08:00'));
    await t.runJobs();
    gmail.send(
      reply('Owen Park', '2026-09-10T11:00:30+08:00', {
        'In-Reply-To': '<p103@buyer.example>',
        'Auto-Submitted': 'auto-replied',
      }),
    );
    await t.runJobs();

    const detail = await onlyTicketOf(agent, 'Owen Park');
    expect(detail.ticket.status).toBe('awaiting_reply');
    expect(outbound(detail)).toEqual([expect.objectContaining({ autoReply: true })]);
    expect(slaOf(inbound(detail)[0]!)).toEqual({ firstReplyAt: null, result: 'pending' });
    expect(await statusChanges(t, detail.ticket.number)).toEqual([
      ['inbound', 'awaiting_reply', 'system', null],
    ]);
  });

  it('一封回复结束它之前该工单内所有未回复来信的计时：两封都记首次回复，之后的新来信重新计时并回到待回复', async () => {
    t.clock.set('2026-09-10T12:00:00+08:00');
    gmail.deliver(
      amazonLetter('Ruth Gale', '<multi-1@buyer.example>', '2026-09-09T09:00:00+08:00'),
    );
    gmail.deliver(
      amazonLetter('Ruth Gale', '<multi-2@buyer.example>', '2026-09-10T08:00:00+08:00'),
    );
    await t.runJobs();
    // 回信只回了第一封（In-Reply-To 指向它），但第二封也在它之前到达
    gmail.send(
      reply('Ruth Gale', '2026-09-10T11:00:00+08:00', { 'In-Reply-To': '<multi-1@buyer.example>' }),
    );
    await t.runJobs();

    const replied = await onlyTicketOf(agent, 'Ruth Gale');
    expect(replied.ticket.status).toBe('awaiting_customer');
    // 第一封 26 小时后才回（未达标），第二封 3 小时（达标）
    expect(inbound(replied).map(slaOf)).toEqual([
      { firstReplyAt: iso('2026-09-10T11:00:00+08:00'), result: 'missed' },
      { firstReplyAt: iso('2026-09-10T11:00:00+08:00'), result: 'met' },
    ]);

    gmail.deliver(
      amazonLetter('Ruth Gale', '<multi-3@buyer.example>', '2026-09-10T15:00:00+08:00'),
    );
    t.clock.set('2026-09-10T15:01:00+08:00');
    await t.runJobs();
    const again = await onlyTicketOf(agent, 'Ruth Gale');
    expect(again.ticket.status).toBe('awaiting_reply');
    expect(slaOf(inbound(again)[2]!)).toEqual({ firstReplyAt: null, result: 'pending' });
    expect((await statusChanges(t, again.ticket.number)).map(([event, to]) => [event, to])).toEqual(
      [
        ['inbound', 'awaiting_reply'],
        ['reply_detected', 'awaiting_customer'],
        ['inbound', 'awaiting_reply'],
      ],
    );
  });

  it('回复之后还有未回复来信时不转等客户（该回复之前的来信照样结束计时）', async () => {
    t.clock.set('2026-09-10T13:00:00+08:00');
    gmail.deliver(amazonLetter('Ivy Moss', '<after-1@buyer.example>', '2026-09-10T09:00:00+08:00'));
    gmail.deliver(amazonLetter('Ivy Moss', '<after-2@buyer.example>', '2026-09-10T12:00:00+08:00'));
    await t.runJobs();
    // 回信 10:00 发出（回第一封），12:00 的第二封仍未回复
    gmail.send(
      reply('Ivy Moss', '2026-09-10T10:00:00+08:00', { 'In-Reply-To': '<after-1@buyer.example>' }),
    );
    await t.runJobs();

    const detail = await onlyTicketOf(agent, 'Ivy Moss');
    expect(detail.ticket.status).toBe('awaiting_reply');
    expect(inbound(detail).map(slaOf)).toEqual([
      { firstReplyAt: iso('2026-09-10T10:00:00+08:00'), result: 'met' },
      { firstReplyAt: null, result: 'pending' },
    ]);
  });

  it('没有 In-Reply-To 时按 References（从最近的一封往前）归属', async () => {
    t.clock.set('2026-09-10T14:00:00+08:00');
    gmail.deliver(amazonLetter('Gus Lowe', '<refs-1@buyer.example>', '2026-09-10T13:00:00+08:00'));
    await t.runJobs();
    gmail.send(
      reply('Gus Lowe', '2026-09-10T13:30:00+08:00', {
        References: '<older@elsewhere.example> <refs-1@buyer.example>',
      }),
    );
    await t.runJobs();
    expect((await onlyTicketOf(agent, 'Gus Lowe')).ticket.status).toBe('awaiting_customer');
  });

  it('In-Reply-To 指向归档的平台通知（不会归并成工单）时不等它，接着按 References 归属', async () => {
    t.clock.set('2026-09-10T14:10:00+08:00');
    gmail.deliver(amazonLetter('Ned Ross', '<refs-2@buyer.example>', '2026-09-10T13:00:00+08:00'));
    gmail.deliver({
      to: AUTO.mailbox,
      from: { name: 'Amazon', address: 'no-reply@amazon.com' },
      subject: 'Your listing was updated',
      text: 'Notification',
      at: '2026-09-10T13:05:00+08:00',
      messageId: '<notice@amazon.example>',
    });
    await t.runJobs();
    gmail.send(
      reply('Ned Ross', '2026-09-10T13:30:00+08:00', {
        'In-Reply-To': '<notice@amazon.example>',
        References: '<refs-2@buyer.example> <notice@amazon.example>',
      }),
    );
    await t.runJobs();
    expect((await onlyTicketOf(agent, 'Ned Ross')).ticket.status).toBe('awaiting_customer');
  });

  it('没有回复头（海帆另起的信）时按 Gmail 线程归属', async () => {
    t.clock.set('2026-09-10T14:30:00+08:00');
    const [gmailId] = gmail.deliver(
      amazonLetter('Hal Reed', '<thread-1@buyer.example>', '2026-09-10T14:00:00+08:00'),
    );
    await t.runJobs();
    gmail.send(reply('Hal Reed', '2026-09-10T14:20:00+08:00', {}, { threadId: gmailId! }));
    await t.runJobs();
    expect((await onlyTicketOf(agent, 'Hal Reed')).ticket.status).toBe('awaiting_customer');
  });

  it('只归到发件邮箱所属店铺的工单：别的店铺邮箱回同一封信不算这张工单的回复', async () => {
    t.clock.set('2026-09-10T15:30:00+08:00');
    gmail.deliver(
      amazonLetter('Kit Shaw', '<other-store@buyer.example>', '2026-09-10T15:00:00+08:00'),
    );
    await t.runJobs();
    gmail.send(
      reply(
        'Kit Shaw',
        '2026-09-10T15:10:00+08:00',
        { 'In-Reply-To': '<other-store@buyer.example>' },
        { from: COM.mailbox },
      ),
    );
    await t.runJobs();
    const detail = await onlyTicketOf(agent, 'Kit Shaw');
    expect(detail.ticket.status).toBe('awaiting_reply');
    expect(outbound(detail)).toEqual([]);
  });

  it('In-Reply-To 指向的来信已归到别的店铺的工单：不等它，接着按 References 归到本店铺的工单', async () => {
    t.clock.set('2026-09-10T16:00:00+08:00');
    gmail.deliver(
      amazonLetter('Lyn Cho', '<cross-auto@buyer.example>', '2026-09-10T15:00:00+08:00'),
    );
    gmail.deliver({
      to: COM.mailbox,
      from: { name: 'Lyn Cho', address: 'lyn.cho@example.com' },
      subject: 'Same question to the other store',
      text: 'Hello again',
      at: '2026-09-10T15:05:00+08:00',
      messageId: '<cross-com@buyer.example>',
    });
    await t.runJobs();
    gmail.send(
      reply(
        'Lyn Cho',
        '2026-09-10T15:20:00+08:00',
        {
          'In-Reply-To': '<cross-auto@buyer.example>',
          References: '<cross-com@buyer.example> <cross-auto@buyer.example>',
        },
        { from: COM.mailbox },
      ),
    );
    await t.runJobs();
    const tickets = await ticketsOf(agent, 'Lyn Cho');
    expect(tickets.map((ticket) => [ticket.store.name, ticket.status]).sort()).toEqual([
      ['Forcome Auto', 'awaiting_reply'],
      ['forcome.com', 'awaiting_customer'],
    ]);
  });

  it('同一封回信重复同步、回复识别重跑：只入工单一次，状态只迁一次', async () => {
    t.clock.set('2026-09-10T16:30:00+08:00');
    gmail.deliver(amazonLetter('Lou Fenn', '<dup@buyer.example>', '2026-09-10T16:00:00+08:00'));
    await t.runJobs();
    const gmailId = gmail.send(
      reply('Lou Fenn', '2026-09-10T16:10:00+08:00', { 'In-Reply-To': '<dup@buyer.example>' }),
    );
    await t.runJobs();
    gmail.redeliver(AUTO.mailbox, gmailId);
    await t.runJobs();
    // 回复识别的任务再跑一次（重试或重复排队）
    const [sent] = outbound(await onlyTicketOf(agent, 'Lou Fenn'));
    await t.enqueue(attributeReplyJob, { messageId: sent!.id });
    await t.runJobs();

    const detail = await onlyTicketOf(agent, 'Lou Fenn');
    expect(outbound(detail)).toHaveLength(1);
    expect(await statusChanges(t, detail.ticket.number)).toHaveLength(2);
  });
});

describe('乱序：回复先于它所回复的来信入库（R-SL-08）', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let agent: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    await t.runJobs();
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  it('回信先同步进来（找不到对应来信，等着）；来信归并后回信照样归属，计时正确', async () => {
    t.clock.set('2026-09-10T09:30:00+08:00');
    gmail.send(
      reply('Amy Cole', '2026-09-10T09:20:00+08:00', { 'In-Reply-To': '<late@buyer.example>' }),
    );
    await t.runJobs();
    expect(await ticketsOf(agent, 'Amy Cole')).toEqual([]);

    // 来信稍后才同步进来（例如邮箱短暂断线后补拉）
    t.clock.set('2026-09-10T10:00:00+08:00');
    gmail.deliver(amazonLetter('Amy Cole', '<late@buyer.example>', '2026-09-10T09:00:00+08:00'));
    await t.runJobs();

    const detail = await onlyTicketOf(agent, 'Amy Cole');
    expect(detail.ticket.status).toBe('awaiting_customer');
    expect(slaOf(inbound(detail)[0]!)).toEqual({
      firstReplyAt: iso('2026-09-10T09:20:00+08:00'),
      result: 'met',
    });
    expect(outbound(detail)).toHaveLength(1);
  });

  it('晚到的来信早于工单内已归属的回复：按 internalDate 判为已被该回复结束计时，工单仍是等客户', async () => {
    t.clock.set('2026-09-10T11:00:00+08:00');
    gmail.deliver(amazonLetter('Ben Ford', '<early-2@buyer.example>', '2026-09-10T10:00:00+08:00'));
    await t.runJobs();
    gmail.send(
      reply('Ben Ford', '2026-09-10T10:30:00+08:00', { 'In-Reply-To': '<early-2@buyer.example>' }),
    );
    await t.runJobs();
    expect((await onlyTicketOf(agent, 'Ben Ford')).ticket.status).toBe('awaiting_customer');

    // 更早的一封（09:00）这时才同步进来
    gmail.deliver(amazonLetter('Ben Ford', '<early-1@buyer.example>', '2026-09-10T09:00:00+08:00'));
    t.clock.set('2026-09-10T11:30:00+08:00');
    await t.runJobs();

    const detail = await onlyTicketOf(agent, 'Ben Ford');
    expect(detail.ticket.status).toBe('awaiting_customer');
    expect(inbound(detail).map(slaOf)).toEqual([
      { firstReplyAt: iso('2026-09-10T10:30:00+08:00'), result: 'met' },
      { firstReplyAt: iso('2026-09-10T10:30:00+08:00'), result: 'met' },
    ]);
  });

  it('来信与回信同一批同步、两边的任务同时跑：回信照样归属（「找不到 → 等着」与「归并 → 找等着的」按咨询锁互斥）', async () => {
    t.clock.set('2026-09-10T12:30:00+08:00');
    for (const [buyer, n] of [
      ['Eve Dunn', 1],
      ['Fox Hale', 2],
      ['Gwen Ito', 3],
    ] as const) {
      gmail.deliver(
        amazonLetter(buyer, `<same-batch-${n}@buyer.example>`, '2026-09-10T12:00:00+08:00'),
      );
      gmail.send(
        reply(buyer, '2026-09-10T12:20:00+08:00', {
          'In-Reply-To': `<same-batch-${n}@buyer.example>`,
        }),
      );
    }
    await t.runJobs({ concurrently: true });
    for (const buyer of ['Eve Dunn', 'Fox Hale', 'Gwen Ito']) {
      const detail = await onlyTicketOf(agent, buyer);
      expect([buyer, detail.ticket.status, outbound(detail).length]).toEqual([
        buyer,
        'awaiting_customer',
        1,
      ]);
    }
  });

  it('回信最多等 24 小时：过了 24 小时对应的来信才到，不再归属（工单是待回复）', async () => {
    t.clock.set('2026-09-11T08:00:00+08:00');
    gmail.send(
      reply('Cal Hart', '2026-09-11T07:50:00+08:00', { 'In-Reply-To': '<gone@buyer.example>' }),
    );
    await t.runJobs();
    expect(await waitingFor(t, '<gone@buyer.example>')).toBe(1);
    // 24 小时后的扫描移出等待表、最后识别一次（找不到，放弃）
    t.clock.set('2026-09-12T08:01:00+08:00');
    await t.scanTimeLimits();
    expect(await waitingFor(t, '<gone@buyer.example>')).toBe(0);
    // 之前排下、晚于扫描才跑的重新识别不把它插回等待表（最长只等 24 小时）
    const { rows } = await t.runtime.db.execute<{ id: string }>(sql`
      SELECT id FROM channel.message WHERE direction = 'outbound' AND in_reply_to = '<gone@buyer.example>'`);
    await t.enqueue(attributeReplyJob, { messageId: rows[0]!.id });
    await t.runJobs();
    expect(await waitingFor(t, '<gone@buyer.example>')).toBe(0);

    gmail.deliver(amazonLetter('Cal Hart', '<gone@buyer.example>', '2026-09-11T07:40:00+08:00'));
    await t.runJobs();
    const detail = await onlyTicketOf(agent, 'Cal Hart');
    expect(detail.ticket.status).toBe('awaiting_reply');
    expect(outbound(detail)).toEqual([]);
  });

  it('In-Reply-To 指向还没入库的来信时等它，不按线程归到同一线程里别的工单；它归并后归属', async () => {
    t.clock.set('2026-09-15T10:00:00+08:00');
    const [gmailId] = gmail.deliver(
      amazonLetter('Ira Bell', '<thread-a@buyer.example>', '2026-09-15T09:00:00+08:00'),
    );
    await t.runJobs();
    // 回信回的是另一位客户的信（还没同步进来），但落在同一个 Gmail 线程里
    gmail.send(
      reply(
        'Jo Pike',
        '2026-09-15T09:40:00+08:00',
        { 'In-Reply-To': '<thread-b@buyer.example>' },
        { threadId: gmailId! },
      ),
    );
    await t.runJobs();
    expect((await onlyTicketOf(agent, 'Ira Bell')).ticket.status).toBe('awaiting_reply');

    gmail.deliver(amazonLetter('Jo Pike', '<thread-b@buyer.example>', '2026-09-15T09:30:00+08:00'));
    await t.runJobs();
    expect((await onlyTicketOf(agent, 'Jo Pike')).ticket.status).toBe('awaiting_customer');
    expect(outbound(await onlyTicketOf(agent, 'Ira Bell'))).toEqual([]);
  });

  it('等满 24 小时它回复的来信仍没来：最后识别一次，按 References、线程归属', async () => {
    t.clock.set('2026-09-16T10:00:00+08:00');
    const [gmailId] = gmail.deliver(
      amazonLetter('Kim Rowe', '<final-a@buyer.example>', '2026-09-16T09:00:00+08:00'),
    );
    await t.runJobs();
    gmail.send(
      reply(
        'Kim Rowe',
        '2026-09-16T09:30:00+08:00',
        { 'In-Reply-To': '<never@buyer.example>' },
        { threadId: gmailId! },
      ),
    );
    await t.runJobs();
    expect((await onlyTicketOf(agent, 'Kim Rowe')).ticket.status).toBe('awaiting_reply');

    t.clock.set('2026-09-17T10:00:00+08:00');
    agent = await t.loginAs('坐席');
    await t.scanTimeLimits();
    const detail = await onlyTicketOf(agent, 'Kim Rowe');
    expect(detail.ticket.status).toBe('awaiting_customer');
    expect(slaOf(inbound(detail)[0]!)).toEqual({
      firstReplyAt: iso('2026-09-16T09:30:00+08:00'),
      result: 'met',
    });
  });

  it('24 小时内的等待照常归属（扫描只放弃满 24 小时的）', async () => {
    t.clock.set('2026-09-13T08:00:00+08:00');
    gmail.send(
      reply('Dot Rhee', '2026-09-13T07:50:00+08:00', { 'In-Reply-To': '<slow@buyer.example>' }),
    );
    await t.runJobs();
    t.clock.set('2026-09-14T07:59:00+08:00');
    await t.scanTimeLimits();

    gmail.deliver(amazonLetter('Dot Rhee', '<slow@buyer.example>', '2026-09-13T07:40:00+08:00'));
    await t.runJobs();
    expect((await onlyTicketOf(agent, 'Dot Rhee')).ticket.status).toBe('awaiting_customer');
  });
});

describe('生产厂来信（AC-P1-04 的 SLA 部分）与时限扫描（AC-TK-07、AC-TK-13，6.1 的 7 天与 14 天）', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let amazon: FakeAmazonOrders;
  let agent: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    amazon = t.clients.fake(amazonOrdersClient);
    await t.runJobs();
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  /** 把时钟拨到某个时刻：一跳可能超过 7 天，会话按 7 天无操作过期（ADR 0010），拨完重新登录 */
  async function travel(at: string): Promise<void> {
    t.clock.set(at);
    agent = await t.loginAs('坐席');
  }

  /** 拨到某个时刻并排一次时限扫描 */
  async function scanAt(at: string): Promise<void> {
    await travel(at);
    await t.scanTimeLimits();
  }

  /** 已登记生产厂邮箱的来信（示例数据的 FQD），直接写到亚马逊店铺邮箱 */
  const producerLetter = (orderNumber: string, at: string): FakeMailInput => ({
    to: AUTO.mailbox,
    from: { name: 'FQD 品质部', address: 'qc@fqd-forcome.com' },
    subject: `订单 ${orderNumber} 批次抽检`,
    text: '抽检报告见附件。',
    at,
  });

  it('AC-P1-04：生产厂来信建工单（待回复）但不计 SLA；之后 24 小时、14 天的扫描都不给它记未达标', async () => {
    await travel('2026-08-01T10:01:00+08:00');
    amazon.put(AUTO.id, {
      orderId: '113-2000001-0000001',
      updatedAt: new Date('2026-07-30T10:00:00+08:00'),
      createdAt: new Date('2026-07-30T10:00:00+08:00'),
    });
    gmail.deliver(producerLetter('113-2000001-0000001', '2026-08-01T10:00:00+08:00'));
    await t.runJobs();
    const [ticket] = (await ticketList(agent)).filter(
      (x) => x.orderNumber === '113-2000001-0000001',
    );
    expect(ticket).toEqual(
      expect.objectContaining({ source: 'producer', status: 'awaiting_reply' }),
    );
    const letter = inbound(await ticketDetail(agent, ticket!.number))[0]!;
    expect(letter).toEqual(
      expect.objectContaining({ source: 'producer', sla: null, firstReplyAt: null }),
    );

    await scanAt('2026-08-15T10:00:00+08:00');
    const closed = await ticketDetail(agent, ticket!.number);
    // 14 天无新来信照样关闭（未识别到回复），但生产厂来信不是应回复来信，不计未达标
    expect(closed.ticket).toEqual(
      expect.objectContaining({ status: 'closed', closeReason: 'reply_not_detected' }),
    );
    expect(inbound(closed)[0]!.sla).toBeNull();
  });

  it('AC-P1-04：等客户的工单收到同一订单的生产厂来信 → 回到待回复（状态迁移看未回复来信，不论来源）', async () => {
    await travel('2026-09-01T10:01:00+08:00');
    amazon.put(AUTO.id, {
      orderId: '113-2000002-0000002',
      updatedAt: new Date('2026-08-30T10:00:00+08:00'),
      createdAt: new Date('2026-08-30T10:00:00+08:00'),
    });
    gmail.deliver(
      amazonLetter(
        'Fay Stone',
        '<prod-1@buyer.example>',
        '2026-09-01T10:00:00+08:00',
        'Order 113-2000002-0000002 is broken',
      ),
    );
    await t.runJobs();
    gmail.send(
      reply('Fay Stone', '2026-09-01T10:30:00+08:00', { 'In-Reply-To': '<prod-1@buyer.example>' }),
    );
    await t.runJobs();
    expect((await onlyTicketOf(agent, 'Fay Stone')).ticket.status).toBe('awaiting_customer');

    await travel('2026-09-02T09:01:00+08:00');
    gmail.deliver(producerLetter('113-2000002-0000002', '2026-09-02T09:00:00+08:00'));
    await t.runJobs();

    const detail = await onlyTicketOf(agent, 'Fay Stone');
    expect(detail.ticket.status).toBe('awaiting_reply');
    expect(inbound(detail).map((m) => [m.source, m.sla?.result ?? null])).toEqual([
      ['customer', 'met'],
      ['producer', null],
    ]);
    // 7 天、14 天从最近一封来信（不论来源）起算：生产厂来信 14 天后关闭，客户来信已达标，不受影响
    await scanAt('2026-09-16T08:59:00+08:00');
    expect((await onlyTicketOf(agent, 'Fay Stone')).ticket.status).toBe('awaiting_reply');
    await scanAt('2026-09-16T09:00:00+08:00');
    const closed = await onlyTicketOf(agent, 'Fay Stone');
    expect(closed.ticket).toEqual(
      expect.objectContaining({ status: 'closed', closeReason: 'reply_not_detected' }),
    );
    expect(inbound(closed).map((m) => m.sla?.result ?? null)).toEqual(['met', null]);
  });

  it('SLA 到期仍未回复：扫描把未到期改为未达标（截止那一刻仍未到期）', async () => {
    await travel('2026-09-03T10:01:00+08:00');
    gmail.deliver(amazonLetter('Gil Ames', '<due@buyer.example>', '2026-09-03T10:00:00+08:00'));
    await t.runJobs();
    await scanAt('2026-09-04T10:00:00+08:00');
    expect(slaOf(inbound(await onlyTicketOf(agent, 'Gil Ames'))[0]!)).toEqual({
      firstReplyAt: null,
      result: 'pending',
    });
    await scanAt('2026-09-04T10:01:00+08:00');
    expect(slaOf(inbound(await onlyTicketOf(agent, 'Gil Ames'))[0]!)).toEqual({
      firstReplyAt: null,
      result: 'missed',
    });
    // 超时后才回：首次回复照记，结果仍是未达标；工单转等客户
    await travel('2026-09-04T12:01:00+08:00');
    gmail.send(
      reply('Gil Ames', '2026-09-04T12:00:00+08:00', { 'In-Reply-To': '<due@buyer.example>' }),
    );
    await t.runJobs();
    const detail = await onlyTicketOf(agent, 'Gil Ames');
    expect(detail.ticket.status).toBe('awaiting_customer');
    expect(slaOf(inbound(detail)[0]!)).toEqual({
      firstReplyAt: iso('2026-09-04T12:00:00+08:00'),
      result: 'missed',
    });
  });

  it('回信晚同步进来、但发出时没超时（扫描已记了未达标）：按回信的 internalDate 改为达标', async () => {
    await travel('2026-09-05T10:01:00+08:00');
    gmail.deliver(amazonLetter('Hana Roe', '<lag@buyer.example>', '2026-09-05T10:00:00+08:00'));
    await t.runJobs();
    await scanAt('2026-09-06T11:00:00+08:00');
    gmail.send(
      reply('Hana Roe', '2026-09-06T09:00:00+08:00', { 'In-Reply-To': '<lag@buyer.example>' }),
    );
    await t.runJobs();
    expect(slaOf(inbound(await onlyTicketOf(agent, 'Hana Roe'))[0]!)).toEqual({
      firstReplyAt: iso('2026-09-06T09:00:00+08:00'),
      result: 'met',
    });
  });

  it('AC-TK-07：等客户 7 天无来信 → 已关闭，原因「客户未回复」（从最近一封来信的到达时间起算）', async () => {
    await travel('2026-09-07T10:01:00+08:00');
    gmail.deliver(amazonLetter('Ian Webb', '<idle7@buyer.example>', '2026-09-07T10:00:00+08:00'));
    await t.runJobs();
    gmail.send(
      reply('Ian Webb', '2026-09-07T11:00:00+08:00', { 'In-Reply-To': '<idle7@buyer.example>' }),
    );
    await t.runJobs();

    await scanAt('2026-09-14T09:59:00+08:00');
    expect((await onlyTicketOf(agent, 'Ian Webb')).ticket.status).toBe('awaiting_customer');
    await scanAt('2026-09-14T10:00:00+08:00');
    const detail = await onlyTicketOf(agent, 'Ian Webb');
    expect(detail.ticket).toEqual(
      expect.objectContaining({ status: 'closed', closeReason: 'customer_no_reply' }),
    );
    expect((await statusChanges(t, detail.ticket.number)).at(-1)).toEqual([
      'idle_7_days',
      'closed',
      'system',
      'customer_no_reply',
    ]);
    // 关闭的业务时刻是扫描时的「当前时间」（R-TK-01 的 30 天重开按它判断）
    const { rows } = await t.runtime.db.execute<{ occurred_at: Date }>(sql`
      SELECT c.occurred_at FROM ticket.status_change c JOIN ticket.ticket k ON k.id = c.ticket_id
       WHERE k.number = ${detail.ticket.number} ORDER BY c.id DESC LIMIT 1`);
    expect(new Date(rows[0]!.occurred_at).toISOString()).toBe(iso('2026-09-14T10:00:00+08:00'));
  });

  it('已解决 7 天无来信 → 已关闭，原因「已解决后无来信」', async () => {
    await travel('2026-09-08T10:01:00+08:00');
    gmail.deliver(
      amazonLetter('Joy Kerr', '<resolved@buyer.example>', '2026-09-08T10:00:00+08:00'),
    );
    await t.runJobs();
    const [ticket] = await ticketsOf(agent, 'Joy Kerr');
    await markAllNoReply(t, agent, ticket!.number, '2026-09-08T10:05:00+08:00');
    expect((await onlyTicketOf(agent, 'Joy Kerr')).ticket.status).toBe('resolved');

    await scanAt('2026-09-15T09:59:00+08:00');
    expect((await onlyTicketOf(agent, 'Joy Kerr')).ticket.status).toBe('resolved');
    await scanAt('2026-09-15T10:00:00+08:00');
    expect((await onlyTicketOf(agent, 'Joy Kerr')).ticket).toEqual(
      expect.objectContaining({ status: 'closed', closeReason: 'resolved_no_inbound' }),
    );
  });

  it('已解决的工单收到新来信 → 回到待回复', async () => {
    await travel('2026-09-09T10:01:00+08:00');
    gmail.deliver(amazonLetter('Kai Lund', '<back-1@buyer.example>', '2026-09-09T10:00:00+08:00'));
    await t.runJobs();
    const [ticket] = await ticketsOf(agent, 'Kai Lund');
    await markAllNoReply(t, agent, ticket!.number, '2026-09-09T10:05:00+08:00');
    gmail.deliver(amazonLetter('Kai Lund', '<back-2@buyer.example>', '2026-09-09T12:00:00+08:00'));
    await travel('2026-09-09T12:01:00+08:00');
    await t.runJobs();
    expect((await onlyTicketOf(agent, 'Kai Lund')).ticket.status).toBe('awaiting_reply');
  });

  it('AC-TK-13 与 14 天规则：待回复 14 天无新来信 → 已关闭（未识别到回复），未回复的应回复来信计未达标；期间有新来信则重新起算', async () => {
    await travel('2026-09-10T10:01:00+08:00');
    gmail.deliver(
      amazonLetter('Lea Voss', '<idle14-1@buyer.example>', '2026-09-10T10:00:00+08:00'),
    );
    await t.runJobs();
    // 第 10 天又来一封：14 天从这封起算
    await travel('2026-09-20T10:01:00+08:00');
    gmail.deliver(
      amazonLetter('Lea Voss', '<idle14-2@buyer.example>', '2026-09-20T10:00:00+08:00'),
    );
    await t.runJobs();

    await scanAt('2026-09-24T10:00:00+08:00');
    expect((await onlyTicketOf(agent, 'Lea Voss')).ticket.status).toBe('awaiting_reply');
    await scanAt('2026-10-04T09:59:00+08:00');
    expect((await onlyTicketOf(agent, 'Lea Voss')).ticket.status).toBe('awaiting_reply');
    await scanAt('2026-10-04T10:00:00+08:00');

    const detail = await onlyTicketOf(agent, 'Lea Voss');
    expect(detail.ticket).toEqual(
      expect.objectContaining({ status: 'closed', closeReason: 'reply_not_detected' }),
    );
    expect(inbound(detail).map(slaOf)).toEqual([
      { firstReplyAt: null, result: 'missed' },
      { firstReplyAt: null, result: 'missed' },
    ]);
    expect((await statusChanges(t, detail.ticket.number)).at(-1)).toEqual([
      'idle_14_days',
      'closed',
      'system',
      'reply_not_detected',
    ]);
  });

  it('关闭后才同步进来的回信：进全程记录、记首次回复（首响照样统计），不改状态；超时后才回的仍是未达标（R-SL-07）', async () => {
    await travel('2026-10-05T10:00:00+08:00');
    gmail.send(
      reply('Lea Voss', '2026-10-05T09:00:00+08:00', { 'In-Reply-To': '<idle14-2@buyer.example>' }),
    );
    await t.runJobs();
    const detail = await onlyTicketOf(agent, 'Lea Voss');
    expect(detail.ticket.status).toBe('closed');
    expect(outbound(detail)).toHaveLength(1);
    expect(inbound(detail).map(slaOf)).toEqual([
      { firstReplyAt: iso('2026-10-05T09:00:00+08:00'), result: 'missed' },
      { firstReplyAt: iso('2026-10-05T09:00:00+08:00'), result: 'missed' },
    ]);
  });

  it('晚到的来信早于已关闭工单里已归属的回复：已被回复，不重开，只归进这张工单（不记工单量事件）', async () => {
    await travel('2026-10-10T10:01:00+08:00');
    amazon.put(AUTO.id, {
      orderId: '113-2000003-0000003',
      updatedAt: new Date('2026-10-01T10:00:00+08:00'),
      createdAt: new Date('2026-10-01T10:00:00+08:00'),
    });
    gmail.deliver(
      amazonLetter(
        'Max Lind',
        '<late-reopen-2@buyer.example>',
        '2026-10-10T10:00:00+08:00',
        'Order 113-2000003-0000003',
      ),
    );
    await t.runJobs();
    gmail.send(
      reply('Max Lind', '2026-10-10T11:00:00+08:00', {
        'In-Reply-To': '<late-reopen-2@buyer.example>',
      }),
    );
    await t.runJobs();
    await scanAt('2026-10-17T10:00:00+08:00');
    expect((await onlyTicketOf(agent, 'Max Lind')).ticket.status).toBe('closed');

    // 回信之前的一封（10-10 09:00）这时才同步进来
    gmail.deliver(
      amazonLetter(
        'Max Lind',
        '<late-reopen-1@buyer.example>',
        '2026-10-10T09:00:00+08:00',
        'Order 113-2000003-0000003',
      ),
    );
    await t.runJobs();
    const detail = await onlyTicketOf(agent, 'Max Lind');
    expect(detail.ticket).toEqual(
      expect.objectContaining({ status: 'closed', closeReason: 'customer_no_reply' }),
    );
    expect(slaOf(inbound(detail)[0]!)).toEqual({
      firstReplyAt: iso('2026-10-10T11:00:00+08:00'),
      result: 'met',
    });
    expect((await statusChanges(t, detail.ticket.number)).map(([event]) => event)).toEqual([
      'inbound',
      'reply_detected',
      'idle_7_days',
    ]);
  });

  it('工单量要的事件：新建与重开的状态变更记下触发的那封来信，可按来信来源分出客户来信触发的', async () => {
    // 前面用例：生产厂来信新建了 113-2000001-0000001 的工单；Fay Stone 的工单由客户来信新建
    const { rows } = await t.runtime.db.execute<{
      customer: string;
      event: string;
      source: string;
    }>(
      sql`
      SELECT cu.name AS customer, c.event, m.source
        FROM ticket.status_change c
        JOIN ticket.ticket k ON k.id = c.ticket_id
        JOIN ticket.customer cu ON cu.id = k.customer_id
        JOIN ticket.ticket_message m ON m.channel_message_id = c.channel_message_id
       WHERE c.from_status IS NULL OR c.event = 'inbound_reopen'
       ORDER BY c.id`,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { customer: 'FQD 品质部', event: 'inbound', source: 'producer' },
        { customer: 'Fay Stone', event: 'inbound', source: 'customer' },
      ]),
    );
    // 每一条新建都对得上触发的来信
    const { rows: counts } = await t.runtime.db.execute<{ creates: number; linked: number }>(sql`
      SELECT count(*)::int AS creates, count(m.id)::int AS linked
        FROM ticket.status_change c
        LEFT JOIN ticket.ticket_message m ON m.channel_message_id = c.channel_message_id
       WHERE c.from_status IS NULL`);
    expect(counts[0]!.creates).toBeGreaterThan(0);
    expect(counts[0]!.linked).toBe(counts[0]!.creates);
  });
});

/** 把工单的全部未回复来信「标记无需回复」（P05 的接口，待办 17），标记时刻为 at */
async function markAllNoReply(
  t: TestHarness,
  client: ApiClient,
  number: string,
  at: string,
): Promise<void> {
  t.clock.set(at);
  for (const message of (await ticketDetail(client, number)).messages.filter(isUnrepliedInbound)) {
    const res = await client.post(`/api/tickets/${number}/messages/${message.id}/no-reply`, {});
    expect(res.status, await res.clone().text()).toBe(200);
  }
}

describe('Shopify 与邮件的内部目标', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let agent: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    await t.runJobs();
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  it('联系表单来信按内部目标计（24 小时），回到客户邮箱的回信同样归属', async () => {
    t.clock.set('2026-09-10T11:49:00+08:00');
    gmail.deliver({
      to: COM.mailbox,
      from: { name: 'forcome.com', address: SHOPIFY_CONTACT_FORM_SENDER },
      headers: { 'Reply-To': 'mona.blake@example.com' },
      subject: 'New customer message on forcome.com',
      text: [
        "You received a new message from your online store's contact form.",
        'Country Code: US',
        'Name: Mona Blake',
        'Email: mona.blake@example.com',
        'Body:',
        'Where is my order?',
      ].join('\n'),
      at: '2026-09-10T11:48:00+08:00',
      messageId: '<form@shopify.example>',
    });
    await t.runJobs();
    const before = await onlyTicketOf(agent, 'Mona Blake');
    expect(inbound(before)[0]!.sla).toEqual({
      target: 'internal',
      dueAt: iso('2026-09-11T11:48:00+08:00'),
      result: 'pending',
    });

    gmail.send({
      from: COM.mailbox,
      to: 'mona.blake@example.com',
      subject: 'Re: New customer message on forcome.com',
      text: 'Hi Mona, your order shipped yesterday.',
      at: '2026-09-10T13:00:00+08:00',
      headers: { 'In-Reply-To': '<form@shopify.example>' },
    });
    await t.runJobs();
    const after = await onlyTicketOf(agent, 'Mona Blake');
    expect(after.ticket.status).toBe('awaiting_customer');
    expect(inbound(after)[0]!.sla?.result).toBe('met');
  });
});
