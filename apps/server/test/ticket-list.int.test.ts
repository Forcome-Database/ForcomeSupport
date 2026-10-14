import { businessDate } from '@forcome/calendar';
import {
  amazonDomains,
  slaRemainingWords,
  ticketDetailSchema,
  ticketListSchema,
  type TicketDetail,
  type TicketList,
  type TicketListItem,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  amazonOrdersClient,
  gmailClient,
  type FakeGmail,
  type FakeMailInput,
} from '../src/modules/integration';
import { ticketTimeLimitsJob } from '../src/modules/ticket';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * P04 工单列表完整版（待办 18；PRD P04「第一阶段」v2.32、P17「指标口径」，规格故事 56–61）：筛选组合与店铺范围、
 * SLA 列与默认排序（按示例夹具 p1_tickets() 的 16 行核对）、报表下钻（按事件计与按封计，事件数与工单数分开返回）、排序、
 * 分页，以及实时推送（新来信入库后推「工单变了」，推送只给该收的人，连接不续期会话、会话结束即断开）。
 */

const fixture = getDemoFixture();
const store = (key: string) => fixture.stores.find((s) => s.key === key)!;
const DIRECT = store('amz-direct');
const AUTO = store('amz-auto');
const COM = store('shop-com');
const MX = store('shop-mx');
type Sample = (typeof fixture.tickets)[number];

