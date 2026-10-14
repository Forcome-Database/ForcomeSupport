import {
  amazonDomains,
  ticketDetailSchema,
  ticketListSchema,
  type TicketDetail,
  type TicketStatusStep,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gmailPollJob, gmailSyncJob } from '../src/modules/channel';
import { toMilliseconds } from '../src/modules/core';
import {
  amazonOrdersClient,
  gmailClient,
  type FakeGmail,
  type FakeMailInput,
} from '../src/modules/integration';
import { ticketTimeLimitsJob } from '../src/modules/ticket';
import type { ApiClient } from './api-client';
import { DEMO_NOW, startTestHarness, type TestHarness } from './harness';

/*
 * 按时关闭与同步滞后（待办 33，ADR 0008「待办 33 落地」修订）：时限扫描只在到期前的来信都已看到时按时关闭——
 * 店铺的进线邮箱都已同步到到期时刻，店铺在最近来信与到期之间到达的来信都已归并；没看到就本轮不关，等之后的扫描。
 * 关闭时存下到期时刻，P05 状态流转里这一步直接用它。worker 的每分钟扫描与每 5 分钟的邮箱轮询用 t.scanTimeLimits 模拟
 * （先轮询再扫描），只扫描不轮询、只同步不归并的用 t.enqueue 与 runJobs 的 only 写出来。
 */

const fixture = getDemoFixture();
const AUTO = fixture.stores.find((s) => s.name === 'Forcome Auto')!;
const RELAY_US = amazonDomains.US.relay;
const slug = (buyer: string) => buyer.toLowerCase().replace(/\W+/g, '.');
const relayOf = (buyer: string) => `${slug(buyer)}@${RELAY_US}`;
const iso = (at: string) => new Date(at).toISOString();
const DAY = toMilliseconds({ days: 1 });

/** 客户来信；给了订单号的写在正文里（同一订单的来信按 R-TK-01 归到同一张工单，关闭 30 天内重开） */
function letter(buyer: string, n: number, at: string, orderId?: string): FakeMailInput {
  return {
    to: AUTO.mailbox,
    from: { name: buyer, address: relayOf(buyer) },
    subject: 'Question about my order',
    text: orderId ? `Hello from ${buyer}\n\nOrder ID: ${orderId}` : `Hello from ${buyer}`,
    at,
    messageId: `<${slug(buyer)}-${n}@buyer.example>`,
  };
}

function reply(buyer: string, n: number, at: string): Parameters<FakeGmail['send']>[0] {
  return {
    from: AUTO.mailbox,
    to: relayOf(buyer),
    subject: 'Re: Question about my order',
    text: `Hi ${buyer}`,
    at,
    headers: { 'In-Reply-To': `<${slug(buyer)}-${n}@buyer.example>` },
  };
}

async function detailOf(client: ApiClient, customer: string): Promise<TicketDetail> {
  const list = await client.get('/api/tickets');
  expect(list.status).toBe(200);
  const tickets = ticketListSchema
    .parse(await list.json())
    .tickets.filter((tk) => tk.customer.name === customer);
  expect(tickets).toHaveLength(1);
  const res = await client.get(`/api/tickets/${tickets[0]!.number}`);
  expect(res.status).toBe(200);
  return ticketDetailSchema.parse(await res.json());
}

/** 一张工单的状态变更记录：事件、发生时刻、存下的到期时刻 */
async function changesOf(
  t: TestHarness,
  number: string,
): Promise<{ event: string; occurredAt: string; dueAt: string | null }[]> {
  const { rows } = await t.runtime.db.execute<{
    event: string;
    occurred_at: Date;
    due_at: Date | null;
  }>(sql`
    SELECT sc.event, sc.occurred_at, sc.due_at FROM ticket.status_change sc
    JOIN ticket.ticket tk ON tk.id = sc.ticket_id WHERE tk.number = ${number} ORDER BY sc.id`);
  return rows.map((row) => ({
    event: row.event,
    occurredAt: new Date(row.occurred_at).toISOString(),
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
  }));
}

