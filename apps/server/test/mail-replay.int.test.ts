import { amazonDomains, ticketListSchema, type TicketListItem } from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mailCutoverStatus } from '../src/modules/channel';
import {
  amazonOrdersClient,
  gmailClient,
  type FakeAmazonOrders,
  type FakeGmail,
  type FakeMailInput,
} from '../src/modules/integration';
import { ticketTimeLimitsJob } from '../src/modules/ticket';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 历史邮件回放与 T0 切换（待办 26；规格「历史导入与切换」，PRD 第 14 节「历史数据」、6.1 第一阶段迁移表、R-TK-01/02/07、R-SL-08，
 * 验收 AC-P1-13；协调者 2026-10-14 决定 Q1–Q4）：邮件先放进 Fake Gmail（邮箱还没开始监听，它们是上线前的历史邮件）→
 * 执行回放命令（与入口 mail-replay 同一个函数）→ 以坐席身份调 P04 接口、查状态变更记录断言。回放复用实时流水线：
 * 归并、关闭、重开按邮件时间判断，回放模式下不产生任何通知；T0 之后由实时同步接着收，交界处不丢不重。
 */

const stores = getDemoFixture().stores;
/** 亚马逊店铺（只有 US 站） */
const AUTO = stores.find((s) => s.name === 'Forcome Auto')!;
const DIRECT = stores.find((s) => s.name === 'Forcome Direct')!;

const RELAY_US = amazonDomains.US.relay;
const relayOf = (buyer: string) => `${buyer.toLowerCase().replace(/\W+/g, '.')}@${RELAY_US}`;
const iso = (at: string) => new Date(at).toISOString();

/** 亚马逊买家消息（经中转地址发到店铺邮箱） */
function amazonLetter(buyer: string, at: string, text: string, messageId?: string): FakeMailInput {
  return {
    to: AUTO.mailbox,
    from: { name: buyer, address: relayOf(buyer) },
    subject: 'Question about my order',
    text,
    at,
    ...(messageId ? { messageId } : {}),
  };
}