async function list(
  client: ApiClient,
  params: Record<string, string | number> = {},
): Promise<TicketList> {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]): [string, string] => [key, String(value)]),
  ).toString();
  const res = await client.get(`/api/tickets${query ? `?${query}` : ''}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ticketListSchema.parse(await res.json());
}

async function detail(client: ApiClient, number: string): Promise<TicketDetail> {
  const res = await client.get(`/api/tickets/${number}`);
  expect(res.status).toBe(200);
  return ticketDetailSchema.parse(await res.json());
}

/** 一张工单在示例数据里的认法：客户 + 订单号（Priya Raman 有两张，按订单号分开） */
const keyOf = (ticket: TicketListItem) => `${ticket.customer.name} ${ticket.orderNumber ?? '—'}`;
const sampleKey = (sample: Sample) => `${sample.customer} ${sample.order ?? '—'}`;
const keys = (tickets: readonly TicketListItem[]) => tickets.map(keyOf);
/** 示例数据里满足条件的几张，按原型 P04 的先后（即默认排序） */
const samples = (match: (sample: Sample) => boolean) =>
  fixture.tickets.filter(match).map(sampleKey);

/** P04 的 SLA 列怎么写（与前端 tickets-table 同一写法；原型的 slaDisplay 没有「· 内部」前的空格以外的差别） */
function slaWords(ticket: TicketListItem, now: Date): string {
  if (ticket.status === 'awaiting_reply' && ticket.sla) {
    return slaRemainingWords({ dueAt: new Date(ticket.sla.dueAt), now, target: ticket.sla.target })
      .text;
  }
  return ticket.status === 'awaiting_customer' ? '已回复' : '—';
}

describe('P04 工单列表：示例数据（16 张，演示时刻 09-11 10:20）', () => {
  let t: TestHarness;
  let supervisor: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    // 与 worker 启动时一样回放示例来信与我方回复（演示时刻不平移），再跑一次每分钟的时限扫描（过了截止的改为未达标）
    t.clients.replayFixtures(fixture);
    await t.runJobs();
    await t.enqueue(ticketTimeLimitsJob, {});
    await t.runJobs();
    supervisor = await t.loginAs('客服主管');
  });

  afterAll(async () => {
    await t.close();
  });

  it('默认排序与 SLA 列：已超时在前，其后按剩余升序，再按 待回复 → 等客户 → 已解决 → 已关闭，组内最近来信倒序（同原型 16 行）', async () => {
    const page = await list(supervisor);
    expect(page).toMatchObject({ total: 16, page: 1, pageSize: 20, drill: null });
    expect(page.now).toBe('2026-09-11T02:20:00.000Z');
    // 没写最近来信为近 30 天（含今天）
    expect(page.inbound).toEqual({ period: '30d', from: '2026-08-13', to: '2026-09-11' });
    expect(keys(page.tickets)).toEqual(fixture.tickets.map(sampleKey));
    // 待回复写剩余或已超时（Shopify 与邮件加「· 内部」），生产厂的待回复与已解决、已关闭写「—」，等客户写「已回复」
    const now = new Date(page.now);
    expect(page.tickets.map((ticket) => [keyOf(ticket), slaWords(ticket, now)])).toEqual(
      fixture.tickets.map((sample) => [
        sampleKey(sample),
        sample.slaDisplay.text + (sample.slaDisplay.internalTarget ? ' · 内部' : ''),
      ]),
    );
    // 颜色：≤ 2 小时与已超时红，≤ 6 小时黄
    const tones = page.tickets
      .filter((ticket) => ticket.sla)
      .map(
        (ticket) =>
          slaRemainingWords({ dueAt: new Date(ticket.sla!.dueAt), now, target: ticket.sla!.target })
            .tone,
      );
    expect(tones).toEqual(
      fixture.tickets.filter((s) => s.slaDisplay.level !== 'none').map((s) => s.slaDisplay.level),
    );
  });

  it('各筛选：状态、渠道、店铺、站点、来源单独与组合都只列满足的工单，顺序仍是默认排序', async () => {
    const cases: [Record<string, string>, (sample: Sample) => boolean][] = [
      [{ status: 'awaiting_customer' }, (s) => s.status === '等客户'],
      [{ status: 'resolved' }, (s) => s.status === '已解决'],
      [{ channel: 'shopify' }, (s) => s.channel === 'Shopify'],
      [{ channel: 'email' }, (s) => s.channel === '邮件'],
      [{ store: COM.id }, (s) => s.storeKey === 'shop-com'],
      [{ site: 'MX' }, (s) => s.site === 'MX'],
      [{ source: 'producer' }, (s) => s.source === '生产厂'],
      [{ source: 'other_supplier' }, () => false],
      [
        { channel: 'amazon', site: 'MX', status: 'awaiting_customer' },
        (s) => s.channel === '亚马逊' && s.site === 'MX' && s.status === '等客户',
      ],
      [
        { store: DIRECT.id, status: 'awaiting_reply' },
        (s) => s.storeKey === 'amz-direct' && s.status === '待回复',
      ],
    ];
    for (const [params, match] of cases) {
      const page = await list(supervisor, params);
      expect(keys(page.tickets), JSON.stringify(params)).toEqual(samples(match));
      expect(page.total).toBe(samples(match).length);
    }
    // 组合条件确实筛到了几张（不是条件写错了恰好都为空）
    expect(
      samples((s) => s.channel === '亚马逊' && s.site === 'MX' && s.status === '等客户'),
    ).toHaveLength(2);
  });

  it('最近来信：今天 · 近 7 天 · 近 90 天 · 自定义（按北京时间的日期，含两端）', async () => {
    const lastDay = (s: Sample) => businessDate(new Date(s.lastInboundAt));
    const today = await list(supervisor, { inbound: 'today' });
    expect(today.inbound).toEqual({ period: 'today', from: '2026-09-11', to: '2026-09-11' });
    expect(keys(today.tickets)).toEqual(samples((s) => lastDay(s) === '2026-09-11'));
    const week = await list(supervisor, { inbound: '7d' });
    expect(week.inbound).toMatchObject({ from: '2026-09-05', to: '2026-09-11' });
    expect(keys(week.tickets)).toEqual(samples((s) => lastDay(s) >= '2026-09-05'));
    expect(week.total).toBe(15);
    expect((await list(supervisor, { inbound: '90d' })).total).toBe(16);
    const custom = await list(supervisor, {
      inbound: 'custom',
      from: '2026-09-01',
      to: '2026-09-09',
    });
    expect(keys(custom.tickets)).toEqual(
      samples((s) => lastDay(s) >= '2026-09-01' && lastDay(s) <= '2026-09-09'),
    );
    // 起止颠倒时对调
    const reversed = await list(supervisor, {
      inbound: 'custom',
      from: '2026-09-09',
      to: '2026-09-01',
    });
    expect(keys(reversed.tickets)).toEqual(keys(custom.tickets));
  });

  it('表头排序：最近来信 ↓ / ↑，SLA 剩余 ↓ 把默认排序整体反过来', async () => {
    const byLatest = [...fixture.tickets]
      .sort((a, b) => Date.parse(b.lastInboundAt) - Date.parse(a.lastInboundAt))
      .map(sampleKey);
    expect(keys((await list(supervisor, { sort: 'last_inbound' })).tickets)).toEqual(byLatest);
    expect(keys((await list(supervisor, { sort: 'last_inbound', dir: 'asc' })).tickets)).toEqual(
      [...byLatest].reverse(),
    );
    expect(keys((await list(supervisor, { sort: 'sla', dir: 'desc' })).tickets)).toEqual(
      fixture.tickets.map(sampleKey).reverse(),
    );
  });

  /**
   * 回放出的工单里某天由客户来信新建的（编号的日期就是首封来信的日期，即新建事件的日期）。示例回放每张示例工单只送最近一封来信
   * （Oliver Grant 等几张另按时间线送全程），所以哪天新建按回放出的编号算，不按原型画的编号（原型 Laura Bennett、Diego Salazar
   * 的首封来信在 09-10、最近来信在 09-11，回放只送 09-11 那封；Mateo Rivas 反过来）
   */
  const createdOn = (tickets: readonly TicketListItem[], day: string) =>
    keys(
      tickets.filter(
        (x) => x.number.startsWith(`T-${day.replaceAll('-', '')}-`) && x.source === 'customer',
      ),
    );

  it('下钻「客户来信触发日期 09-10」：列出 09-10 客户来信触发的新建或重开对应的工单，事件数与工单数分开返回', async () => {
    const all = (await list(supervisor)).tickets;
    const page = await list(supervisor, { drill: 'triggered', drillFrom: '2026-09-10' });
    // 09-10 没有重开，新建的都是事件；Oliver Grant 的工单 09-04 新建、09-10 追加来信，追加不算事件
    const expected = createdOn(all, '2026-09-10');
    expect(expected.length).toBeGreaterThanOrEqual(5);
    expect(keys(page.tickets)).toEqual(expected);
    expect(keys(page.tickets)).not.toContain('Oliver Grant 204-5566778-9900112');
    expect(page.drill).toEqual({
      kind: 'triggered',
      events: expected.length,
      letters: null,
      tickets: expected.length,
    });
    expect(page.total).toBe(expected.length);

    // 生产厂来信触发的新建不计：FQD 品质部 09-11 由生产厂来信新建
    const sept11 = await list(supervisor, { drill: 'triggered', drillFrom: '2026-09-11' });
    expect(keys(sept11.tickets)).toEqual(createdOn(all, '2026-09-11'));
    expect(all.find((x) => x.customer.name === 'FQD 品质部')!.number).toMatch(/^T-20260911-/);
    expect(keys(sept11.tickets)).not.toContain('FQD 品质部 —');

    // 图例带渠道（看触发那封来信自己的渠道）；与其余筛选组合时数量随之收窄
    const amazon = await list(supervisor, {
      drill: 'triggered',
      drillFrom: '2026-09-10',
      drillChannel: 'amazon',
    });
    expect(keys(amazon.tickets)).toEqual(
      createdOn(
        all.filter((x) => x.channel === 'amazon'),
        '2026-09-10',
      ),
    );
    const others = await list(supervisor, {
      drill: 'triggered',
      drillFrom: '2026-09-10',
      drillChannel: 'shopify_email',
    });
    expect(amazon.total).toBeGreaterThan(0);
    expect(others.total).toBeGreaterThan(0);
    expect(amazon.total + others.total).toBe(expected.length);
    const waiting = await list(supervisor, {
      drill: 'triggered',
      drillFrom: '2026-09-10',
      status: 'awaiting_customer',
    });
    const waitingExpected = createdOn(
      all.filter((x) => x.status === 'awaiting_customer'),
      '2026-09-10',
    );
    expect(waitingExpected.length).toBeGreaterThan(0);
    expect(waiting.drill).toMatchObject({
      events: waitingExpected.length,
      tickets: waitingExpected.length,
    });
  });

  it('下钻按封计（首响、SLA）：列出含这些来信的工单，来信封数与工单数分开返回', async () => {
    // 期望值按工单详情里的来信逐封数（来信到达日期 09-10 至 09-11，按来信自己的渠道与状态）
    const all = await list(supervisor, { inbound: '90d' });
    const details = await Promise.all(
      all.tickets.map((ticket) => detail(supervisor, ticket.number)),
    );
    const letters = (match: (m: TicketDetail['messages'][number]) => boolean) =>
      details.flatMap((d) =>
        d.messages
          .filter(
            (m) =>
              m.direction === 'inbound' &&
              m.source === 'customer' &&
              businessDate(new Date(m.arrivedAt)) >= '2026-09-10' &&
              businessDate(new Date(m.arrivedAt)) <= '2026-09-11' &&
              match(m),
          )
          .map(() => d.ticket.number),
      );
    const check = async (params: Record<string, string>, expected: string[]) => {
      const page = await list(supervisor, {
        drill: 'arrived',
        drillFrom: '2026-09-10',
        drillTo: '2026-09-11',
        ...params,
      });
      expect(page.drill).toEqual({
        kind: 'arrived',
        events: null,
        letters: expected.length,
        tickets: new Set(expected).size,
      });
      expect(new Set(page.tickets.map((ticket) => ticket.number))).toEqual(new Set(expected));
    };
    // SLA 达标率（亚马逊）：亚马逊来信 + 未达标（James Walker 的已超时）
    const missed = letters((m) => m.channel === 'amazon' && m.sla?.result === 'missed');
    expect(missed.length).toBeGreaterThan(0);
    await check({ drillChannel: 'amazon', letter: 'missed' }, missed);
    // 首响中位数：客户来信 + 已回复
    const replied = letters((m) => m.firstReplyAt !== null);
    expect(replied.length).toBeGreaterThan(0);
    await check({ letter: 'replied' }, replied);
    // 未到期、全部到达的客户来信
    await check(
      { letter: 'pending' },
      letters((m) => m.sla?.result === 'pending'),
    );
    await check(
      {},
      letters(() => true),
    );
  });

  it('店铺范围强制过滤：只管 Forcome Direct 的坐席只看到该店铺的工单；店铺筛选选了范围外的店铺 403 并记越权', async () => {
    const memberId = await t.addMember({
      name: '只管 Forcome Direct 的坐席',
      dept: 'FSH / 客服部',
      roles: ['agent'],
      allStores: false,
      storeIds: [DIRECT.id],
    });
    const narrow = await t.loginAs({ memberId });
    const page = await list(narrow);
    expect(keys(page.tickets)).toEqual(samples((s) => s.storeKey === 'amz-direct'));
    // 下钻同样只数范围内的
    const drilled = await list(narrow, { drill: 'triggered', drillFrom: '2026-09-10' });
    expect(keys(drilled.tickets)).toEqual(createdOn(page.tickets, '2026-09-10'));
    expect(drilled.total).toBeGreaterThan(0);
    expect((await list(narrow, { store: DIRECT.id })).total).toBe(page.total);

    const res = await narrow.get(`/api/tickets?store=${MX.id}`);
    expect(res.status).toBe(403);
    expect(await t.auditRecords({ action: 'access.denied' })).toContainEqual(
      expect.objectContaining({
        actorId: memberId,
        objectType: 'store',
        objectId: MX.id,
        objectLabel: 'forcome.mx',
        storeId: MX.id,
        after: expect.objectContaining({ reason: 'store_scope', path: '/api/tickets' }) as unknown,
      }),
    );
  });

  it('条件不对时 400；管理员没有「查看工单」403', async () => {
    expect((await supervisor.get('/api/tickets?status=open')).status).toBe(400);
    expect((await supervisor.get('/api/tickets?inbound=all')).status).toBe(400);
    expect((await supervisor.get('/api/tickets?page=0')).status).toBe(400);
    expect((await (await t.loginAs('管理员')).get('/api/tickets')).status).toBe(403);
  });
});

describe('P04 工单列表：分页与重开的事件数', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let agent: ApiClient;

  const RELAY_US = amazonDomains.US.relay;
  const buyer = (name: string, overrides: Partial<FakeMailInput> & { at: string }) => ({
    to: AUTO.mailbox,
    from: { name, address: `${name.toLowerCase().replace(/\W+/g, '.')}@${RELAY_US}` },
    subject: `Question from ${name}`,
    text: 'Hello',
    ...overrides,
  });

  beforeAll(async () => {
    t = await startTestHarness({ now: '2026-09-30T12:00:00+08:00' });
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    await t.runJobs();
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  it('每页 20 条：21 张时第 2 页只有 1 张，总条数不变；超出的页码为空', async () => {
    for (let i = 0; i < 21; i += 1) {
      gmail.deliver(
        buyer(`Paging Buyer ${String(i).padStart(2, '0')}`, {
          at: `2026-09-29T${String(i).padStart(2, '0')}:00:00+08:00`,
        }),
      );
    }
    await t.runJobs();
    const first = await list(agent, { inbound: 'custom', from: '2026-09-29', to: '2026-09-29' });
    expect(first).toMatchObject({ total: 21, page: 1, pageSize: 20 });
    expect(first.tickets).toHaveLength(20);
    const second = await list(agent, {
      inbound: 'custom',
      from: '2026-09-29',
      to: '2026-09-29',
      page: 2,
    });
    expect(second).toMatchObject({ total: 21, page: 2 });
    expect(second.tickets).toHaveLength(1);
    // 两页合起来正好一张不重、一张不漏
    expect(new Set([...first.tickets, ...second.tickets].map((x) => x.id)).size).toBe(21);
    const beyond = await list(agent, {
      inbound: 'custom',
      from: '2026-09-29',
      to: '2026-09-29',
      page: 3,
    });
    expect(beyond).toMatchObject({ total: 21, tickets: [] });
  });

  it('同一工单期间内新建又重开：按事件计时事件数 2、工单数 1', async () => {
    t.clients.fake(amazonOrdersClient).put(AUTO.id, {
      orderId: '113-2000001-0000001',
      createdAt: new Date('2026-08-20T10:00:00+08:00'),
      updatedAt: new Date('2026-08-20T10:00:00+08:00'),
    });
    gmail.deliver(
      buyer('Reopen Buyer', { text: 'Order 113-2000001-0000001', at: '2026-09-01T10:00:00+08:00' }),
    );
    await t.runJobs();
    // 待回复 14 天无新来信关闭（拨到 09-16 跑一次时限扫描，扫完拨回）
    const back = t.clock.now();
    t.clock.set('2026-09-16T10:00:00+08:00');
    await t.enqueue(ticketTimeLimitsJob, {});
    await t.runJobs();
    t.clock.set(back);
    gmail.deliver(
      buyer('Reopen Buyer', {
        text: 'Order 113-2000001-0000001 — still broken',
        at: '2026-09-20T10:00:00+08:00',
      }),
    );
    await t.runJobs();

    const page = await list(agent, {
      drill: 'triggered',
      drillFrom: '2026-09-01',
      drillTo: '2026-09-20',
      inbound: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(page.tickets.map((x) => x.customer.name)).toEqual(['Reopen Buyer']);
    expect(page.drill).toEqual({ kind: 'triggered', events: 2, letters: null, tickets: 1 });
    // 只按重开那天下钻：1 次事件
    const reopenDay = await list(agent, { drill: 'triggered', drillFrom: '2026-09-20' });
    expect(reopenDay.drill).toMatchObject({ events: 1, tickets: 1 });
  });
});
