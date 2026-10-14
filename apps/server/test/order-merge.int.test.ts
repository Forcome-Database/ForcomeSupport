import {
  amazonDomains,
  SHOPIFY_CONTACT_FORM_SENDER,
  ticketDetailSchema,
  ticketListSchema,
  type TicketDetail,
  type TicketListItem,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inboundReceivedJob } from '../src/modules/channel';
import {
  amazonOrdersClient,
  gmailClient,
  shopifyClient,
  type FakeAmazonOrders,
  type FakeGmail,
  type FakeMailInput,
  type FakeShopify,
} from '../src/modules/integration';
import { ticketTimeLimitsJob } from '../src/modules/ticket';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 订单关联与按订单归并（待办 14；规格「收取与归并」故事 30–33、ticket「归并」，PRD R-TK-01、R-TK-02、R-ST-02、6.1 第一阶段迁移表，
 * 验收 AC-TK-01–04）：Fake Gmail 放来信、Fake SP-API / Fake Shopify 放订单 → 跑完任务（入库、抽订单号、在该店铺内校验与补拉、
 * 加锁归并）→ 以坐席身份调 P04 / 工单详情接口断言。
 * 订单都只放在 Fake 平台上、不先同步进镜像：归并时镜像没有，按订单号 / 订单名补拉（order 的 findOrder）。
 */

const stores = getDemoFixture().stores;
/** 亚马逊店铺（只有 US 站） */
const AUTO = stores.find((s) => s.name === 'Forcome Auto')!;
/** Shopify 店铺（站点 US、CA，默认 US） */
const COM = stores.find((s) => s.name === 'forcome.com')!;

const RELAY_US = amazonDomains.US.relay;

/** 亚马逊买家消息（经中转地址发到店铺邮箱） */
function amazonLetter(
  buyer: string,
  overrides: Partial<FakeMailInput> & { at: string },
): FakeMailInput {
  return {
    to: AUTO.mailbox,
    from: { name: buyer, address: `${buyer.toLowerCase().replace(/\W+/g, '.')}@${RELAY_US}` },
    subject: 'Question about my order',
    text: 'Hello',
    ...overrides,
  };
}

/** Shopify 联系表单通知（mailer@shopify.com 代发，Reply-To 是客户填的邮箱） */
function contactForm(
  customer: { name: string; address: string },
  body: string,
  at: string,
  subject = 'New customer message on forcome.com',
): FakeMailInput {
  return {
    to: COM.mailbox,
    from: { name: 'forcome.com', address: SHOPIFY_CONTACT_FORM_SENDER },
    headers: { 'Reply-To': customer.address },
    subject,
    text: [
      "You received a new message from your online store's contact form.",
      'Country Code: US',
      `Name: ${customer.name}`,
      `Email: ${customer.address}`,
      'Phone Number:',
      'Body:',
      body,
    ].join('\n'),
    at,
  };
}

/**
 * 全部工单：本文件的来信从 7 月起，超出 P04 默认的「最近来信近 30 天」，按最近来信不限日期取、逐页取完（待办 18 起接口分页）
 */
