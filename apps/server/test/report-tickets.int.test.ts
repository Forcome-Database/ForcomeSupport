import { businessDate } from '@forcome/calendar';
import {
  amazonDomains,
  reportDrillQuery,
  slaRate,
  ticketListSchema,
  ticketReportSchema,
  isEmptyTicketReport,
  type ReportDrillTarget,
  type TicketList,
  type TicketListQuery,
  type TicketReport,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gmailPollJob, listOrderStores, reportAcceptanceJob } from '../src/modules/channel';
import {
  amazonOrdersClient,
  gmailClient,
  reportAcceptanceMails,
  shopifyClient,
  type FakeGmail,
  type FakeMailInput,
} from '../src/modules/integration';
import { amazonPollJob, shopifyPollJob, startOrderBackfill } from '../src/modules/order';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * P17 报表的工单部分（待办 24；PRD P17「指标口径」「第一阶段」v2.34、K19，规格故事 84–88，AC-P1-10/11/12、AC-RP-02/03、
 * AC-P1-14 的数据部分）：工单量只计客户来信触发的新建与重开（生产厂的不计）、首响中位数只含已回复、SLA 分母只计已回复或已超期，
 * 与上一周期的对比、每日工单量；报表的数与 P04 按同一条件下钻的条数一致（同一个视图，下钻条件按 contracts 的 reportDrillQuery）；
 * 店铺范围显式施加、店铺筛选越权 403；未归属店铺的来信只计入「全部店铺」口径的 SLA；「更新于」取三个数据源里最旧的一次同步。
 */

const fixture = getDemoFixture();
const store = (key: string) => fixture.stores.find((s) => s.key === key)!;
const DIRECT = store('amz-direct');
const AUTO = store('amz-auto');
const COM = store('shop-com');

const RELAY_US = amazonDomains.US.relay;
const slug = (name: string) => name.toLowerCase().replace(/\W+/g, '.');

