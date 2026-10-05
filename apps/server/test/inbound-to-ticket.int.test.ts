import {
  ticketDetailSchema,
  ticketListSchema,
  type TicketDetail,
  type TicketListItem,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  gmailClient,
  gmailPushClient,
  type FakeGmail,
  type FakeMailInput,
} from '../src/modules/integration';
import { inboundReceivedJob } from '../src/modules/channel';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 曳光弹：来信到工单（待办 08；规格「收取与归并」、R-TK-02、R-TK-07、E-15，PRD 6.1 第一阶段迁移表）。
 * Fake Gmail 里放一封客户来信 → 跑完任务（Pub/Sub 拉取、history.list 同步、入库去重、「来信已接收」→ 归并）→
 * 以坐席身份调 P04 接口，看到「待回复」工单。
 */

const stores = getDemoFixture().stores;
const AUTO = stores.find((s) => s.name === 'Forcome Auto')!;
const DIRECT = stores.find((s) => s.name === 'Forcome Direct')!;

const JAMES = { name: 'James Walker', address: 'james.walker@example.com' };

function letter(overrides: Partial<FakeMailInput> = {}): FakeMailInput {
  return {
    to: AUTO.mailbox,
    from: JAMES,
    subject: 'Box arrived crushed, the vacuum is cracked',
    text: 'The box arrived crushed and the vacuum body is cracked.',
    at: '2026-09-10T08:15:00+08:00',
    ...overrides,
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

describe('来信到工单', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let agent: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    // 系统开始监听店铺邮箱（watch 建立增量游标），之后到达的来信才会同步进来
    await t.runJobs();
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  it('Fake 来信 → 跑完任务 → 坐席在 P04 看到「待回复」工单，编号为 T-首封来信日期-当日序号', async () => {
    gmail.deliver(letter());
    await t.runJobs();

    expect(await ticketList(agent)).toEqual([
      {
        id: expect.any(String) as string,
        number: 'T-20260910-0001',
        subject: 'Box arrived crushed, the vacuum is cracked',
        // 渠道识别（R-TK-08）与亚马逊按发件域识别站点随待办 10：先记「邮件」、站点取店铺默认站点
        channel: 'email',
        site: 'US',
        store: { id: AUTO.id, name: 'Forcome Auto' },
        customer: { name: 'James Walker' },
        status: 'awaiting_reply',
        lastInboundAt: '2026-09-10T00:15:00.000Z',
      },
    ]);
  });

  it('同一消息重复投递只入库一次（E-15）：同一封信在 Gmail 的 history 里再次出现，不会再入库、再归并', async () => {
    const customer = { name: 'Marcus Lee', address: 'marcus.lee@example.com' };
    const [gmailId] = gmail.deliver(
      letter({
        from: customer,
        subject: 'Received the wrong color',
        at: '2026-09-08T21:30:00+08:00',
      }),
    );
    await t.runJobs();
    gmail.redeliver(AUTO.mailbox, gmailId!);
    await t.runJobs();

    const tickets = await ticketsOf(agent, 'Marcus Lee');
    expect(tickets).toHaveLength(1);
    const detail = await ticketDetail(agent, tickets[0]!.number);
    expect(detail.messages).toEqual([
      expect.objectContaining({ mailbox: AUTO.mailbox, subject: 'Received the wrong color' }),
    ]);
  });

  it('同一消息重复投递只入库一次（E-15）：Pub/Sub 的通知没确认成功、再次投递，来信仍只入库一次', async () => {
    const customer = { name: 'Laura Bennett', address: 'laura.bennett@example.com' };
    gmail.deliver(
      letter({ from: customer, subject: 'Filter turned yellow', at: '2026-09-08T08:01:00+08:00' }),
    );
    const push = t.clients.fake(gmailPushClient);
    push.faults.failNext({ kind: 'error', status: 503 }, { operation: 'acknowledge' });
    await expect(t.runJobs()).rejects.toThrow(/acknowledge/);
    await t.runJobs();

    expect(push.unacknowledged).toBe(0);
    const tickets = await ticketsOf(agent, 'Laura Bennett');
    expect(tickets).toHaveLength(1);
    expect((await ticketDetail(agent, tickets[0]!.number)).messages).toHaveLength(1);
  });

  it('同一封邮件（Message-ID 相同）同时发到两个店铺邮箱：只建一张工单，另一封记「同时发送到」（R-TK-07）', async () => {
    const customer = { name: 'Diego Salazar', address: 'diego.salazar@example.com' };
    gmail.deliver(
      letter({
        to: [AUTO.mailbox, DIRECT.mailbox],
        from: customer,
        subject: 'La manguera está rota',
        at: '2026-09-07T07:52:00+08:00',
        messageId: '<hose-broken@mail.example.com>',
      }),
    );
    await t.runJobs();

    const tickets = await ticketsOf(agent, 'Diego Salazar');
    expect(tickets).toHaveLength(1);
    const [ticket] = tickets;
    // 两份同时入库时谁先到不确定：先入库的那份所在店铺建工单，另一个邮箱记在它的「同时发送到」
    const [first, other] =
      ticket!.store.id === AUTO.id
        ? [AUTO.mailbox, DIRECT.mailbox]
        : [DIRECT.mailbox, AUTO.mailbox];
    expect((await ticketDetail(agent, ticket!.number)).messages).toEqual([
      expect.objectContaining({ mailbox: first, alsoSentTo: [other] }),
    ]);
  });

  it('同一封邮件的副本晚到另一个店铺邮箱：仍归在先到的那张工单上，晚到的邮箱记「同时发送到」', async () => {
    const customer = { name: 'Sofía Márquez', address: 'sofia.marquez@example.com' };
    const mail = letter({
      to: DIRECT.mailbox,
      from: customer,
      subject: 'Reembolso de mi devolución',
      at: '2026-09-06T17:20:00+08:00',
      messageId: '<refund-request@mail.example.com>',
    });
    gmail.deliver(mail);
    await t.runJobs();
    gmail.deliver({ ...mail, to: AUTO.mailbox });
    await t.runJobs();

    const tickets = await ticketsOf(agent, 'Sofía Márquez');
    expect(tickets.map((ticket) => ticket.store.name)).toEqual(['Forcome Direct']);
    expect((await ticketDetail(agent, tickets[0]!.number)).messages).toEqual([
      expect.objectContaining({ mailbox: DIRECT.mailbox, alsoSentTo: [AUTO.mailbox] }),
    ]);
  });

  it('同一客户第二封无订单来信追加到原工单（R-TK-02）：仍是一张待回复工单，最近来信更新，编号日期仍取首封', async () => {
    const customer = { name: 'Ana Souza', address: 'ana.souza@example.com' };
    gmail.deliver(
      letter({
        from: customer,
        subject: 'Wholesale pricing for 200 units?',
        at: '2026-09-05T14:00:00+08:00',
      }),
    );
    await t.runJobs();
    gmail.deliver(
      letter({
        from: customer,
        subject: 'Re: Wholesale pricing for 200 units?',
        at: '2026-09-09T09:30:00+08:00',
      }),
    );
    await t.runJobs();

    const tickets = await ticketsOf(agent, 'Ana Souza');
    expect(tickets).toEqual([
      expect.objectContaining({
        number: 'T-20260905-0001',
        subject: 'Wholesale pricing for 200 units?',
        status: 'awaiting_reply',
        lastInboundAt: '2026-09-09T01:30:00.000Z',
      }),
    ]);
    const detail = await ticketDetail(agent, tickets[0]!.number);
    expect(detail.messages.map((m) => [m.subject, m.arrivedAt])).toEqual([
      ['Wholesale pricing for 200 units?', '2026-09-05T06:00:00.000Z'],
      ['Re: Wholesale pricing for 200 units?', '2026-09-09T01:30:00.000Z'],
    ]);
  });

  it('同一客户写到另一个店铺、或另一位客户写到同一店铺，各自新建工单（R-TK-02 按店铺与客户渠道身份）', async () => {
    const customer = { name: 'Valeria Ríos', address: 'valeria.rios@example.com' };
    const another = { name: 'Valeria Ríos', address: 'v.rios@example.com' };
    gmail.deliver(
      letter({
        from: customer,
        subject: '¿Cada cuánto cambio el filtro?',
        at: '2026-09-04T08:40:00+08:00',
      }),
    );
    gmail.deliver(
      letter({
        to: DIRECT.mailbox,
        from: customer,
        subject: 'Otra pregunta',
        at: '2026-09-04T09:00:00+08:00',
      }),
    );
    gmail.deliver(letter({ from: another, subject: 'Pregunta', at: '2026-09-04T09:10:00+08:00' }));
    await t.runJobs();

    const tickets = await ticketsOf(agent, 'Valeria Ríos');
    expect(tickets.map((ticket) => [ticket.store.name, ticket.subject]).sort()).toEqual([
      ['Forcome Auto', 'Pregunta'],
      ['Forcome Auto', '¿Cada cuánto cambio el filtro?'],
      ['Forcome Direct', 'Otra pregunta'],
    ]);
    // 两个邮箱的同步谁先跑不确定，序号按归并先后发放；同一天三张工单的序号不重复
    expect(tickets.map((ticket) => ticket.number).sort()).toEqual([
      'T-20260904-0001',
      'T-20260904-0002',
      'T-20260904-0003',
    ]);
  });

  it('归并任务对同一封消息重跑结果不变（幂等）', async () => {
    const customer = { name: 'Ethan Brooks', address: 'ethan.brooks@example.com' };
    gmail.deliver(
      letter({ from: customer, subject: 'Cable does not charge', at: '2026-09-03T10:04:00+08:00' }),
    );
    const report = await t.runJobs();
    const merges = report.completed.filter((job) => job.name === inboundReceivedJob.name);
    expect(merges).toHaveLength(1);
    const [before] = await ticketsOf(agent, 'Ethan Brooks');
    const detailBefore = await ticketDetail(agent, before!.number);

    for (const job of merges) {
      await t.enqueue(inboundReceivedJob, inboundReceivedJob.payload.parse(job.data));
    }
    const rerun = await t.runJobs();

    expect(rerun.completed.map((job) => job.name)).toEqual([inboundReceivedJob.name]);
    expect(await ticketsOf(agent, 'Ethan Brooks')).toEqual([before]);
    expect(await ticketDetail(agent, before!.number)).toEqual(detailBefore);
  });
});

describe('一个邮箱收不了信，不影响其他邮箱', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
  });

  afterAll(async () => {
    await t.close();
  });

  it('接真实接口的店铺（真实 Gmail 随 09 接入）开始监听失败，模拟数据的店铺照常收信成工单', async () => {
    const admin = await t.loginAs('管理员');
    const res = await admin.post('/api/channel/stores', {
      name: 'forcome.ca',
      platform: 'shopify',
      sites: ['CA'],
      defaultSite: 'CA',
      mailboxes: ['support@forcome.ca'],
      platformId: 'forcome-ca.myshopify.com',
      adapterMode: 'real',
    });
    expect(res.status).toBe(201);
    await t.runJobs();

    const gmail = t.clients.fake(gmailClient);
    expect(gmail.isWatched('support@forcome.ca')).toBe(false);
    gmail.deliver(letter());
    await t.runJobs();
    expect((await ticketList(await t.loginAs('坐席'))).map((ticket) => ticket.store.name)).toEqual([
      'Forcome Auto',
    ]);
  });
});