async function ticketList(client: ApiClient): Promise<TicketListItem[]> {
  const tickets: TicketListItem[] = [];
  for (let page = 1; ; page += 1) {
    const res = await client.get(
      `/api/tickets?inbound=custom&from=2000-01-01&to=2099-12-31&page=${page}`,
    );
    expect(res.status).toBe(200);
    const list = ticketListSchema.parse(await res.json());
    tickets.push(...list.tickets);
    if (page * list.pageSize >= list.total) return tickets;
  }
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

/**
 * 把工单关在某个时刻（测试的准备步骤）：把时钟拨到那一刻跑一次每分钟的时限扫描（待回复 14 天无新来信 → 已关闭，待办 16），
 * 关闭时刻就是扫描时的「当前时间」；扫完拨回原来的时刻（会话按 7 天无操作过期，时钟不留在过去）。
 * 扫描影响库里全部工单：给的时刻要满足「这张工单最近来信 + 14 天 ≤ 关闭时刻」，且不会顺带关掉别的用例还要用的工单
 */
async function closeTicket(t: TestHarness, number: string, closedAt: string): Promise<void> {
  const before = t.clock.now();
  t.clock.set(closedAt);
  try {
    await t.enqueue(ticketTimeLimitsJob, {});
    await t.runJobs();
  } finally {
    t.clock.set(before);
  }
  const { rows } = await t.runtime.db.execute<{ status: string }>(
    sql`SELECT status FROM ticket.ticket WHERE number = ${number}`,
  );
  expect(rows).toEqual([{ status: 'closed' }]);
}

/** 工单的状态变更记录（事件、目标状态），按先后 */
async function statusChanges(t: TestHarness, number: string) {
  const { rows } = await t.runtime.db.execute<{ event: string; to_status: string }>(sql`
    SELECT c.event, c.to_status FROM ticket.status_change c JOIN ticket.ticket k ON k.id = c.ticket_id
     WHERE k.number = ${number} ORDER BY c.id`);
  return rows.map((r) => [r.event, r.to_status]);
}

describe('按订单归并（R-TK-01）', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let amazon: FakeAmazonOrders;
  let shopify: FakeShopify;
  let agent: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    amazon = t.clients.fake(amazonOrdersClient);
    shopify = t.clients.fake(shopifyClient);
    // 邮箱开始监听（之后到达的来信才同步进来）
    await t.runJobs();
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  const placed = (orderId: string, at = '2026-09-01T10:00:00+08:00') =>
    amazon.put(AUTO.id, { orderId, updatedAt: new Date(at), createdAt: new Date(at) });

  it('从正文抽出亚马逊订单号，在该店铺校验（镜像没有，按订单号补拉）后关联：P04 显示订单号', async () => {
    placed('113-1000001-0000001');
    gmail.deliver(
      amazonLetter('Noah Hill', {
        text: 'The vacuum stopped working.\n\nOrder ID: 113-1000001-0000001',
        at: '2026-09-10T08:00:00+08:00',
      }),
    );
    await t.runJobs();

    expect(await ticketsOf(agent, 'Noah Hill')).toEqual([
      expect.objectContaining({ orderNumber: '113-1000001-0000001', status: 'awaiting_reply' }),
    ]);
    // 补拉的订单已进镜像
    expect(await t.findOrder(AUTO.id, { platformOrderId: '113-1000001-0000001' })).not.toBeNull();
  });

  it('AC-TK-01：同一订单已有未关闭工单，客户再来一封信 → 追加到原工单，不新建（第一期不计重复联系）', async () => {
    placed('113-1000002-0000002');
    gmail.deliver(
      amazonLetter('Ava Price', {
        subject: 'Missing parts (Order: 113-1000002-0000002)',
        at: '2026-09-09T09:00:00+08:00',
      }),
    );
    await t.runJobs();
    gmail.deliver(
      amazonLetter('Ava Price', {
        subject: 'Re: Missing parts',
        text: 'Still waiting. Order 113-1000002-0000002',
        at: '2026-09-10T09:30:00+08:00',
      }),
    );
    await t.runJobs();

    const tickets = await ticketsOf(agent, 'Ava Price');
    expect(tickets).toEqual([
      expect.objectContaining({
        number: 'T-20260909-0001',
        orderNumber: '113-1000002-0000002',
        status: 'awaiting_reply',
        lastInboundAt: '2026-09-10T01:30:00.000Z',
      }),
    ]);
    expect((await ticketDetail(agent, tickets[0]!.number)).messages).toHaveLength(2);
    // 追加不产生状态变更（待回复保持待回复）
    expect(await statusChanges(t, tickets[0]!.number)).toEqual([['inbound', 'awaiting_reply']]);
  });

  it('同一订单的来信不论谁写（生产厂先来信建单、客户再来信）都归到一张工单；工单来源仍取首封来信（生产厂），追加不改', async () => {
    placed('113-1000003-0000003');
    gmail.deliver({
      to: AUTO.mailbox,
      from: { name: 'FQD 品质部', address: 'qc@fqd-forcome.com' },
      subject: '订单 113-1000003-0000003 批次抽检',
      text: '该订单所用电池批次抽检报告见附件。',
      at: '2026-09-08T10:00:00+08:00',
    });
    await t.runJobs();
    gmail.deliver(
      amazonLetter('Leo Grant', {
        text: 'Battery swollen. Order: 113-1000003-0000003',
        at: '2026-09-08T12:00:00+08:00',
      }),
    );
    await t.runJobs();

    const all = await ticketList(agent);
    const forOrder = all.filter((ticket) => ticket.orderNumber === '113-1000003-0000003');
    expect(forOrder).toEqual([
      expect.objectContaining({ source: 'producer', customer: { name: 'FQD 品质部' } }),
    ]);
    const detail = await ticketDetail(agent, forOrder[0]!.number);
    expect(detail.messages.map((m) => [m.from.name, m.source])).toEqual([
      ['FQD 品质部', 'producer'],
      ['Leo Grant', 'customer'],
    ]);
    expect(await ticketsOf(agent, 'Leo Grant')).toEqual([]);
  });

  it('AC-TK-02：同一客户两笔不同订单，两封信分别提到两笔订单 → 生成两张工单', async () => {
    placed('113-1000004-0000004');
    placed('113-1000005-0000005');
    gmail.deliver(
      amazonLetter('Mia Brooks', {
        text: 'Order 113-1000004-0000004 arrived broken',
        at: '2026-09-10T10:00:00+08:00',
      }),
    );
    gmail.deliver(
      amazonLetter('Mia Brooks', {
        text: 'Order 113-1000005-0000005 never arrived',
        at: '2026-09-10T10:05:00+08:00',
      }),
    );
    await t.runJobs();

    const tickets = await ticketsOf(agent, 'Mia Brooks');
    expect(tickets.map((ticket) => ticket.orderNumber).sort()).toEqual([
      '113-1000004-0000004',
      '113-1000005-0000005',
    ]);
  });

  it('AC-TK-03（第一期改写）：工单关闭 20 天，同一订单来信 → 原工单重开为待回复，关闭原因清空，记一条重开的状态变更', async () => {
    placed('113-1000006-0000006', '2026-07-20T10:00:00+08:00');
    gmail.deliver(
      amazonLetter('Zoe Adams', {
        text: 'Order 113-1000006-0000006: wrong color',
        at: '2026-08-01T10:00:00+08:00',
      }),
    );
    await t.runJobs();
    const [ticket] = await ticketsOf(agent, 'Zoe Adams');
    await closeTicket(t, ticket!.number, '2026-08-21T10:00:00+08:00');
    expect((await ticketsOf(agent, 'Zoe Adams'))[0]!.status).toBe('closed');

    gmail.deliver(
      amazonLetter('Zoe Adams', {
        text: 'Order 113-1000006-0000006 — the replacement is wrong too',
        at: '2026-09-10T10:00:00+08:00',
      }),
    );
    await t.runJobs();

    expect(await ticketsOf(agent, 'Zoe Adams')).toEqual([
      expect.objectContaining({
        number: ticket!.number,
        orderNumber: '113-1000006-0000006',
        status: 'awaiting_reply',
        lastInboundAt: '2026-09-10T02:00:00.000Z',
      }),
    ]);
    expect((await ticketDetail(agent, ticket!.number)).messages).toHaveLength(2);
    expect(await statusChanges(t, ticket!.number)).toEqual([
      ['inbound', 'awaiting_reply'],
      ['idle_14_days', 'closed'],
      ['inbound_reopen', 'awaiting_reply'],
    ]);
    const { rows } = await t.runtime.db.execute<{ close_reason: string | null }>(
      sql`SELECT close_reason FROM ticket.ticket WHERE number = ${ticket!.number}`,
    );
    expect(rows).toEqual([{ close_reason: null }]);
  });

  it('「30 天内」按北京时间的日期算：关闭日之后第 30 天的晚上来信仍重开（已超过 30 × 24 小时）', async () => {
    placed('113-1000007-0000007', '2026-07-01T10:00:00+08:00');
    gmail.deliver(
      amazonLetter('Ella Ward', {
        text: 'Order 113-1000007-0000007',
        at: '2026-07-20T10:00:00+08:00',
      }),
    );
    await t.runJobs();
    const [ticket] = await ticketsOf(agent, 'Ella Ward');
    await closeTicket(t, ticket!.number, '2026-08-11T10:00:00+08:00');
    gmail.deliver(
      amazonLetter('Ella Ward', {
        text: 'Order 113-1000007-0000007 again',
        at: '2026-09-10T23:30:00+08:00',
      }),
    );
    await t.runJobs();

    expect(await ticketsOf(agent, 'Ella Ward')).toEqual([
      expect.objectContaining({ number: ticket!.number, status: 'awaiting_reply' }),
    ]);
  });

  it('关闭日之后第 31 天（北京时间刚过零点，离关闭只多 20 分钟就满 30 × 24 小时）来信：新建工单', async () => {
    placed('113-1000014-0000014', '2026-07-01T10:00:00+08:00');
    gmail.deliver(
      amazonLetter('Hugo Lane', {
        text: 'Order 113-1000014-0000014',
        at: '2026-07-20T10:00:00+08:00',
      }),
    );
    await t.runJobs();
    const [old] = await ticketsOf(agent, 'Hugo Lane');
    await closeTicket(t, old!.number, '2026-08-11T23:50:00+08:00');
    gmail.deliver(
      amazonLetter('Hugo Lane', {
        text: 'Order 113-1000014-0000014 again',
        at: '2026-09-11T00:10:00+08:00',
      }),
    );
    await t.runJobs();

    expect(
      (await ticketsOf(agent, 'Hugo Lane')).map((ticket) => [
        ticket.number === old!.number,
        ticket.status,
      ]),
    ).toEqual([
      [false, 'awaiting_reply'],
      [true, 'closed'],
    ]);
  });

  it('AC-TK-04：工单关闭 40 天，同一订单来信 → 新建工单，原工单仍是已关闭', async () => {
    placed('113-1000008-0000008', '2026-07-01T10:00:00+08:00');
    gmail.deliver(
      amazonLetter('Owen Reed', {
        text: 'Order 113-1000008-0000008 is late',
        at: '2026-07-15T10:00:00+08:00',
      }),
    );
    await t.runJobs();
    const [old] = await ticketsOf(agent, 'Owen Reed');
    await closeTicket(t, old!.number, '2026-08-01T10:00:00+08:00');
    gmail.deliver(
      amazonLetter('Owen Reed', {
        text: 'Order 113-1000008-0000008 broke after a month',
        at: '2026-09-10T10:00:00+08:00',
      }),
    );
    await t.runJobs();

    const tickets = await ticketsOf(agent, 'Owen Reed');
    expect(tickets.map((ticket) => [ticket.number, ticket.status, ticket.orderNumber])).toEqual([
      [
        expect.stringMatching(/^T-20260910-\d{4}$/) as string,
        'awaiting_reply',
        '113-1000008-0000008',
      ],
      [old!.number, 'closed', '113-1000008-0000008'],
    ]);
  });

  it('同一订单既有超过 30 天关闭的旧工单、又有 30 天内关闭的工单：重开 30 天内关闭的那张', async () => {
    placed('113-1000009-0000009', '2026-06-01T10:00:00+08:00');
    gmail.deliver(
      amazonLetter('Ivy Cole', {
        text: 'Order 113-1000009-0000009',
        at: '2026-06-10T10:00:00+08:00',
      }),
    );
    await t.runJobs();
    const [first] = await ticketsOf(agent, 'Ivy Cole');
    await closeTicket(t, first!.number, '2026-07-01T10:00:00+08:00');
    gmail.deliver(
      amazonLetter('Ivy Cole', {
        text: 'Order 113-1000009-0000009 again',
        at: '2026-08-10T10:00:00+08:00',
      }),
    );
    await t.runJobs();
    const second = (await ticketsOf(agent, 'Ivy Cole')).find((tk) => tk.number !== first!.number)!;
    await closeTicket(t, second.number, '2026-09-01T10:00:00+08:00');

    gmail.deliver(
      amazonLetter('Ivy Cole', {
        text: 'Order 113-1000009-0000009 third time',
        at: '2026-09-10T10:00:00+08:00',
      }),
    );
    await t.runJobs();

    const tickets = await ticketsOf(agent, 'Ivy Cole');
    expect(tickets.map((tk) => [tk.number, tk.status])).toEqual([
      [second.number, 'awaiting_reply'],
      [first!.number, 'closed'],
    ]);
  });

  it('同一客户写没有订单号的信：按客户维度归并（R-TK-02），不追加到她的订单工单', async () => {
    placed('113-1000010-0000010');
    gmail.deliver(
      amazonLetter('Ruby Fox', {
        text: 'Order 113-1000010-0000010',
        at: '2026-09-10T11:00:00+08:00',
      }),
    );
    gmail.deliver(
      amazonLetter('Ruby Fox', {
        subject: 'Do you sell filters?',
        text: 'Where can I buy spare filters?',
        at: '2026-09-10T11:10:00+08:00',
      }),
    );
    await t.runJobs();

    expect((await ticketsOf(agent, 'Ruby Fox')).map((ticket) => ticket.orderNumber).sort()).toEqual(
      ['113-1000010-0000010', null],
    );
  });

  it('抽到的亚马逊订单号在该店铺查不到（镜像没有、补拉也没有）：按抽不到订单号处理，按客户维度归并，工单不记这个号（协调者 2026-10-07 决定）', async () => {
    gmail.deliver(
      amazonLetter('Finn Shaw', {
        text: 'My order 113-9999999-0000000 is wrong',
        at: '2026-09-10T12:00:00+08:00',
      }),
    );
    gmail.deliver(
      amazonLetter('Finn Shaw', {
        subject: 'Re: Question about my order',
        text: 'Any update?',
        at: '2026-09-10T13:00:00+08:00',
      }),
    );
    await t.runJobs();

    expect(await ticketsOf(agent, 'Finn Shaw')).toEqual([
      expect.objectContaining({ orderNumber: null }),
    ]);
    expect(
      amazon.faultsOf(AUTO.id).calls.filter((call) => call === 'getOrder').length,
    ).toBeGreaterThan(0);
  });

  it('一封信里有几个候选订单号：第一个查不到时用下一个查得到的', async () => {
    placed('113-1000011-0000011');
    gmail.deliver(
      amazonLetter('Gus Hale', {
        text: 'Not 113-8888888-0000000 but 113-1000011-0000011',
        at: '2026-09-10T13:30:00+08:00',
      }),
    );
    await t.runJobs();

    expect(await ticketsOf(agent, 'Gus Hale')).toEqual([
      expect.objectContaining({ orderNumber: '113-1000011-0000011' }),
    ]);
  });

  describe('Shopify', () => {
    const LILY = { name: 'Lily Moore', address: 'lily.moore@example.com' };
    const SAM = { name: 'Sam Ortiz', address: 'sam.ortiz@example.com' };
    const KAI = { name: 'Kai Young', address: 'kai.young@example.com' };
    const NORA = { name: 'Nora Diaz', address: 'nora.diaz@example.com' };
    const ADA = { name: 'Ada Lane', address: 'ada.lane@example.com' };

    const shopifyOrder = (
      name: string,
      email: string,
      country = 'US',
      at = '2026-09-01T10:00:00+08:00',
    ) =>
      shopify.put(COM.id, {
        name,
        email,
        updatedAt: new Date(at),
        createdAt: new Date(at),
        shippingAddress: {
          name: null,
          address1: null,
          address2: null,
          city: null,
          province: null,
          zip: null,
          country,
          phone: null,
        },
      });

    it('按订单名（#2001、order 2001）在该店铺内匹配，镜像没有时按订单名补拉', async () => {
      shopifyOrder('#2001', LILY.address);
      gmail.deliver(contactForm(LILY, 'Where is order 2001?', '2026-09-10T14:00:00+08:00'));
      await t.runJobs();

      expect(await ticketsOf(agent, 'Lily Moore')).toEqual([
        expect.objectContaining({ orderNumber: '#2001', channel: 'shopify', site: 'US' }),
      ]);
    });

    it('Shopify 工单按订单收件国家定站点：收件国家为 CA 时工单站点为 CA（R-ST-02）', async () => {
      shopifyOrder('#2002', SAM.address, 'CA');
      gmail.deliver(
        contactForm(SAM, 'My order #2002 arrived damaged', '2026-09-10T14:10:00+08:00'),
      );
      await t.runJobs();

      expect(await ticketsOf(agent, 'Sam Ortiz')).toEqual([
        expect.objectContaining({ orderNumber: '#2002', site: 'CA' }),
      ]);
    });

    it('收件国家不是 US / CA / MX 时取店铺默认站点', async () => {
      shopifyOrder('#2003', ADA.address, 'GB');
      gmail.deliver(contactForm(ADA, 'Order #2003', '2026-09-10T14:15:00+08:00'));
      await t.runJobs();

      expect(await ticketsOf(agent, 'Ada Lane')).toEqual([
        expect.objectContaining({ orderNumber: '#2003', site: 'US' }),
      ]);
    });

    it('来信没有订单号：按客户邮箱在该店铺反查，唯一命中才关联（站点同样按收件国家）', async () => {
      shopifyOrder('#2004', KAI.address, 'CA');
      // 先同步进镜像：反查只查镜像
      await t.findOrder(COM.id, { name: '#2004' });
      gmail.deliver(contactForm(KAI, 'The suction is weak', '2026-09-10T14:20:00+08:00'));
      await t.runJobs();

      expect(await ticketsOf(agent, 'Kai Young')).toEqual([
        expect.objectContaining({ orderNumber: '#2004', site: 'CA' }),
      ]);
    });

    it('邮箱反查命中多笔时不关联订单：按客户维度归并（R-TK-02），站点取店铺默认站点', async () => {
      shopifyOrder('#2005', NORA.address, 'CA');
      shopifyOrder('#2006', NORA.address, 'CA', '2026-09-02T10:00:00+08:00');
      await t.findOrder(COM.id, { name: '#2005' });
      await t.findOrder(COM.id, { name: '#2006' });
      gmail.deliver(contactForm(NORA, 'Do you ship to Canada?', '2026-09-10T14:30:00+08:00'));
      gmail.deliver(contactForm(NORA, 'Hello again', '2026-09-10T14:40:00+08:00'));
      await t.runJobs();

      expect(await ticketsOf(agent, 'Nora Diaz')).toEqual([
        expect.objectContaining({ orderNumber: null, site: 'US' }),
      ]);
      const [ticket] = await ticketsOf(agent, 'Nora Diaz');
      expect((await ticketDetail(agent, ticket!.number)).messages).toHaveLength(2);
    });

    it('邮箱反查零笔：按客户维度归并', async () => {
      const nobody = { name: 'Uma Webb', address: 'uma.webb@example.com' };
      gmail.deliver(contactForm(nobody, 'Pre-sales question', '2026-09-10T14:50:00+08:00'));
      await t.runJobs();

      expect(await ticketsOf(agent, 'Uma Webb')).toEqual([
        expect.objectContaining({ orderNumber: null, site: 'US' }),
      ]);
    });

    it('抽到的订单名在该店铺查不到：按抽不到订单号处理，再按客户邮箱反查，唯一命中关联那一笔（协调者 2026-10-07 决定）', async () => {
      const wes = { name: 'Wes Hart', address: 'wes.hart@example.com' };
      shopifyOrder('#2007', wes.address);
      await t.findOrder(COM.id, { name: '#2007' });
      gmail.deliver(contactForm(wes, 'About order #9999', '2026-09-10T15:00:00+08:00'));
      await t.runJobs();

      expect(await ticketsOf(agent, 'Wes Hart')).toEqual([
        expect.objectContaining({ orderNumber: '#2007' }),
      ]);
    });

    it('别家店铺的订单不关联：订单只在本店铺内匹配（R-ST-03）', async () => {
      const mx = stores.find((s) => s.name === 'forcome.mx')!;
      const zed = { name: 'Zed Park', address: 'zed.park@example.com' };
      shopify.put(mx.id, { name: '#2008', email: zed.address, updatedAt: new Date('2026-09-01') });
      gmail.deliver(contactForm(zed, 'Order #2008', '2026-09-10T15:10:00+08:00'));
      await t.runJobs();

      expect(await ticketsOf(agent, 'Zed Park')).toEqual([
        expect.objectContaining({ orderNumber: null, store: { id: COM.id, name: 'forcome.com' } }),
      ]);
    });
  });

  it('订单平台暂时连不上：归并任务失败后重试，平台恢复后照常关联', async () => {
    placed('113-1000012-0000012');
    amazon.faultsOf(AUTO.id).failNext({ kind: 'error', status: 503 }, { operation: 'getOrder' });
    gmail.deliver(
      amazonLetter('Kit Lowe', {
        text: 'Order 113-1000012-0000012',
        at: '2026-09-10T16:00:00+08:00',
      }),
    );
    const first = await t.runJobs({ allowFailures: true });
    expect(first.failed.map((job) => job.name)).toEqual([inboundReceivedJob.name]);
    expect(await ticketsOf(agent, 'Kit Lowe')).toEqual([]);

    await t.runJobs();
    expect(await ticketsOf(agent, 'Kit Lowe')).toEqual([
      expect.objectContaining({ orderNumber: '113-1000012-0000012' }),
    ]);
  });

  it('订单平台一直连不上：最后一次重试不再等，不关联订单照常建单（来信不丢、SLA 照常计时）', async () => {
    placed('113-1000013-0000013');
    amazon
      .faultsOf(AUTO.id)
      .failNext({ kind: 'error', status: 503 }, { operation: 'getOrder', times: 100 });
    gmail.deliver(
      amazonLetter('Rex Dunn', {
        text: 'Order 113-1000013-0000013',
        at: '2026-09-10T16:30:00+08:00',
      }),
    );
    // 来信已接收的归并任务重试 retryLimit 次：前面的尝试都失败，最后一次不关联订单建单
    const retries = inboundReceivedJob.queue?.retryLimit ?? 0;
    expect(retries).toBeGreaterThan(0);
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const report = await t.runJobs({ allowFailures: true });
      expect(
        report.failed.map((job) => job.name),
        `第 ${attempt} 次`,
      ).toEqual([inboundReceivedJob.name]);
    }
    await t.runJobs();

    expect(await ticketsOf(agent, 'Rex Dunn')).toEqual([
      expect.objectContaining({ orderNumber: null }),
    ]);
    amazon.faultsOf(AUTO.id).reset();
  });
});