async function report(
  client: ApiClient,
  params: Record<string, string> = {},
): Promise<TicketReport> {
  const query = new URLSearchParams(params).toString();
  const res = await client.get(`/api/reports/tickets${query ? `?${query}` : ''}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ticketReportSchema.parse(await res.json());
}

async function tickets(client: ApiClient, query: TicketListQuery): Promise<TicketList> {
  const params = new URLSearchParams(
    Object.entries(query).map(([key, value]): [string, string] => [key, String(value)]),
  ).toString();
  const res = await client.get(`/api/tickets?${params}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ticketListSchema.parse(await res.json());
}

/** 从报表按某个入口下钻到 P04（条件同前端，contracts 的 reportDrillQuery） */
function drill(
  client: ApiClient,
  data: TicketReport,
  target: ReportDrillTarget,
  filters: { store?: string; site?: 'US' | 'CA' | 'MX' } = {},
) {
  const today = businessDate(new Date(data.now));
  return tickets(client, reportDrillQuery(target, { range: data.range, ...filters }, today));
}

/** 亚马逊买家消息（经中转地址写到店铺邮箱）；有订单号时按平台写法带上 */
function amazonLetter(
  buyer: string,
  at: string,
  overrides: Partial<FakeMailInput> = {},
): FakeMailInput {
  return {
    to: AUTO.mailbox,
    from: { name: buyer, address: `${slug(buyer)}@${RELAY_US}` },
    subject: `Question from ${buyer}`,
    text: 'Hello',
    at,
    messageId: `<${slug(buyer)}.${Date.parse(at)}@buyer.example>`,
    ...overrides,
  };
}

/** 店铺邮箱「已发送」里回复某封来信 */
function replyTo(letter: FakeMailInput, at: string) {
  return {
    from: letter.to as string,
    to: letter.from.address,
    subject: `Re: ${letter.subject}`,
    text: 'Hi, sorry about the trouble.',
    at,
    headers: { 'In-Reply-To': letter.messageId! },
  };
}

/** 已登记生产厂邮箱的来信（示例数据的 FQD），写到亚马逊店铺邮箱；带订单号时按订单归并 */
const producerLetter = (at: string, order?: string): FakeMailInput => ({
  to: AUTO.mailbox,
  from: { name: 'FQD 品质部', address: 'qc@fqd-forcome.com' },
  subject: order ? `订单 ${order} 批次抽检` : '批次抽检',
  text: '抽检报告见附件。',
  at,
});

describe('P17 工单指标的口径与对比（演示时刻 09-30 12:00）', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let supervisor: ApiClient;

  const X_ORDER = '113-3000001-0000001';
  const Y_ORDER = '113-3000002-0000002';
  const met = amazonLetter('Ann Met', '2026-09-29T08:00:00+08:00');
  const missed = amazonLetter('Ben Missed', '2026-09-29T06:00:00+08:00');
  const pending = amazonLetter('Cy Pending', '2026-09-30T10:00:00+08:00');

  beforeAll(async () => {
    t = await startTestHarness({ now: '2026-09-01T09:00:00+08:00' });
    await t.loadFixtures();
    // 本文件测 Gmail 收信，用到示例的 amz-auto@forcome.com（示例里是 163 企业邮箱，待办 35）
    await t.useGmailForFixtureMailboxes();
    gmail = t.clients.fake(gmailClient);
    await t.runJobs();
    const amazon = t.clients.fake(amazonOrdersClient);
    for (const orderId of [X_ORDER, Y_ORDER]) {
      amazon.put(AUTO.id, {
        orderId,
        createdAt: new Date('2026-08-25T10:00:00+08:00'),
        updatedAt: new Date('2026-08-25T10:00:00+08:00'),
      });
    }
    const at = async (when: string, mails: () => void, scan = false) => {
      t.clock.set(when);
      mails();
      await t.runJobs();
      if (scan) {
        await t.scanTimeLimits();
      }
    };
    // X、Y：客户来信新建（9 月），14 天无来信关闭
    await at('2026-09-01T10:01:00+08:00', () =>
      gmail.deliver(
        amazonLetter('Xena Closed', '2026-09-01T10:00:00+08:00', { text: `Order ${X_ORDER}` }),
      ),
    );
    await at('2026-09-02T10:01:00+08:00', () =>
      gmail.deliver(
        amazonLetter('Yuri Reopen', '2026-09-02T10:00:00+08:00', { text: `Order ${Y_ORDER}` }),
      ),
    );
    await at('2026-09-16T10:01:00+08:00', () => undefined, true);
    // 上一周期（09-17 至 09-23）：客户来信新建 1 次
    await at('2026-09-20T10:01:00+08:00', () =>
      gmail.deliver(amazonLetter('Prev Buyer', '2026-09-20T10:00:00+08:00')),
    );
    // 本期：生产厂来信新建（不计）；同一订单的生产厂来信重开 X（不计）；客户来信重开 Y（计）
    await at('2026-09-25T10:01:00+08:00', () =>
      gmail.deliver(producerLetter('2026-09-25T10:00:00+08:00')),
    );
    await at('2026-09-26T10:01:00+08:00', () =>
      gmail.deliver(producerLetter('2026-09-26T10:00:00+08:00', X_ORDER)),
    );
    await at('2026-09-27T10:01:00+08:00', () =>
      gmail.deliver(
        amazonLetter('Yuri Reopen', '2026-09-27T10:00:00+08:00', {
          text: `Order ${Y_ORDER} again`,
        }),
      ),
    );
    // AC-P1-12：5 小时回复（达标）、30 小时未回复（已超期）、2 小时前到达未回复（未到期）
    await at('2026-09-29T13:01:00+08:00', () => {
      gmail.deliver(missed);
      gmail.deliver(met);
      gmail.send(replyTo(met, '2026-09-29T13:00:00+08:00'));
    });
    await at('2026-09-30T12:00:00+08:00', () => gmail.deliver(pending), true);
    supervisor = await t.loginAs('客服主管');
  });

  afterAll(async () => {
    await t.close();
  });

  it('工单量：客户来信触发的新建与重开计入，生产厂来信触发的新建与重开不计；按触发来信的到达日期归期', async () => {
    const week = await report(supervisor);
    expect(week.range).toEqual({ period: '7d', from: '2026-09-24', to: '2026-09-30' });
    expect(week.previous).toEqual({ from: '2026-09-17', to: '2026-09-23' });
    // Yuri Reopen 的重开、Ann、Ben、Cy 的新建
    expect(week.current.volume).toBe(4);
    expect(week.prior.volume).toBe(1);
    const daily = Object.fromEntries(week.daily.map((d) => [d.date, [d.amazon, d.shopify_email]]));
    expect(daily).toEqual({
      '2026-09-24': [0, 0],
      '2026-09-25': [0, 0],
      '2026-09-26': [0, 0],
      '2026-09-27': [1, 0],
      '2026-09-28': [0, 0],
      '2026-09-29': [2, 0],
      '2026-09-30': [1, 0],
    });
  });

  it('AC-P1-12：亚马逊来信 3 封（5 小时回复、30 小时未回复、2 小时前到达未回复）→ 分母 2，达标率 50%；首响中位数只含已回复', async () => {
    const days = await report(supervisor, {
      period: 'custom',
      from: '2026-09-29',
      to: '2026-09-30',
    });
    expect(days.current.sla).toEqual({ met: 1, counted: 2 });
    expect(slaRate(days.current.sla)).toBe(50);
    expect(days.current.firstResponseMs).toBe(5 * 3_600_000);
    expect(days.arrived).toBe(3);
    // 上一周期没有已回复的来信：首响为空（前端不写对比）
    expect(days.previous).toEqual({ from: '2026-09-27', to: '2026-09-28' });
    expect(days.prior.firstResponseMs).toBeNull();
  });

  it('对比期：本月对比上月同期，自定义对比之前等长区间', async () => {
    const month = await report(supervisor, { period: 'month' });
    expect(month.range).toEqual({ period: 'month', from: '2026-09-01', to: '2026-09-30' });
    expect(month.previous).toEqual({ from: '2026-08-01', to: '2026-08-30' });
    // X、Y 新建，Prev Buyer，Y 重开，Ann、Ben、Cy
    expect(month.current.volume).toBe(7);
    expect(month.prior.volume).toBe(0);
    const custom = await report(supervisor, {
      period: 'custom',
      from: '2026-09-27',
      to: '2026-09-30',
    });
    expect(custom.previous).toEqual({ from: '2026-09-23', to: '2026-09-26' });
    expect([custom.current.volume, custom.prior.volume]).toEqual([4, 0]);
  });

  it('报表的数与 P04 按同一条件下钻的条数一致（工单量、柱、图例、首响、SLA）', async () => {
    const week = await report(supervisor);
    const volume = await drill(supervisor, week, { from: 'metric-volume' });
    expect(volume.drill).toMatchObject({ kind: 'triggered', events: week.current.volume });
    for (const day of week.daily) {
      const bar = await drill(supervisor, week, { from: 'daily-bar', date: day.date });
      expect(bar.drill?.events, day.date).toBe(day.amazon + day.shopify_email);
    }
    const legend = await drill(supervisor, week, { from: 'daily-legend', channel: 'amazon' });
    expect(legend.drill?.events).toBe(week.daily.reduce((n, d) => n + d.amazon, 0));
    const sla = await drill(supervisor, week, { from: 'metric-sla' });
    expect(sla.drill?.letters).toBe(
      week.current.sla.counted - week.current.sla.met - week.unassignedMissed,
    );
    const replied = await drill(supervisor, week, { from: 'metric-first-response' });
    expect(replied.drill).toMatchObject({ kind: 'arrived', letters: 1, tickets: 1 });
  });
});