/** 客户直接写到店铺邮箱的信（直邮） */
function directLetter(name: string, at: string): FakeMailInput {
  return {
    to: AUTO.mailbox,
    from: { name, address: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com` },
    subject: `Help please — ${name}`,
    text: 'The vacuum stopped working.',
    at,
  };
}

/** 店铺邮箱「已发送」里的我方回信 */
function reply(buyer: string, at: string, inReplyTo: string) {
  return {
    from: AUTO.mailbox,
    to: relayOf(buyer),
    subject: 'Re: Question about my order',
    text: 'Hi, sorry about the trouble.',
    at,
    headers: { 'In-Reply-To': inReplyTo },
  };
}

/** P04 的全部工单（最近来信不限日期，逐页取完） */
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

async function ticketsOf(client: ApiClient, customer: string): Promise<TicketListItem[]> {
  return (await ticketList(client)).filter((ticket) => ticket.customer.name === customer);
}

/** 工单的状态变更（事件、目标状态、时刻），按写入先后 */
async function statusChanges(t: TestHarness, number: string) {
  const { rows } = await t.runtime.db.execute<{
    event: string;
    to_status: string;
    occurred_at: Date;
  }>(sql`
    SELECT c.event, c.to_status, c.occurred_at FROM ticket.status_change c
      JOIN ticket.ticket k ON k.id = c.ticket_id
     WHERE k.number = ${number} ORDER BY c.id`);
  return rows.map((r) => [r.event, r.to_status, new Date(r.occurred_at).toISOString()]);
}

/** 某位客户的应回复来信的 SLA 结果（按到达时间） */
async function slaResults(t: TestHarness, customer: string) {
  const { rows } = await t.runtime.db.execute<{ sla_result: string | null }>(sql`
    SELECT m.sla_result FROM ticket.ticket_message m
      JOIN channel.message c ON c.id = m.channel_message_id
     WHERE m.direction = 'inbound' AND c.sender_name = ${customer} ORDER BY m.received_at`);
  return rows.map((r) => r.sla_result);
}

/** 库里各类记录的条数：重跑前后比对 */
async function counts(t: TestHarness) {
  const { rows } = await t.runtime.db.execute<Record<string, number>>(sql`
    SELECT (SELECT count(*)::int FROM channel.message) AS messages,
           (SELECT count(*)::int FROM ticket.ticket) AS tickets,
           (SELECT count(*)::int FROM ticket.ticket_message) AS ticket_messages,
           (SELECT count(*)::int FROM ticket.status_change) AS status_changes,
           (SELECT count(*)::int FROM core.notification) AS notifications,
           (SELECT count(*)::int FROM core.work_notification) AS work_notifications`);
  return rows[0]!;
}

/** 某位客户的邮件入库了几封（不论方向） */
async function storedMailOf(t: TestHarness, address: string): Promise<number> {
  const { rows } = await t.runtime.db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM channel.message WHERE from_address = ${address} OR ${address} = ANY(to_addresses)`);
  return rows[0]!.n;
}

describe('AC-P1-13：近 90 天邮件回放（编号日期取首封来信日期；按邮件时间关闭与重开；无提醒、无通知）', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let amazon: FakeAmazonOrders;
  let agent: ApiClient;
  let before: Record<string, number>;
  let output: { exitCode: number; stdout: string; stderr: string };

  beforeAll(async () => {
    // 此刻 2026-09-11 10:20（北京时间）上线切换：T0 取此刻，回放 06-13 10:20 起到达的邮件
    t = await startTestHarness();
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    amazon = t.clients.fake(amazonOrdersClient);
    amazon.put(AUTO.id, {
      orderId: '113-2600001-0000001',
      createdAt: new Date('2026-07-15T10:00:00+08:00'),
      updatedAt: new Date('2026-07-15T10:00:00+08:00'),
    });
    // 上线前的历史邮件（邮箱还没开始监听，都不在增量里）
    gmail.deliver(
      amazonLetter(
        'Ava Chen',
        '2026-07-20T10:00:00+08:00',
        'The vacuum is broken.\n\nOrder ID: 113-2600001-0000001',
        '<ava-1@buyer.example>',
      ),
    );
    gmail.send(reply('Ava Chen', '2026-07-20T12:00:00+08:00', '<ava-1@buyer.example>'));
    gmail.deliver(
      amazonLetter(
        'Ava Chen',
        '2026-08-10T10:00:00+08:00',
        'Still broken.\n\nOrder ID: 113-2600001-0000001',
      ),
    );
    gmail.deliver(directLetter('Ben Ortiz', '2026-08-05T23:30:00+08:00'));
    gmail.deliver(directLetter('Cara Diaz', '2026-09-05T09:00:00+08:00'));
    // 收件地址没登记的来信：进未归属店铺队列（回放里不通知客服主管）
    gmail.deliver({
      to: 'amz-ca9@forcome.com',
      mailbox: DIRECT.mailbox,
      deliveredTo: 'amz-ca9@forcome.com',
      from: { name: 'Hana Kim', address: 'hana.kim@example.com' },
      subject: 'Where is my order?',
      text: 'Hello',
      at: '2026-08-15T09:00:00+08:00',
    });
    // 早于 90 天的不回放
    gmail.deliver(directLetter('Old Timer', '2026-06-01T09:00:00+08:00'));
    agent = await t.loginAs('坐席');
    before = await counts(t);
    output = await t.runMailReplay(['--confirm']);
  });

  afterAll(async () => {
    await t.close();
  });

  it('命令写明 T0 与回放区间、回放的封数，完成后开启实时处理', () => {
    expect(output.stderr).toBe('');
    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain(
      'T0 2026-09-11 10:20（北京时间）：回放 2026-06-13 10:20（北京时间） 至 T0 之前到达的邮件（近 90 天）',
    );
    expect(output.stdout).toContain('回放完成：共 6 封');
    expect(output.stdout).toContain('新入库来信 5 封、我方发信 1 封');
    expect(output.stdout).toContain('上线切换完成于 2026-09-11 10:20（北京时间）');
  });

  it('工单编号的日期取首封来信日期（北京时间）；早于 90 天的邮件不回放', async () => {
    expect((await ticketsOf(agent, 'Ava Chen')).map((x) => x.number)).toEqual(['T-20260720-0001']);
    expect((await ticketsOf(agent, 'Ben Ortiz')).map((x) => x.number)).toEqual(['T-20260805-0001']);
    expect((await ticketsOf(agent, 'Cara Diaz')).map((x) => x.number)).toEqual(['T-20260905-0001']);
    expect(await ticketsOf(agent, 'Old Timer')).toEqual([]);
  });

  it('归并、关闭、重开按邮件时间：回复转等客户，7 天无来信关闭，同一订单来信重开，14 天无新来信关闭', async () => {
    expect(await statusChanges(t, 'T-20260720-0001')).toEqual([
      ['inbound', 'awaiting_reply', iso('2026-07-20T10:00:00+08:00')],
      ['reply_detected', 'awaiting_customer', iso('2026-07-20T12:00:00+08:00')],
      // 最近来信 07-20 10:00 + 7 天，实时 worker 在那一分钟扫到
      ['idle_7_days', 'closed', iso('2026-07-27T10:00:00+08:00')],
      // 关闭 14 天后同一订单来信：重开（R-TK-01 的 30 天按关闭时刻比）
      ['inbound_reopen', 'awaiting_reply', iso('2026-08-10T10:00:00+08:00')],
      ['idle_14_days', 'closed', iso('2026-08-24T10:00:00+08:00')],
    ]);
    expect(await statusChanges(t, 'T-20260805-0001')).toEqual([
      ['inbound', 'awaiting_reply', iso('2026-08-05T23:30:00+08:00')],
      ['idle_14_days', 'closed', iso('2026-08-19T23:30:00+08:00')],
    ]);
  });

  it('历史来信照常计算首次回复与 SLA（R-SL-08）：2 小时回复达标，没回复的过了截止计未达标', async () => {
    expect(await slaResults(t, 'Ava Chen')).toEqual(['met', 'missed']);
    expect(await slaResults(t, 'Ben Ortiz')).toEqual(['missed']);
    // T0 时仍未回复：截止 09-06 09:00 已过，回放补扫到 T0 时计未达标，工单留在待回复
    expect(await slaResults(t, 'Cara Diaz')).toEqual(['missed']);
    expect((await ticketsOf(agent, 'Cara Diaz'))[0]!.status).toBe('awaiting_reply');
  });

  it('回放模式下没有产生任何提醒或通知：未归属店铺来信照常进队列，但站内通知与钉钉工作通知都没有新增', async () => {
    const after = await counts(t);
    expect(after.notifications).toBe(before.notifications);
    expect(after.work_notifications).toBe(before.work_notifications);
    const { rows } = await t.runtime.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM channel.message WHERE store_id IS NULL AND from_address = 'hana.kim@example.com'`);
    expect(rows[0]!.n).toBe(1);
  });

  it('T0 时仍未回复的来信所在工单受 14 天规则约束：最近一封来信 + 14 天后由实时扫描关闭（未识别到回复）', async () => {
    const scanAt = async (at: string) => {
      t.clock.set(at);
      await t.enqueue(ticketTimeLimitsJob, {});
      await t.runJobs();
    };
    await scanAt('2026-09-19T08:59:00+08:00');
    expect((await statusChanges(t, 'T-20260905-0001')).map(([event]) => event)).toEqual([
      'inbound',
    ]);
    await scanAt('2026-09-19T09:00:00+08:00');
    expect(await statusChanges(t, 'T-20260905-0001')).toEqual([
      ['inbound', 'awaiting_reply', iso('2026-09-05T09:00:00+08:00')],
      ['idle_14_days', 'closed', iso('2026-09-19T09:00:00+08:00')],
    ]);
    const { rows } = await t.runtime.db.execute<{ close_reason: string }>(sql`
      SELECT close_reason FROM ticket.ticket WHERE number = 'T-20260905-0001'`);
    expect(rows).toEqual([{ close_reason: 'reply_not_detected' }]);
  });

  it('重跑幂等：已完成的再执行只报告；中断在任意处后再执行，已入库的邮件跳过，不产生重复的工单、消息与状态变更', async () => {
    const settled = await counts(t);
    const again = await t.runMailReplay(['--confirm']);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toBe(
      '上线切换已完成：T0 2026-09-11 10:20（北京时间），完成于 2026-09-11 10:20（北京时间）；不再回放（T0 之后的邮件由 worker 实时收取）。\n',
    );
    // 模拟回放中途中断：清单没列完、一封也没记成回放完
    await t.runtime.db.execute(
      sql`UPDATE channel.mail_cutover SET completed_at = NULL, listed_at = NULL`,
    );
    await t.runtime.db.execute(sql`UPDATE channel.mail_replay_item SET replayed_at = NULL`);
    const resumed = await t.runMailReplay(['--confirm']);
    expect(resumed.exitCode).toBe(0);
    expect(resumed.stdout).toContain('接着上次的回放：T0 2026-09-11 10:20（北京时间）。');
    expect(resumed.stdout).toContain('新入库来信 0 封、我方发信 0 封');
    expect(await counts(t)).toEqual(settled);
    const { rows } = await t.runtime.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM channel.mail_replay_item`,
    );
    expect(rows[0]!.n).toBe(6);
  });
});