describe('并发归并（规格「需要覆盖的场景·并发」）', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    await t.runJobs();
  });

  afterAll(async () => {
    await t.close();
  });

  it('同一订单两封来信（两位不同的发件人）并发归并只产生一张工单（按「店铺 + 订单号」加锁后再查再写）', async () => {
    t.clients.fake(amazonOrdersClient).put(AUTO.id, {
      orderId: '113-2000001-0000001',
      updatedAt: new Date('2026-09-01T10:00:00+08:00'),
    });
    const gmail = t.clients.fake(gmailClient);
    gmail.deliver(
      amazonLetter('Tess Lamb', {
        text: 'Order 113-2000001-0000001',
        at: '2026-09-10T10:00:00+08:00',
      }),
    );
    gmail.deliver({
      to: AUTO.mailbox,
      from: { name: 'Tess Lamb (work)', address: 'tess.lamb@work.example.com' },
      subject: 'Order 113-2000001-0000001',
      text: 'Writing from my work email about the same order.',
      at: '2026-09-10T10:01:00+08:00',
    });
    const report = await t.runJobs({ concurrently: true });
    expect(report.completed.filter((job) => job.name === inboundReceivedJob.name)).toHaveLength(2);

    const agent = await t.loginAs('坐席');
    const tickets = (await ticketList(agent)).filter(
      (ticket) => ticket.orderNumber === '113-2000001-0000001',
    );
    expect(tickets).toHaveLength(1);
    expect((await ticketDetail(agent, tickets[0]!.number)).messages).toHaveLength(2);
  });
});