describe('工单接口的店铺范围与权限（R-ST-06、E-24、PRD 10.1）', () => {
  let t: TestHarness;
  let autoTicket: string;
  let directTicket: string;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    const gmail = t.clients.fake(gmailClient);
    await t.runJobs();
    gmail.deliver(letter({ at: '2026-09-10T08:15:00+08:00' }));
    gmail.deliver(
      letter({
        to: DIRECT.mailbox,
        from: { name: 'Sarah Mitchell', address: 'sarah.mitchell@example.com' },
        subject: "Tracking hasn't updated since Sep 5",
        at: '2026-09-10T16:00:00+08:00',
      }),
    );
    await t.runJobs();
    const all = await ticketList(await t.loginAs('客服主管'));
    autoTicket = all.find((ticket) => ticket.store.id === AUTO.id)!.number;
    directTicket = all.find((ticket) => ticket.store.id === DIRECT.id)!.number;
  });

  afterAll(async () => {
    await t.close();
  });

  async function directOnlySupervisor(): Promise<ApiClient> {
    const memberId = await t.addMember({
      name: '范围受限的主管',
      dept: 'FSH / 客服部',
      roles: ['supervisor'],
      allStores: false,
      storeIds: [DIRECT.id],
    });
    return t.loginAs({ memberId });
  }

  it('店铺范围受限的成员只看到授权店铺的工单', async () => {
    const supervisor = await directOnlySupervisor();
    expect((await ticketList(supervisor)).map((ticket) => ticket.number)).toEqual([directTicket]);
    expect((await ticketDetail(supervisor, directTicket)).ticket.store.name).toBe('Forcome Direct');
  });

  it('打开范围外店铺的工单详情：403，审计记下越权访问（E-24）', async () => {
    t.clock.set('2026-09-11T02:30:00Z');
    const supervisor = await directOnlySupervisor();
    const res = await supervisor.get(`/api/tickets/${autoTicket}`);

    expect(res.status).toBe(403);
    expect((await t.auditRecords({ action: 'access.denied' })).at(-1)).toMatchObject({
      occurredAt: new Date('2026-09-11T02:30:00Z'),
      actorName: '范围受限的主管',
      objectType: 'ticket',
      objectLabel: autoTicket,
      storeId: AUTO.id,
      after: { reason: 'store_scope', path: `/api/tickets/${autoTicket}` },
    });
  });

  it('坐席、客服主管、售后负责人、知识库负责人（只读）能看工单；管理员没有「查看工单」，未登录 401', async () => {
    for (const role of ['坐席', '客服主管', '售后负责人', '知识库负责人']) {
      const client = await t.loginAs(role);
      expect((await ticketList(client)).map((ticket) => ticket.number).sort()).toEqual(
        [autoTicket, directTicket].sort(),
      );
    }
    const admin = await t.loginAs('管理员');
    expect((await admin.get('/api/tickets')).status).toBe(403);
    expect((await admin.get(`/api/tickets/${autoTicket}`)).status).toBe(403);
    expect((await t.api.get('/api/tickets')).status).toBe(401);
  });

  it('没有这张工单 404；工单号格式不对 400', async () => {
    const agent = await t.loginAs('坐席');
    expect((await agent.get('/api/tickets/T-20200101-0001')).status).toBe(404);
    expect((await agent.get('/api/tickets/not-a-number')).status).toBe(400);
  });
});