describe('P17 与 P04 一致、店铺范围与权限（AC-P1-14 验收夹具，演示时刻 09-11 10:20）', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let supervisor: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness({ now: '2026-09-11T10:20:00+08:00' });
    await t.loadFixtures();
    // 本文件测 Gmail 收信，用到示例的 amz-auto@forcome.com（示例里是 163 企业邮箱，待办 35）
    await t.useGmailForFixtureMailboxes();
    gmail = t.clients.fake(gmailClient);
    await t.runJobs();
    for (const { mail } of reportAcceptanceMails(fixture)) gmail.deliver(mail);
    // 未归属店铺的亚马逊来信（写到没登记的绑定邮箱，落在 Forcome Direct 的邮箱里）：09-09 到达，到演示时刻已超期未回复
    gmail.deliver({
      to: 'amz-ca2@forcome.com',
      mailbox: DIRECT.mailbox,
      deliveredTo: 'amz-ca2@forcome.com',
      from: { name: 'Una Assigned', address: 'una.assigned@marketplace.amazon.ca' },
      subject: 'Where is my order?',
      text: 'Tracking says delivered.',
      at: '2026-09-09T11:00:00+08:00',
    });
    await t.runJobs();
    await t.scanTimeLimits();
    supervisor = await t.loginAs('客服主管');
  });

  afterAll(async () => {
    await t.close();
  });

  const WEEK = { period: 'custom', from: '2026-09-04', to: '2026-09-10' };

  it('AC-P1-14 的数据：09-10 的柱为 73（亚马逊 52、Shopify 与邮件 21），点柱下钻 P04 的事件数与工单数都是 73', async () => {
    const data = await report(supervisor, WEEK);
    const sept10 = data.daily.find((d) => d.date === '2026-09-10')!;
    expect(sept10).toEqual({ date: '2026-09-10', amazon: 52, shopify_email: 21 });
    expect(data.current.volume).toBe(73);
    const bar = await drill(supervisor, data, { from: 'daily-bar', date: '2026-09-10' });
    expect(bar.drill).toEqual({ kind: 'triggered', events: 73, letters: null, tickets: 73 });
    expect(bar.total).toBe(73);
    const legend = await drill(supervisor, data, {
      from: 'daily-legend',
      channel: 'shopify_email',
    });
    expect(legend.drill?.events).toBe(21);
  });

  it('未归属店铺的亚马逊来信只计入「全部店铺」口径的 SLA 分母（卡上未达标 = P04 下钻封数 + 未归属的封数）；选了店铺不计', async () => {
    const all = await report(supervisor, {
      period: 'custom',
      from: '2026-09-04',
      to: '2026-09-11',
    });
    expect(all.unassignedMissed).toBe(1);
    const missedOnCard = all.current.sla.counted - all.current.sla.met;
    const sla = await drill(supervisor, all, { from: 'metric-sla' });
    expect(sla.drill?.letters).toBeGreaterThan(0);
    expect(missedOnCard).toBe(sla.drill!.letters! + all.unassignedMissed);
    // 到达的来信含未归属的一封
    expect(all.arrived).toBe(73 + 1);

    const direct = await report(supervisor, {
      period: 'custom',
      from: '2026-09-04',
      to: '2026-09-11',
      store: DIRECT.id,
    });
    expect(direct.unassignedMissed).toBe(0);
    const directSla = await drill(supervisor, direct, { from: 'metric-sla' }, { store: DIRECT.id });
    expect(direct.current.sla.counted - direct.current.sla.met).toBe(directSla.drill!.letters);
    // 选了站点也不计（未归属来信没有站点）
    expect((await report(supervisor, { ...WEEK, site: 'US' })).unassignedMissed).toBe(0);
  });

  it('AC-RP-02：只选 Forcome Direct 时只统计该店铺；下钻带店铺，条数一致', async () => {
    const all = await report(supervisor, WEEK);
    const direct = await report(supervisor, { ...WEEK, store: DIRECT.id });
    const auto = await report(supervisor, { ...WEEK, store: AUTO.id });
    const com = await report(supervisor, { ...WEEK, store: COM.id });
    // 验收夹具的亚马逊来信轮流写到两个亚马逊店铺（各 26），Shopify 与邮件的轮流写到两个 Shopify 店铺
    expect(direct.current.volume).toBe(26);
    expect(direct.daily.find((d) => d.date === '2026-09-10')).toMatchObject({
      amazon: 26,
      shopify_email: 0,
    });
    expect(auto.current.volume).toBe(26);
    expect(com.current.volume).toBe(11);
    expect(all.current.volume).toBe(73);
    const drilled = await drill(
      supervisor,
      direct,
      { from: 'metric-volume' },
      { store: DIRECT.id },
    );
    expect(drilled.drill?.events).toBe(26);
    // 站点：Forcome Direct 的来信按 US / CA / MX 三个中转域轮流
    const mx = await report(supervisor, { ...WEEK, store: DIRECT.id, site: 'MX' });
    expect(mx.current.volume).toBe(8);
    expect(
      (await drill(supervisor, mx, { from: 'metric-volume' }, { store: DIRECT.id, site: 'MX' }))
        .drill?.events,
    ).toBe(8);
  });

  it('视图查询显式施加店铺范围：只管 Forcome Direct 的客服主管只看到该店铺；店铺筛选选了范围外的店铺 403 并记越权', async () => {
    const memberId = await t.addMember({
      name: '只管 Forcome Direct 的客服主管',
      dept: 'FSH / 客服部',
      roles: ['supervisor'],
      allStores: false,
      storeIds: [DIRECT.id],
    });
    const narrow = await t.loginAs({ memberId });
    const data = await report(narrow, WEEK);
    expect(data.current.volume).toBe(26);
    expect(data.daily.find((d) => d.date === '2026-09-10')).toMatchObject({
      amazon: 26,
      shopify_email: 0,
    });
    // 未归属的来信只在看全部店铺时计入
    expect(
      (await report(narrow, { period: 'custom', from: '2026-09-04', to: '2026-09-11' }))
        .unassignedMissed,
    ).toBe(0);

    const res = await narrow.get(`/api/reports/tickets?store=${COM.id}`);
    expect(res.status).toBe(403);
    expect(await t.auditRecords({ action: 'access.denied' })).toContainEqual(
      expect.objectContaining({
        actorId: memberId,
        objectType: 'store',
        objectId: COM.id,
        after: expect.objectContaining({
          reason: 'store_scope',
          path: '/api/reports/tickets',
        }) as unknown,
      }),
    );
  });

  it('AC-P1-10：管理员能看报表但没有「查看工单」（下钻目标 403，前端据此不可点）；坐席没有「查看报表」', async () => {
    const admin = await t.loginAs('管理员');
    expect((await report(admin, WEEK)).current.volume).toBe(73);
    expect((await admin.get('/api/tickets')).status).toBe(403);
    const knowledge = await t.loginAs('知识库负责人');
    expect((await report(knowledge, WEEK)).current.volume).toBe(73);
    expect((await knowledge.get('/api/tickets')).status).toBe(200);
    expect((await (await t.loginAs('坐席')).get('/api/reports/tickets')).status).toBe(403);
  });

  it('AC-RP-03 的数据：所选范围没有客户来信触发的新建或重开、也没有到达的客户来信时为无数据；条件不对时 400', async () => {
    const none = await report(supervisor, {
      period: 'custom',
      from: '2026-08-01',
      to: '2026-08-02',
    });
    expect(none.current).toEqual({ volume: 0, firstResponseMs: null, sla: { met: 0, counted: 0 } });
    expect(none.arrived).toBe(0);
    expect(isEmptyTicketReport(none)).toBe(true);
    expect(isEmptyTicketReport(await report(supervisor, WEEK))).toBe(false);
    expect((await supervisor.get('/api/reports/tickets?period=year')).status).toBe(400);
    expect((await supervisor.get('/api/reports/tickets?site=JP')).status).toBe(400);
  });
});