describe('示例来信回放按订单归并', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    // 与 worker 启动时一样：Fake Gmail、Fake SP-API、Fake Shopify 都从示例数据夹具回放
    const fixture = getDemoFixture();
    t.clients.replayFixtures(fixture);
    // 开发测试环境灌完数据即开始回补，来信归并时 Shopify 订单可能已在镜像里：先全读进来，邮箱反查按最坏的情形核对
    for (const order of fixture.shopifyOrders) {
      const store = stores.find((s) => s.key === order.storeKey)!;
      expect(await t.findOrder(store.id, { name: order.name })).not.toBeNull();
    }
    await t.runJobs();
  });

  afterAll(async () => {
    await t.close();
  });

  it('每张示例工单一张工单，订单号与原型 P04 一致（Priya Raman 的 #1057、#1049 分成两张；Emily Chen 的 #0991 是另一个邮箱下的单，反查零笔、不关联）', async () => {
    const tickets = await ticketList(await t.loginAs('客服主管'));
    const fixture = getDemoFixture();
    expect(tickets).toHaveLength(fixture.tickets.length);
    const actual = tickets.map((ticket) => [ticket.customer.name, ticket.orderNumber]).sort();
    const expected = fixture.tickets.map((sample) => [sample.customer, sample.order]).sort();
    expect(actual).toEqual(expected);
  });
});
