import {
  ticketDetailSchema,
  ticketListSchema,
  type TicketDetail,
  type TicketListItem,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gmailClient, type FakeGmail, type FakeMailInput } from '../src/modules/integration';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 来源识别与亚马逊站点（待办 10；规格 channel「渠道识别」「来源识别」「店铺与站点识别」，PRD R-TK-08、R-ST-02、1.4「来源」，
 * AC-P1-04、AC-P1-05、AC-TK-14）。主接缝：Fake Gmail 放信 → 跑完任务 → 以坐席身份调 P04 与工单详情接口。
 * 来源规则用系统实际灌入的：迁移 0009 的种子（平台通知、营销）与示例数据的生产厂邮箱（加载步骤 channel.sender_rules）。
 */

const stores = getDemoFixture().stores;
const DIRECT = stores.find((s) => s.name === 'Forcome Direct')!;
const AUTO = stores.find((s) => s.name === 'Forcome Auto')!;
const SHOP_COM = stores.find((s) => s.name === 'forcome.com')!;
const SHOP_MX = stores.find((s) => s.name === 'forcome.mx')!;

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

/** Shopify 联系表单的通知：mailer@shopify.com 代发，Reply-To 是填表客户的邮箱，正文是表单各栏 */
function contactForm(
  to: string,
  customer: { name: string; address: string },
  body: string,
  at: string,
): FakeMailInput {
  return {
    to,
    from: { name: 'forcome.com', address: 'mailer@shopify.com' },
    headers: { 'Reply-To': customer.address },
    subject: `New customer message on ${at.slice(0, 10)}`,
    text: [
      "You received a new message from your online store's contact form.",
      `Name: ${customer.name}`,
      `Email: ${customer.address}`,
      'Body:',
      body,
    ].join('\n'),
    at,
  };
}