describe('T0 交界：回放与 T0 之后的实时来信不丢不重', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let agent: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness({ now: '2026-09-11T08:00:00+08:00' });
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    agent = await t.loginAs('坐席');
  });

  afterAll(async () => {
    await t.close();
  });

  it('T0 前 watch；T0 之前到达的回放、之后的交给实时同步；watch 之后、T0 之前到达的两边都看得到，只入库一次；回放后才到的早于 T0 的信也不丢', async () => {
    gmail.deliver(directLetter('Dan Park', '2026-09-01T10:00:00+08:00'));
    // 08:00 系统开始监听（worker 给邮箱 watch）：之后到的信在增量里
    await t.runJobs();
    gmail.deliver(directLetter('Eli Ross', '2026-09-11T09:30:00+08:00'));
    gmail.deliver(directLetter('Fay Lin', '2026-09-11T10:10:00+08:00'));
    gmail.deliver({
      ...directLetter('Eli Ross', '2026-09-11T10:15:00+08:00'),
      text: 'Any update?',
    });

    t.clock.set('2026-09-11T10:20:00+08:00');
    const output = await t.runMailReplay(['--t0', '2026-09-11T10:00:00+08:00', '--confirm']);
    expect(output.stderr).toBe('');
    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain('回放完成：共 2 封');
    // 回放清单之后才到、到达时间早于 T0 的（例如对方服务器延迟投递）
    gmail.deliver(directLetter('Gus Hale', '2026-09-11T09:50:00+08:00'));

    // 切换完成，worker 起来：从 watch 的游标接着收
    await t.runJobs();

    for (const customer of ['Dan Park', 'Fay Lin', 'Gus Hale']) {
      expect(await ticketsOf(agent, customer)).toHaveLength(1);
    }
    for (const address of ['dan.park@example.com', 'fay.lin@example.com', 'gus.hale@example.com']) {
      expect(await storedMailOf(t, address)).toBe(1);
    }
    // T0 前回放的来信与 T0 后实时的来信归到同一张工单
    const [eli] = await ticketsOf(agent, 'Eli Ross');
    expect(await ticketsOf(agent, 'Eli Ross')).toHaveLength(1);
    expect(await storedMailOf(t, 'eli.ross@example.com')).toBe(2);
    // 回放的这封按邮件时间新建；T0 之后的这封由实时同步追加（已在待回复，状态不变、不记状态变更）
    expect(await statusChanges(t, eli!.number)).toEqual([
      ['inbound', 'awaiting_reply', iso('2026-09-11T09:30:00+08:00')],
    ]);
    expect(eli!.lastInboundAt).toBe(iso('2026-09-11T10:15:00+08:00'));
  });
});