describe('「更新于」与 Shopify 回补的注', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness({ now: '2026-09-11T10:00:00+08:00' });
    await t.loadFixtures();
    // 本文件测 Gmail 收信，用到示例的 amz-auto@forcome.com（示例里是 163 企业邮箱，待办 35）
    await t.useGmailForFixtureMailboxes();
    await t.runJobs();
  });

  afterAll(async () => {
    await t.close();
  });

  it('AC-P1-11：Gmail 最近同步 10:18、亚马逊订单 10:12、Shopify 订单 10:15 → 更新于 10:12（不随店铺筛选变化）', async () => {
    const supervisor = await t.loginAs('客服主管');
    const syncAt = async (at: string, enqueue: () => Promise<unknown>) => {
      t.clock.set(at);
      await enqueue();
      await t.runJobs();
    };
    await syncAt('2026-09-11T10:12:00+08:00', () => t.enqueue(amazonPollJob, {}));
    await syncAt('2026-09-11T10:15:00+08:00', () => t.enqueue(shopifyPollJob, {}));
    await syncAt('2026-09-11T10:18:00+08:00', () => t.enqueue(gmailPollJob, {}));
    t.clock.set('2026-09-11T10:20:00+08:00');
    const data = await report(supervisor);
    expect(data.updatedAt).toBe(new Date('2026-09-11T10:12:00+08:00').toISOString());
    expect((await report(supervisor, { store: COM.id })).updatedAt).toBe(data.updatedAt);
    // 没开始回补：没有回补的注
    expect(data.shopifyBackfillDays).toBeNull();
  });

  it('Shopify 没开通 read_all_orders、只回补了 60 天：标题下注明天数', async () => {
    t.clients.fake(shopifyClient).limitHistory();
    await startOrderBackfill(t.runtime, listOrderStores);
    await t.runJobs();
    const data = await report(await t.loginAs('客服主管'));
    expect(data.shopifyBackfillDays).toBe(60);
  });
});