describe('工单状态只能经迁移表改变（ADR 0008）', () => {
  const GUARD = '工单状态只能经迁移表改变';
  let t: TestHarness;
  let agent: ApiClient;
  let number: string;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    await t.runJobs();
    t.clients.fake(gmailClient).deliver(letter());
    await t.runJobs();
    agent = await t.loginAs('坐席');
    [{ number }] = (await ticketList(agent)) as [TicketListItem];
  });

  afterAll(async () => {
    await t.close();
  });

  // 模拟一段绕过迁移表、直接改状态列的代码：数据库在提交时拒绝，工单状态不变
  it('绕过迁移表直接改工单状态的写入被数据库拒绝', async () => {
    await expect(
      t.runtime.db.execute(
        sql`UPDATE ticket.ticket SET status = 'resolved' WHERE number = ${number}`,
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringContaining(GUARD) as string } });
    expect((await ticketList(agent)).map((ticket) => ticket.status)).toEqual(['awaiting_reply']);
  });

  it('不写状态变更记录直接插入工单也被拒绝', async () => {
    const [existing] = (
      await t.runtime.db.execute<{ store_id: string; customer_id: string }>(
        sql`SELECT store_id, customer_id FROM ticket.ticket WHERE number = ${number}`,
      )
    ).rows;
    await expect(
      t.runtime.db.execute(sql`
        INSERT INTO ticket.ticket (number, store_id, channel, site, customer_id, subject, status,
          first_inbound_at, last_inbound_at, created_at, updated_at)
        VALUES ('T-20260910-0999', ${existing!.store_id}, 'email', 'US', ${existing!.customer_id}, '绕过', 'awaiting_reply',
          now(), now(), now(), now())`),
    ).rejects.toMatchObject({ cause: { message: expect.stringContaining(GUARD) as string } });
    expect(await ticketList(agent)).toHaveLength(1);
  });
});

