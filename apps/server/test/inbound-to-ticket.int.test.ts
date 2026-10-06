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
import { ticketTimeLimitsJob } from '../src/modules/ticket';
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
        source: 'customer',
        // 客户直接写到店铺邮箱（直邮）：渠道「邮件」、站点取店铺默认站点（R-TK-08，渠道与来源识别见 source-recognition）
        channel: 'email',
        site: 'US',
        store: { id: AUTO.id, name: 'Forcome Auto' },
        customer: { name: 'James Walker' },
        // 来信没有订单号、直邮的店铺是亚马逊店铺（不按邮箱反查）：无订单工单（R-TK-02）
        orderNumber: null,
        status: 'awaiting_reply',
        closeReason: null,
        lastInboundAt: '2026-09-10T00:15:00.000Z',
      },
    ]);
  });

  it('同一消息重复投递只入库一次（E-15）：同一封信在 Gmail 的 history 里再次出现，按「邮箱 + Gmail 消息 ID」去重，不会再入库、再归并', async () => {
    // 不带 Message-ID：去重只能靠「邮箱 + Gmail 消息 ID」，不会被 R-TK-07 的跨邮箱判重顶替
    const customer = { name: 'Marcus Lee', address: 'marcus.lee@example.com' };
    const [gmailId] = gmail.deliver(
      letter({
        from: customer,
        subject: 'Received the wrong color',
        at: '2026-09-08T21:30:00+08:00',
        messageId: null,
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

  it('Pub/Sub 的通知没确认成功、再次投递：来信仍只入库、归并一次', async () => {
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

  it('同一封邮件的副本晚入库（另一个邮箱同步滞后），即使它的到达时间更早，也只记「同时发送到」，不改工单的店铺（R-TK-07，10-05 用户确认）', async () => {
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
    // 另一个邮箱里的副本 internalDate 早 2 分钟，但同步得晚
    gmail.deliver({ ...mail, to: AUTO.mailbox, at: '2026-09-06T17:18:00+08:00' });
    await t.runJobs();

    const tickets = await ticketsOf(agent, 'Sofía Márquez');
    expect(tickets.map((ticket) => [ticket.store.name, ticket.lastInboundAt])).toEqual([
      ['Forcome Direct', '2026-09-06T09:20:00.000Z'],
    ]);
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

describe('并发归并（规格「需要覆盖的场景·并发」）', () => {
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

  it('同一位新客户的两封无订单来信同时归并：只建一位客户、一张工单，另一封追加（R-TK-02 加锁后再查再写）', async () => {
    const customer = { name: 'Priya Raman', address: 'priya.raman@example.com' };
    gmail.deliver(
      letter({ from: customer, subject: 'Change my address', at: '2026-09-10T10:05:00+08:00' }),
    );
    gmail.deliver(
      letter({ from: customer, subject: 'Re: Change my address', at: '2026-09-10T10:07:00+08:00' }),
    );
    const report = await t.runJobs({ concurrently: true });
    expect(report.completed.filter((job) => job.name === inboundReceivedJob.name)).toHaveLength(2);

    const tickets = await ticketsOf(agent, 'Priya Raman');
    expect(tickets).toHaveLength(1);
    expect((await ticketDetail(agent, tickets[0]!.number)).messages).toHaveLength(2);
  });

  it('同一封邮件的两份副本在两个店铺邮箱同时入库：只建一张工单（R-TK-07 按 Message-ID 加锁）', async () => {
    const customer = { name: 'Emily Chen', address: 'emily.chen@example.com' };
    gmail.deliver(
      letter({
        to: [AUTO.mailbox, DIRECT.mailbox],
        from: customer,
        subject: 'Does the V2 fit a Tesla Model Y?',
        at: '2026-09-10T11:48:00+08:00',
        messageId: '<tesla-fit@mail.example.com>',
      }),
    );
    const report = await t.runJobs({ concurrently: true });
    expect(report.completed.filter((job) => job.name === 'channel.gmail_sync')).toHaveLength(2);

    const tickets = await ticketsOf(agent, 'Emily Chen');
    expect(tickets).toHaveLength(1);
    const [message] = (await ticketDetail(agent, tickets[0]!.number)).messages;
    expect(message!.alsoSentTo).toHaveLength(1);
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

  it('绕过迁移表直接写关闭原因也被拒绝（关闭原因只随迁移到已关闭写入）', async () => {
    await expect(
      t.runtime.db.execute(
        sql`UPDATE ticket.ticket SET close_reason = 'customer_no_reply' WHERE number = ${number}`,
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringContaining(GUARD) as string } });
  });

  it('不写状态变更记录直接插入工单也被拒绝', async () => {
    const [existing] = (
      await t.runtime.db.execute<{ store_id: string; customer_id: string }>(
        sql`SELECT store_id, customer_id FROM ticket.ticket WHERE number = ${number}`,
      )
    ).rows;
    await expect(
      t.runtime.db.execute(sql`
        INSERT INTO ticket.ticket (number, store_id, channel, site, source, customer_id, subject, status,
          first_inbound_at, last_inbound_at, created_at, updated_at)
        VALUES ('T-20260910-0999', ${existing!.store_id}, 'email', 'US', 'customer', ${existing!.customer_id}, '绕过', 'awaiting_reply',
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
    // 与 worker 启动时一样：Fake 从示例数据夹具回放来信与我方回复，邮箱开始监听后送达；时钟在演示时刻，不平移
    t.clients.replayFixtures(getDemoFixture());
    await t.runJobs();
    // worker 每分钟的时限扫描（客户未回复的那张 7 天前就该关了）
    await t.enqueue(ticketTimeLimitsJob, {});
    await t.runJobs();
  });

  afterAll(async () => {
    await t.close();
  });

  it('示例工单的来信都归并成工单，一张示例工单一张，状态与原型一致（按订单归并的核对见 order-merge）', async () => {
    const fixture = getDemoFixture();
    const tickets = await ticketList(await t.loginAs('客服主管'));
    const customers = new Set(fixture.tickets.map((ticket) => ticket.customer));
    // Priya Raman 在 forcome.com 有两张示例工单（#1057、#1049 两笔订单），按订单归并成两张（14）
    expect(tickets).toHaveLength(fixture.tickets.length);
    expect(new Set(tickets.map((ticket) => ticket.customer.name))).toEqual(customers);
    // 等客户的示例工单回放了我方回复（16）；「客户未回复」关闭的那张按时关闭；已解决的两张要「标记无需回复」，随 17
    const expected = {
      待回复: 'awaiting_reply',
      等客户: 'awaiting_customer',
      已解决: 'awaiting_reply',
      已关闭: 'closed',
    };
    const byOrderOrCustomer = (sample: (typeof fixture.tickets)[number]) =>
      tickets.find(
        (ticket) =>
          ticket.customer.name === sample.customer &&
          (sample.order === null || ticket.orderNumber === sample.order),
      )!;
    for (const sample of fixture.tickets) {
      expect([sample.no, byOrderOrCustomer(sample).status]).toEqual([
        sample.no,
        expected[sample.status],
      ]);
    }
    expect(byOrderOrCustomer(fixture.tickets.find((x) => x.status === '已关闭')!).closeReason).toBe(
      'customer_no_reply',
    );

    const james = tickets.find((ticket) => ticket.customer.name === 'James Walker')!;
    // 当日序号按归并先后发放，几个邮箱的同步谁先跑不确定，这里只核对日期
    expect(james.number).toMatch(/^T-20260910-\d{4}$/);
    expect(james).toMatchObject({
      subject: 'Box arrived crushed, the vacuum is cracked',
      store: { name: 'Forcome Auto' },
      lastInboundAt: '2026-09-10T00:15:00.000Z',
    });
  });

  it('回放的来信按新口径识别（待办 10）：每位客户工单的渠道、站点、来源都与原型一致', async () => {
    const CHANNEL = { 亚马逊: 'amazon', Shopify: 'shopify', 邮件: 'email' } as const;
    const SOURCE = { 客户: 'customer', 生产厂: 'producer', 其他供应商: 'other_supplier' } as const;
    const tickets = await ticketList(await t.loginAs('客服主管'));
    const recognized = (customer: string) => {
      const ticket = tickets.find((tk) => tk.customer.name === customer)!;
      return { channel: ticket.channel, site: ticket.site, source: ticket.source };
    };
    for (const sample of getDemoFixture().tickets) {
      expect(recognized(sample.customer), sample.no).toEqual({
        channel: CHANNEL[sample.channel],
        site: sample.site,
        source: SOURCE[sample.source],
      });
    }
    // 几张典型的：亚马逊按中转域定站点（MX、CA）；Shopify 联系表单的客户取回复邮箱；已登记生产厂邮箱标「生产厂」
    expect(recognized('Mateo Rivas')).toEqual({
      channel: 'amazon',
      site: 'MX',
      source: 'customer',
    });
    expect(recognized('Oliver Grant')).toEqual({
      channel: 'amazon',
      site: 'CA',
      source: 'customer',
    });
    expect(recognized('Valeria Ríos')).toEqual({
      channel: 'shopify',
      site: 'MX',
      source: 'customer',
    });
    expect(recognized('FQD 品质部')).toEqual({ channel: 'email', site: 'US', source: 'producer' });
  });

  it('P05 时间线那张工单（Oliver Grant）按时间线回放三封来信与两封我方回复，编号日期取首封来信，首次回复与原型一致', async () => {
    const agent = await t.loginAs('坐席');
    const oliver = (await ticketList(agent)).find(
      (ticket) => ticket.customer.name === 'Oliver Grant',
    )!;
    expect(oliver.number).toBe('T-20260904-0001');
    const detail = await ticketDetail(agent, oliver.number);
    expect(detail.messages.map((m) => [m.direction, m.mailbox, m.arrivedAt])).toEqual([
      ['inbound', DIRECT.mailbox, '2026-09-04T02:12:00.000Z'],
      ['outbound', DIRECT.mailbox, '2026-09-04T02:40:00.000Z'],
      ['inbound', DIRECT.mailbox, '2026-09-05T00:58:00.000Z'],
      ['outbound', DIRECT.mailbox, '2026-09-05T07:30:00.000Z'],
      ['inbound', DIRECT.mailbox, '2026-09-10T01:00:00.000Z'],
    ]);
    // 原型 P1_OLIVER 的 SLA：首次回复 28m、6h 32m，都达标（第三封「无需回复」随 17）
    expect(
      detail.messages
        .filter((m) => m.direction === 'inbound')
        .slice(0, 2)
        .map((m) => [m.firstReplyAt, m.sla?.result]),
    ).toEqual([
      ['2026-09-04T02:40:00.000Z', 'met'],
      ['2026-09-05T07:30:00.000Z', 'met'],
    ]);
  });

  it('生产厂工单的来信 1 分钟后有一封自动回复（I18）：进全程记录、标「自动回复」，工单仍是待回复', async () => {
    const agent = await t.loginAs('坐席');
    const fqd = (await ticketList(agent)).find((ticket) => ticket.customer.name === 'FQD 品质部')!;
    expect(fqd.status).toBe('awaiting_reply');
    const detail = await ticketDetail(agent, fqd.number);
    expect(detail.messages.map((m) => [m.direction, m.autoReply, m.sla])).toEqual([
      ['inbound', false, null],
      ['outbound', true, null],
    ]);
  });

  it('worker 重启后再回放同样的来信，不会重复入库或新建工单', async () => {
    const before = await ticketList(await t.loginAs('客服主管'));
    t.resetFakes();
    t.clients.replayFixtures(getDemoFixture());
    // 已有游标的邮箱不再 watch，回放的信等续订 watch（09）时才送达；这里模拟续订后同步一次
    const gmail = t.clients.fake(gmailClient);
    for (const store of stores) await gmail.client().watch(store.mailbox);
    await t.runJobs();
    expect(await ticketList(await t.loginAs('客服主管'))).toEqual(before);
  });
});

describe('示例邮件回放到当前日期（开发测试环境与 Playwright 用真实时钟，待办 16）', () => {
  let t: TestHarness;
  /** 演示时刻（2026-09-11 10:20）之后 26 天 5 小时：平移 26 天，演示时刻落在现在之前 5 小时 */
  const NOW = '2026-10-07T15:20:00+08:00';

  beforeAll(async () => {
    t = await startTestHarness({ now: NOW });
    await t.loadFixtures();
    t.clients.replayFixtures(getDemoFixture());
    await t.runJobs();
    await t.enqueue(ticketTimeLimitsJob, {});
    await t.runJobs();
  });

  afterAll(async () => {
    await t.close();
  });

  it('来信与回复按整天平移（时分不变），工单编号日期跟着平移；状态与演示时刻一样，没有一上来就按 7 天、14 天关闭', async () => {
    const tickets = await ticketList(await t.loginAs('坐席'));
    const james = tickets.find((ticket) => ticket.customer.name === 'James Walker')!;
    expect(james.number).toMatch(/^T-20261006-\d{4}$/);
    expect(james).toMatchObject({
      status: 'awaiting_reply',
      lastInboundAt: '2026-10-06T00:15:00.000Z',
    });
    const statuses = tickets.reduce<Record<string, number>>((count, ticket) => {
      count[ticket.status] = (count[ticket.status] ?? 0) + 1;
      return count;
    }, {});
    // 与演示时刻相同：7 张待回复 + 2 张已解决（随 17，现为待回复）、6 张等客户、1 张客户未回复关闭
    expect(statuses).toEqual({ awaiting_reply: 9, awaiting_customer: 6, closed: 1 });
  });
});