describe('AC-P1-14 的验收夹具经开发任务投递（开发测试环境长期运行）', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness({ now: '2026-09-11T10:20:00+08:00' });
    await t.loadFixtures();
    await t.runJobs();
  });

  afterAll(async () => {
    await t.close();
  });

  it('worker 重启过（Fake 的历史号从头数、库里记着更大的游标）：任务照样把 73 封投进来、同步并归并，验收日的柱为 73', async () => {
    // 先让四个邮箱的游标往前走，再把 Fake 重置成刚启动的样子（历史号从头数、没有 watch）
    const gmail = t.clients.fake(gmailClient);
    for (const [n, { mail }] of reportAcceptanceMails(fixture).slice(0, 4).entries()) {
      gmail.deliver({
        to: mail.to,
        from: { name: `Warmup ${n}`, address: `warmup.${n}@example.com` },
        subject: 'Warmup',
        text: 'Hello',
        at: '2026-09-01T10:00:00+08:00',
      });
    }
    await t.runJobs();
    t.resetFakes();
    await t.enqueue(reportAcceptanceJob, {});
    await t.runJobs();
    const data = await report(await t.loginAs('客服主管'), {
      period: 'custom',
      from: '2026-09-04',
      to: '2026-09-10',
    });
    expect(data.daily.at(-1)).toEqual({ date: '2026-09-10', amazon: 52, shopify_email: 21 });
    // 再投一次：按 Gmail 消息 ID 去重，不多出工单
    await t.enqueue(reportAcceptanceJob, {});
    await t.runJobs();
    const again = await report(await t.loginAs('客服主管'), {
      period: 'custom',
      from: '2026-09-04',
      to: '2026-09-10',
    });
    expect(again.daily.at(-1)).toEqual({ date: '2026-09-10', amazon: 52, shopify_email: 21 });
  });
});