describe('切换的状态与命令的保护', () => {
  let t: TestHarness;
  let gmail: FakeGmail;

  beforeAll(async () => {
    t = await startTestHarness({ now: '2026-09-11T10:20:00+08:00' });
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
  });

  afterAll(async () => {
    await t.close();
  });

  const cutoverRows = async () => {
    const { rows } = await t.runtime.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM channel.mail_cutover`,
    );
    return rows[0]!.n;
  };

  it('没有切换记录时生产环境为待切换（不实时收信）、其余环境为已切换', async () => {
    expect(await mailCutoverStatus(t.runtime.db, 'production')).toBe('pending');
    expect(await mailCutoverStatus(t.runtime.db, 'staging')).toBe('live');
    expect(await mailCutoverStatus(t.runtime.db, 'test')).toBe('live');
  });

  it('参数不对退出码 2；不加 --confirm 只看计划、什么也不动', async () => {
    expect((await t.runMailReplay(['--t0', '2026-11-01'])).exitCode).toBe(2);
    expect((await t.runMailReplay(['--again'])).exitCode).toBe(2);

    const plan = await t.runMailReplay(['--t0', '2026-09-11T10:00:00+08:00']);
    expect(plan.exitCode).toBe(0);
    expect(plan.stdout).toContain('计划（不加 --confirm 只看计划，不执行）：');
    expect(plan.stdout).toContain(
      'T0 2026-09-11 10:00（北京时间）：回放 2026-06-13 10:00（北京时间） 至 T0 之前到达的邮件（近 90 天）',
    );
    expect(plan.stdout).toContain(
      `  ${AUTO.mailbox}：还没开始监听（执行时先开始监听）——晚于 T0，执行会被拒绝`,
    );
    expect(plan.stdout).toContain('worker：没有运行');
    expect(await cutoverRows()).toBe(0);
    const { rows } = await t.runtime.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM channel.mailbox_sync`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('worker 在连着就拒绝；T0 晚于现在、早于邮箱开始监听都拒绝，不进入回放', async () => {
    const busy = await t.runMailReplay(['--confirm'], { workerRunning: true });
    expect(busy.exitCode).toBe(1);
    expect(busy.stderr).toContain('worker 正在运行');

    const future = await t.runMailReplay(['--t0', '2026-09-11T11:00:00+08:00', '--confirm']);
    expect(future.exitCode).toBe(1);
    expect(future.stderr).toContain('T0 不能晚于现在');

    // 上一次执行已给邮箱 watch（10:20）：T0 取 10:00 会漏掉 10:00 到 10:20 之间的信
    const early = await t.runMailReplay(['--t0', '2026-09-11T10:00:00+08:00', '--confirm']);
    expect(early.exitCode).toBe(1);
    expect(early.stderr).toContain(`${AUTO.mailbox}：2026-09-11 10:20（北京时间）`);
    expect(await cutoverRows()).toBe(0);
  });

  it('断点续跑：途中停下（worker 连上了）后回放中、实时同步不入库；再执行接着回放，完成后实时同步才收', async () => {
    gmail.deliver(directLetter('Ivy Moss', '2026-09-01T10:00:00+08:00'));
    gmail.deliver(directLetter('Jon Reyes', '2026-09-02T10:00:00+08:00'));
    t.clock.set('2026-09-11T10:30:00+08:00');
    let checks = 0;
    const stopped = await t.runMailReplay(['--confirm'], {
      pageSize: 1,
      // 开始时没有，回放完第一批后 worker 连上了
      workerRunning: () => checks++ > 0,
    });
    expect(stopped.exitCode).toBe(1);
    expect(stopped.stderr).toContain('worker 在回放途中连上了');
    expect(await mailCutoverStatus(t.runtime.db, 'test')).toBe('replaying');
    expect(await storedMailOf(t, 'ivy.moss@example.com')).toBe(1);
    expect(await storedMailOf(t, 'jon.reyes@example.com')).toBe(0);

    // 回放中：实时同步不入库（T0 之后到的信等切换完成）
    gmail.deliver(directLetter('Kim Lee', '2026-09-11T10:40:00+08:00'));
    await t.runJobs();
    expect(await storedMailOf(t, 'kim.lee@example.com')).toBe(0);

    const resumed = await t.runMailReplay(['--confirm']);
    expect(resumed.exitCode).toBe(0);
    expect(resumed.stdout).toContain('接着上次的回放：T0 2026-09-11 10:30（北京时间）。');
    expect(resumed.stdout).toContain('回放完成：共 2 封，这次回放 1 封');
    expect(await storedMailOf(t, 'jon.reyes@example.com')).toBe(1);
    expect(await mailCutoverStatus(t.runtime.db, 'production')).toBe('live');

    await t.runJobs();
    expect(await storedMailOf(t, 'kim.lee@example.com')).toBe(1);
    expect(await storedMailOf(t, 'ivy.moss@example.com')).toBe(1);
  });
});