describe('开发测试环境的示例来信回放（ADR 0009 修订）', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    // 与 worker 启动时一样：Fake 从示例数据夹具回放来信，邮箱开始监听后送达
    t.clients.replayFixtures(getDemoFixture());
    await t.runJobs();
  });

  afterAll(async () => {
    await t.close();
  });

  it('示例工单的来信都归并成待回复工单；同一客户的无订单来信归到一张（订单号归并随 14）', async () => {
    const fixture = getDemoFixture();
    const tickets = await ticketList(await t.loginAs('客服主管'));
    const customers = new Set(fixture.tickets.map((ticket) => ticket.customer));
    // Priya Raman 在 forcome.com 有两张示例工单（两笔订单），08 还不按订单号归并，两封来信归到一张
    expect(tickets).toHaveLength(customers.size);
    expect(new Set(tickets.map((ticket) => ticket.customer.name))).toEqual(customers);
    expect(new Set(tickets.map((ticket) => ticket.status))).toEqual(new Set(['awaiting_reply']));

    const james = tickets.find((ticket) => ticket.customer.name === 'James Walker')!;
    // 当日序号按归并先后发放，几个邮箱的同步谁先跑不确定，这里只核对日期
    expect(james.number).toMatch(/^T-20260910-\d{4}$/);
    expect(james).toMatchObject({
      subject: 'Box arrived crushed, the vacuum is cracked',
      store: { name: 'Forcome Auto' },
      lastInboundAt: '2026-09-10T00:15:00.000Z',
    });
  });

  it('P05 时间线那张工单（Oliver Grant）按时间线里的三封来信回放，编号日期取首封来信', async () => {
    const agent = await t.loginAs('坐席');
    const oliver = (await ticketList(agent)).find(
      (ticket) => ticket.customer.name === 'Oliver Grant',
    )!;
    expect(oliver.number).toBe('T-20260904-0001');
    const detail = await ticketDetail(agent, oliver.number);
    expect(detail.messages.map((m) => [m.mailbox, m.arrivedAt])).toEqual([
      [DIRECT.mailbox, '2026-09-04T02:12:00.000Z'],
      [DIRECT.mailbox, '2026-09-05T00:58:00.000Z'],
      [DIRECT.mailbox, '2026-09-10T01:00:00.000Z'],
    ]);
  });

  it('worker 重启后再回放同样的来信，不会重复入库或新建工单', async () => {
    const before = await ticketList(await t.loginAs('客服主管'));
    t.resetFakes();
    t.clients.replayFixtures(getDemoFixture());
    // 已有游标的邮箱不再 watch，回放的信等续订 watch（09）时才送达；这里模拟续订后同步一次
    const gmail = t.clients.fake(gmailClient);
    for (const store of stores) await gmail.client(store.id).watch(store.mailbox);
    await t.runJobs();
    expect(await ticketList(await t.loginAs('客服主管'))).toEqual(before);
  });
});