/** 工单量的事件（客户来信触发的新建与重开，P17、P04 下钻同一个视图）在这张工单上有几条 */
async function triggerEventsOf(t: TestHarness, number: string): Promise<number> {
  const { rows } = await t.runtime.db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM ticket.customer_trigger_event e
    JOIN ticket.ticket tk ON tk.id = e.ticket_id WHERE tk.number = ${number}`);
  return rows[0]!.n;
}

const events = (detail: TicketDetail) => detail.statusFlow.map((s) => s.event);

describe('按时关闭前确认邮箱已同步、到期前的来信已归并（待办 33）', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let agent: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    await t.runJobs();
  });

  afterAll(async () => {
    await t.close();
  });

  /** 拨钟（一跳可能超过 7 天，会话按 7 天无操作过期，拨完重新登录） */
  async function travel(at: string): Promise<void> {
    t.clock.set(at);
    agent = await t.loginAs('坐席');
  }

  /** 一位客户来信、我方 30 分钟后回复：工单在等客户，最近来信即这封 */
  async function awaitingCustomer(
    buyer: string,
    at: string,
    orderId?: string,
  ): Promise<TicketDetail> {
    await travel(at);
    gmail.deliver(letter(buyer, 1, at, orderId));
    await t.runJobs();
    const replied = new Date(Date.parse(at) + 30 * 60_000);
    t.clock.set(replied.toISOString());
    gmail.send(reply(buyer, 1, replied.toISOString()));
    await t.runJobs();
    const detail = await detailOf(agent, buyer);
    expect(detail.ticket.status).toBe('awaiting_customer');
    return detail;
  }

  it('邮箱同步滞后（最近同步成功早于到期时刻）时不关闭；同步追上后下一轮照常关闭，原因与 P05 的时刻不变', async () => {
    const { ticket } = await awaitingCustomer('Nia Lag', '2026-09-01T10:00:00+08:00');
    // 到期 09-08 10:00；Gmail 断线，轮询的同步失败，邮箱停在 09-01
    gmail.faults.disconnect();
    for (const at of ['2026-09-08T10:05:00+08:00', '2026-09-09T10:00:00+08:00']) {
      await travel(at);
      await t.scanTimeLimits({ allowFailures: true });
      expect((await detailOf(agent, 'Nia Lag')).ticket.status).toBe('awaiting_customer');
    }
    // 只扫描、邮箱没有新的同步成功：同样不关
    await t.enqueue(ticketTimeLimitsJob, {});
    await t.runJobs({ allowFailures: true });
    expect((await detailOf(agent, 'Nia Lag')).ticket.status).toBe('awaiting_customer');

    gmail.faults.reconnect();
    await travel('2026-09-09T12:00:00+08:00');
    await t.scanTimeLimits();
    const closed = await detailOf(agent, 'Nia Lag');
    expect(closed.ticket).toMatchObject({ status: 'closed', closeReason: 'customer_no_reply' });
    expect(closed.statusFlow.at(-1)).toEqual<TicketStatusStep>({
      at: iso('2026-09-08T10:00:00+08:00'),
      event: 'idle_7_days',
      from: 'awaiting_customer',
      to: 'closed',
      trigger: 'system',
      actorName: '系统',
      closeReason: 'customer_no_reply',
    });
    expect((await changesOf(t, ticket.number)).at(-1)).toEqual({
      event: 'idle_7_days',
      occurredAt: iso('2026-09-09T12:00:00+08:00'),
      dueAt: iso('2026-09-08T10:00:00+08:00'),
    });
  });

  it('滞后期间到期前到达的来信补拉进来后：工单照常回到待回复，没有多出的关闭与重开（工单量的重开不变）', async () => {
    const { ticket } = await awaitingCustomer('Omar Late', '2026-09-02T10:00:00+08:00');
    gmail.faults.disconnect();
    // 到期 09-09 10:00 之前客户又来信，但 Gmail 断着，同步不进来
    gmail.deliver(letter('Omar Late', 2, '2026-09-09T09:00:00+08:00'));
    await travel('2026-09-09T10:30:00+08:00');
    await t.scanTimeLimits({ allowFailures: true });
    expect((await detailOf(agent, 'Omar Late')).ticket.status).toBe('awaiting_customer');

    gmail.faults.reconnect();
    await travel('2026-09-09T11:00:00+08:00');
    await t.scanTimeLimits();
    const detail = await detailOf(agent, 'Omar Late');
    expect(detail.ticket.status).toBe('awaiting_reply');
    expect(events(detail)).toEqual(['inbound', 'reply_detected', 'inbound']);
    expect(await triggerEventsOf(t, ticket.number)).toBe(1);
  });

  it('邮箱已同步、到期前的来信还在排队归并：本轮不关，归并后回到待回复，没有关闭与重开', async () => {
    const { ticket } = await awaitingCustomer('Pia Queue', '2026-09-03T10:00:00+08:00');
    gmail.deliver(letter('Pia Queue', 2, '2026-09-10T09:30:00+08:00'));
    await travel('2026-09-10T10:05:00+08:00');
    // 只同步（入库、发出「来信已接收」），先不归并：邮箱同步到了此刻，但这封还不在工单里
    await t.enqueue(gmailPollJob, {});
    await t.runJobs({ only: [gmailPollJob.name, gmailSyncJob.name] });
    await t.enqueue(ticketTimeLimitsJob, {});
    await t.runJobs({ only: [ticketTimeLimitsJob.name] });
    expect((await detailOf(agent, 'Pia Queue')).ticket.status).toBe('awaiting_customer');

    await t.runJobs();
    await t.scanTimeLimits();
    const detail = await detailOf(agent, 'Pia Queue');
    expect(detail.ticket.status).toBe('awaiting_reply');
    expect(events(detail)).toEqual(['inbound', 'reply_detected', 'inbound']);
    expect(await triggerEventsOf(t, ticket.number)).toBe(1);
  });

  it('P05 状态流转里按时关闭的时刻 = 关闭时存下的到期时刻，不晚于关闭时刻；关闭后才同步进来、早于关闭的来信不改它', async () => {
    const orderId = '113-3300001-0000001';
    t.clients.fake(amazonOrdersClient).put(AUTO.id, {
      orderId,
      updatedAt: new Date('2026-09-01T10:00:00+08:00'),
      createdAt: new Date('2026-09-01T10:00:00+08:00'),
    });
    const { ticket } = await awaitingCustomer('Quin Gap', '2026-09-04T10:00:00+08:00', orderId);
    // 到期 09-11 10:00，扫描 13:00 才关上（worker 停了几小时）
    await travel('2026-09-11T13:00:00+08:00');
    await t.scanTimeLimits();
    expect((await detailOf(agent, 'Quin Gap')).ticket.status).toBe('closed');
    // 客户 11:00 的来信 Gmail 晚投递，关闭之后才同步进来：到期之后才到，按 30 天内重开
    gmail.deliver(letter('Quin Gap', 2, '2026-09-11T11:00:00+08:00', orderId));
    await travel('2026-09-11T14:00:00+08:00');
    await t.runJobs();
    const detail = await detailOf(agent, 'Quin Gap');
    expect(detail.ticket.status).toBe('awaiting_reply');
    const close = detail.statusFlow.find((s) => s.event === 'idle_7_days')!;
    // 原来读取时重算（关闭前最近来信 + 7 天）会取到这封 11:00 的信，显示成 09-18 11:00
    expect(close.at).toBe(iso('2026-09-11T10:00:00+08:00'));
    expect(
      (await changesOf(t, ticket.number)).map((c) => [c.event, c.occurredAt, c.dueAt]),
    ).toEqual([
      ['inbound', iso('2026-09-04T10:00:00+08:00'), null],
      ['reply_detected', iso('2026-09-04T10:30:00+08:00'), null],
      ['idle_7_days', iso('2026-09-11T13:00:00+08:00'), iso('2026-09-11T10:00:00+08:00')],
      ['inbound_reopen', iso('2026-09-11T14:00:00+08:00'), null],
    ]);
  });
});

describe('非生产的示例回放不与时限扫描交错（待办 33；集成验证冒烟 ticket-detail.spec.ts I18 ① 的偶发失败）', () => {
  let t: TestHarness;
  /** 演示时刻之后 1 天 18 小时：示例邮件整天平移 1 天，演示时刻落在「现在」之前 18 小时（开发测试环境的情形） */
  const shift = DAY;
  const now = new Date(Date.parse(DEMO_NOW) + shift + toMilliseconds({ hours: 18 }));
  const timeline = fixture.ticketTimeline;

  beforeAll(async () => {
    t = await startTestHarness();
    t.clock.set(now.toISOString());
    await t.loadFixtures();
    t.clients.replayFixtures(fixture);
    // worker 一个任务一个任务地推进（入库、归并、回复识别……），每个任务之后都插一次每分钟的时限扫描
    for (let i = 0; ; i += 1) {
      expect(i).toBeLessThan(5000);
      const report = await t.runJobs({ limit: 1 });
      if (report.completed.length + report.failed.length === 0) break;
      await t.enqueue(ticketTimeLimitsJob, {});
      await t.runJobs({ only: [ticketTimeLimitsJob.name] });
    }
  }, 600_000);

  afterAll(async () => {
    await t.close();
  });

  it('前提：Oliver Grant 的第一封来信平移后 + 7 天早已过去（只看库里最近来信的扫描会在第一、二封之间关单）', () => {
    const first = Date.parse(timeline.statusFlow[0]!.at) + shift;
    expect(first + 7 * DAY).toBeLessThan(now.getTime());
  });

  it('Oliver Grant 的状态流转与示例数据一致（平移 1 天），没有多出的关闭与重开', async () => {
    const detail = await detailOf(await t.loginAs('坐席'), 'Oliver Grant');
    const STATUS = { 待回复: 'awaiting_reply', 等客户: 'awaiting_customer', 已解决: 'resolved' };
    expect(detail.statusFlow.map((s) => [s.to, s.at, s.actorName])).toEqual(
      timeline.statusFlow.map((s) => [
        STATUS[s.status as keyof typeof STATUS],
        new Date(Date.parse(s.at) + shift).toISOString(),
        s.actor,
      ]),
    );
  });

  it('全部示例工单：没有一次关闭被到期之前到达的来信重开（关早了）', async () => {
    const { rows } = await t.runtime.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM ticket.status_change c
      JOIN ticket.status_change r ON r.ticket_id = c.ticket_id AND r.id > c.id AND r.event = 'inbound_reopen'
      JOIN ticket.ticket_message m ON m.channel_message_id = r.channel_message_id
      WHERE c.event IN ('idle_7_days', 'idle_14_days') AND m.received_at < c.due_at`);
    expect(rows[0]!.n).toBe(0);
  });
});