describe('来源识别与亚马逊站点', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let agent: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    // 示例店铺与示例生产厂邮箱（来源规则「生产厂」）
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    await t.runJobs();
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  /** 某位客户的工单 */
  async function ticketsOf(customer: string): Promise<TicketListItem[]> {
    return (await ticketList(agent)).filter((ticket) => ticket.customer.name === customer);
  }

  it('亚马逊平台通知邮件归档，不建工单（AC-P1-05）；同一批到的客户来信照常建工单', async () => {
    const notices: FakeMailInput[] = [
      {
        to: DIRECT.mailbox,
        from: { name: 'Amazon Seller Notification', address: 'seller-notification@amazon.com' },
        subject: 'Action required: verify your seller account information',
        text: 'Please review your account information in Seller Central.',
        at: '2026-09-10T09:00:00+08:00',
      },
      {
        to: DIRECT.mailbox,
        from: { name: 'Amazon.ca', address: 'donotreply@amazon.ca' },
        subject: 'Your settlement report is available',
        text: 'Your settlement report for the period is now available.',
        at: '2026-09-10T09:01:00+08:00',
      },
      {
        to: AUTO.mailbox,
        from: { name: 'Amazon.com.mx', address: 'no-reply@amazon.com.mx' },
        subject: 'Aviso de reembolso procesado',
        text: 'Se procesó un reembolso para el pedido 701-1234567-1234567.',
        at: '2026-09-10T09:02:00+08:00',
      },
      // Shopify 系统邮件（不是联系表单通知）同样归档
      {
        to: SHOP_COM.mailbox,
        from: { name: 'Shopify', address: 'no-reply@shopify.com' },
        subject: 'Your payout is on its way',
        text: 'A payout of $1,280.00 is on its way to your bank.',
        at: '2026-09-10T09:03:00+08:00',
      },
    ];
    for (const notice of notices) gmail.deliver(notice);
    gmail.deliver({
      to: DIRECT.mailbox,
      from: { name: 'Hannah Price', address: 'h.price.7m2q@marketplace.amazon.com' },
      subject: 'Where is my order?',
      text: 'My order has not arrived yet.',
      at: '2026-09-10T09:04:00+08:00',
    });
    await t.runJobs();

    const tickets = await ticketList(agent);
    expect(tickets.map((ticket) => ticket.customer.name)).toEqual(['Hannah Price']);
    expect(tickets.map((ticket) => ticket.subject)).not.toContain(notices[0]!.subject);
  });

  it('营销邮件归档，不建工单：带 List-Unsubscribe 头，或 Precedence 为 bulk', async () => {
    gmail.deliver({
      to: SHOP_COM.mailbox,
      from: { name: 'Vacuum Deals Weekly', address: 'news@vacuum-deals.example' },
      headers: { 'List-Unsubscribe': '<mailto:unsubscribe@vacuum-deals.example>' },
      subject: 'This week: 30% off cordless vacuums',
      text: 'Shop the sale now.',
      at: '2026-09-10T10:00:00+08:00',
    });
    gmail.deliver({
      to: SHOP_MX.mailbox,
      from: { name: 'Proveedor Promociones', address: 'promo@ofertas.example' },
      headers: { Precedence: 'bulk' },
      subject: 'Promociones de septiembre',
      text: 'Conozca nuestras promociones.',
      at: '2026-09-10T10:01:00+08:00',
    });
    await t.runJobs();

    expect(await ticketsOf('Vacuum Deals Weekly')).toEqual([]);
    expect(await ticketsOf('Proveedor Promociones')).toEqual([]);
  });

  it('已登记生产厂邮箱的来信建工单，来源标「生产厂」，状态待回复（AC-P1-04 的建单部分）', async () => {
    gmail.deliver({
      to: SHOP_COM.mailbox,
      from: { name: 'FQD 品质部', address: 'qc@fqd-forcome.com' },
      subject: '9 月电池批次抽检报告',
      text: '附件为 9 月电池批次抽检报告，请查收。',
      at: '2026-09-11T09:58:00+08:00',
    });
    await t.runJobs();

    const [ticket] = await ticketsOf('FQD 品质部');
    expect(ticket).toMatchObject({
      number: expect.stringMatching(/^T-20260911-\d{4}$/) as string,
      subject: '9 月电池批次抽检报告',
      source: 'producer',
      channel: 'email',
      site: 'US',
      store: { name: 'forcome.com' },
      status: 'awaiting_reply',
    });
    const detail = await ticketDetail(agent, ticket!.number);
    expect(detail.messages).toEqual([
      expect.objectContaining({
        from: { name: 'FQD 品质部', address: 'qc@fqd-forcome.com' },
        source: 'producer',
      }),
    ]);
  });

  it('同一生产厂的另一个登记邮箱、另一家生产厂的邮箱也标「生产厂」；同一个域下没登记的地址按客户', async () => {
    gmail.deliver({
      to: DIRECT.mailbox,
      from: { name: '陈工', address: 'chen.gong@fqd-forcome.com' },
      subject: 'HEPA 滤芯补货排期',
      text: '滤芯下周三可以发出。',
      at: '2026-09-11T08:30:00+08:00',
    });
    gmail.deliver({
      to: DIRECT.mailbox,
      from: { name: 'FZJ 客服', address: 'service@fzj-forcome.com' },
      subject: '充电线更换批次说明',
      text: '本批次充电线已更换供应商。',
      at: '2026-09-11T08:31:00+08:00',
    });
    gmail.deliver({
      to: DIRECT.mailbox,
      from: { name: 'FQD 销售', address: 'sales@fqd-forcome.com' },
      subject: '新品报价',
      text: '附上新品报价。',
      at: '2026-09-11T08:32:00+08:00',
    });
    await t.runJobs();

    expect((await ticketsOf('陈工')).map((ticket) => ticket.source)).toEqual(['producer']);
    expect((await ticketsOf('FZJ 客服')).map((ticket) => ticket.source)).toEqual(['producer']);
    expect((await ticketsOf('FQD 销售')).map((ticket) => ticket.source)).toEqual(['customer']);
  });

  it('amz-direct@forcome.com 收到发件域 amazon.com.mx 的买家来信 → Forcome Direct、站点 MX、渠道亚马逊（AC-TK-14）', async () => {
    expect(DIRECT.mailbox).toBe('amz-direct@forcome.com');
    gmail.deliver({
      to: DIRECT.mailbox,
      from: { name: 'Mateo Rivas', address: 'mateo.r.8k3p@marketplace.amazon.com.mx' },
      subject: 'El aspirador dejó de funcionar en menos de una semana',
      text: 'El aspirador dejó de funcionar. Pedido 302-8811234-9901122.',
      at: '2026-09-10T11:15:00+08:00',
    });
    await t.runJobs();

    expect(await ticketsOf('Mateo Rivas')).toEqual([
      expect.objectContaining({
        store: { id: DIRECT.id, name: 'Forcome Direct' },
        site: 'MX',
        channel: 'amazon',
        source: 'customer',
        status: 'awaiting_reply',
      }),
    ]);
  });

  it('亚马逊买家消息的中转域（marketplace.amazon.com / .ca）不会被平台通知规则归档：照常建工单，站点按域（协调者 10-05）', async () => {
    gmail.deliver({
      to: DIRECT.mailbox,
      from: { name: 'Oliver Grant', address: 'oliver.grant.2c9d@marketplace.amazon.ca' },
      subject: 'Charger cable not working',
      text: 'The charger cable does not charge the vacuum.',
      at: '2026-09-04T10:12:00+08:00',
    });
    gmail.deliver({
      to: AUTO.mailbox,
      from: { name: 'Marcus Lee', address: 'marcus.lee.5t1v@marketplace.amazon.com' },
      subject: 'Received the wrong color, ordered black',
      text: 'I ordered black but received white.',
      at: '2026-09-10T21:30:00+08:00',
    });
    await t.runJobs();

    expect(await ticketsOf('Oliver Grant')).toEqual([
      expect.objectContaining({ channel: 'amazon', site: 'CA', source: 'customer' }),
    ]);
    expect(await ticketsOf('Marcus Lee')).toEqual([
      expect.objectContaining({ channel: 'amazon', site: 'US', source: 'customer' }),
    ]);
  });

  it('Shopify 联系表单通知 → 渠道 Shopify，客户取表单的回复邮箱：同一客户再填一次表追加到原工单，不同客户各自建单（R-TK-08、R-TK-02）', async () => {
    const emily = { name: 'Emily Chen', address: 'emily.chen@example.com' };
    const ryan = { name: 'Ryan Ortiz', address: 'ryan.ortiz@example.com' };
    gmail.deliver(
      contactForm(
        SHOP_COM.mailbox,
        emily,
        'Does the V2 fit a Tesla Model Y 12V socket?',
        '2026-09-10T11:48:00+08:00',
      ),
    );
    gmail.deliver(
      contactForm(
        SHOP_COM.mailbox,
        ryan,
        'Do you ship to Puerto Rico?',
        '2026-09-10T11:50:00+08:00',
      ),
    );
    gmail.deliver(
      contactForm(
        SHOP_COM.mailbox,
        emily,
        'Also, is there a car adapter?',
        '2026-09-10T12:05:00+08:00',
      ),
    );
    await t.runJobs();

    const [emilyTicket] = await ticketsOf('Emily Chen');
    expect(await ticketsOf('Emily Chen')).toHaveLength(1);
    expect(emilyTicket).toMatchObject({
      channel: 'shopify',
      site: 'US',
      source: 'customer',
      store: { name: 'forcome.com' },
      lastInboundAt: '2026-09-10T04:05:00.000Z',
    });
    const detail = await ticketDetail(agent, emilyTicket!.number);
    expect(detail.messages.map((m) => [m.from, m.source])).toEqual([
      [emily, 'customer'],
      [emily, 'customer'],
    ]);
    expect(await ticketsOf('Ryan Ortiz')).toEqual([
      expect.objectContaining({ channel: 'shopify', source: 'customer' }),
    ]);
    // 代发地址 mailer@shopify.com 不是客户
    expect(await ticketsOf('forcome.com')).toEqual([]);
  });

  it('Shopify 店铺默认站点为 MX 时，联系表单与直邮都取 MX（Shopify 按订单收件国家随待办 14）', async () => {
    gmail.deliver(
      contactForm(
        SHOP_MX.mailbox,
        { name: 'Valeria Ríos', address: 'valeria.rios@example.com' },
        '¿Cada cuánto debo cambiar el filtro?',
        '2026-09-09T08:40:00+08:00',
      ),
    );
    gmail.deliver({
      to: SHOP_MX.mailbox,
      from: { name: 'Lucía Herrera', address: 'lucia.herrera@example.com' },
      subject: 'Factura de mi compra',
      text: '¿Me pueden enviar la factura?',
      at: '2026-09-09T09:47:00+08:00',
    });
    await t.runJobs();

    expect(await ticketsOf('Valeria Ríos')).toEqual([
      expect.objectContaining({
        channel: 'shopify',
        site: 'MX',
        store: expect.objectContaining({ name: 'forcome.mx' }) as unknown,
      }),
    ]);
    expect(await ticketsOf('Lucía Herrera')).toEqual([
      expect.objectContaining({ channel: 'email', site: 'MX', source: 'customer' }),
    ]);
  });
});
