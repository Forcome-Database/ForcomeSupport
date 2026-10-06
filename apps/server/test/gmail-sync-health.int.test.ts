import {
  auditLogSchema,
  channelAlertsSchema,
  channelSettingsSchema,
  connectionTestResultSchema,
  notificationListSchema,
  type ChannelCard,
  type ConnectionStatus,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChannelFeeds, gmailPollJob, gmailRenewWatchJob } from '../src/modules/channel';
import { sendWorkNotificationsJob } from '../src/modules/core';
import {
  dingtalkClient,
  gmailClient,
  type FakeGmail,
  type FakeMailInput,
} from '../src/modules/integration';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * Gmail 同步健壮性与连接状态（待办 09；规格 channel「Gmail 客户端」、「Fake 故障注入」，PRD 6.9、E-02、11.4、G4、K7、K20、P27「第一阶段」）：
 * 往 Fake Gmail 放信、注入故障（游标过期、调用失败）→ 推进时钟、跑完任务 → 以管理员、客服主管、坐席的身份看 P18 的 Gmail 卡与店铺表、
 * 全站横幅接口、站内通知、钉钉工作通知与审计。同一个库上的用例按顺序进行，时钟前后相接。
 */

const stores = getDemoFixture().stores;
const AUTO = stores.find((s) => s.name === 'Forcome Auto')!;
const MX = stores.find((s) => s.name === 'forcome.mx')!;
const MAILBOXES = stores.map((s) => s.mailbox).sort();

let t: TestHarness;
let gmail: FakeGmail;
let admin: ApiClient;
let supervisor: ApiClient;
let agent: ApiClient;

let letterNo = 0;
/** 一封客户来信，到达时间为此刻（各封主题不同，便于按主题核对） */
function letter(to: FakeMailInput['to'], overrides: Partial<FakeMailInput> = {}): FakeMailInput {
  letterNo += 1;
  return {
    to,
    from: { name: `Customer ${letterNo}`, address: `customer${letterNo}@example.com` },
    subject: `Where is my order ${letterNo}`,
    text: 'I have not received my order yet.',
    at: t.clock.now(),
    ...overrides,
  };
}

async function settings(client: ApiClient = admin) {
  const res = await client.get('/api/channel/settings');
  expect(res.status).toBe(200);
  return channelSettingsSchema.parse(await res.json());
}

async function gmailCard(): Promise<ChannelCard> {
  const card = (await settings()).channels.find((c) => c.kind === 'gmail');
  if (!card) throw new Error('没有 Gmail 卡');
  return card;
}

/** 店铺表「状态」列里该店铺的 Gmail 状态 */
async function storeGmailStatus(name: string): Promise<ConnectionStatus | undefined> {
  const store = (await settings()).stores.find((s) => s.name === name);
  return store?.connections.find((c) => c.kind === 'gmail')?.status;
}

async function alerts(client: ApiClient) {
  const res = await client.get('/api/channel/alerts');
  expect(res.status).toBe(200);
  return channelAlertsSchema.parse(await res.json()).alerts;
}

/** 示例数据里已有的通知（G10 的示例，周敏有一对 Gmail 连接异常与恢复）：只看测试里新产生的 */
const demoNotices = new Set<string>();

async function noticeItems(client: ApiClient) {
  const res = await client.get('/api/notifications');
  return notificationListSchema.parse(await res.json()).items;
}

/** 某人收到的 Gmail 连接异常与恢复通知（新的在前，不含示例数据里的） */
async function channelNotices(client: ApiClient) {
  return (await noticeItems(client))
    .filter((n) => n.type === 'channel_disconnected' || n.type === 'channel_recovered')
    .filter((n) => !demoNotices.has(n.id))
    .map((n) => ({ type: n.type, title: n.title, body: n.body, object: n.object }));
}

const subjects = async (mailbox: string) =>
  (await t.receivedMail({ mailbox })).map((m) => m.subject);

/** 跑完任务（有失败也不抛，测试故障场景） */
const runAllowingFailures = () => t.runJobs({ allowFailures: true });

/**
 * 每 5 分钟的兜底同步：给每个邮箱排一次同步再跑完。Gmail 卡的「最近同步」取各邮箱中最旧的一次，
 * 用例里让其余邮箱同时前进，卡上的时刻就只取决于被测的那个邮箱
 */
async function pollAll(options: { allowFailures?: boolean } = {}) {
  await t.enqueue(gmailPollJob, {});
  return t.runJobs(options);
}

beforeAll(async () => {
  t = await startTestHarness();
  await t.loadFixtures();
  gmail = t.clients.fake(gmailClient);
  // 钉钉的示例通讯录：工作通知发给成员、「测试连接」取根部门
  t.clients.fake(dingtalkClient).replay(getDemoFixture());
  admin = await t.loginAs('管理员');
  supervisor = await t.loginAs('客服主管');
  agent = await t.loginAs('坐席');
  for (const client of [admin, supervisor, agent]) {
    for (const item of await noticeItems(client)) demoNotices.add(item.id);
  }
});

afterAll(async () => {
  await t.close();
});

describe('Gmail 同步健壮性与连接状态', () => {
  it('开始监听前为未连接；watch 后立即同步一次，四个邮箱都记下最近同步时间，Gmail 卡与店铺表为已连接（6.9、K20）', async () => {
    const before = await gmailCard();
    expect(before).toMatchObject({ status: 'not_connected', lastSyncAt: null, issues: [] });

    await t.runJobs();
    for (const mailbox of MAILBOXES) expect(gmail.isWatched(mailbox)).toBe(true);
    expect(await gmailCard()).toMatchObject({
      status: 'connected',
      simulated: true,
      lastSyncAt: t.clock.now().toISOString(),
      issues: [],
    });
    for (const store of stores) expect(await storeGmailStatus(store.name)).toBe('connected');
    expect(await alerts(agent)).toEqual([]);
  });

  it('超过 10 分钟没有同步成功为同步延迟，Gmail 卡列出延迟的邮箱；每 5 分钟的 history.list 兜底同步后回到已连接（6.9）', async () => {
    const syncedAt = (await gmailCard()).lastSyncAt;
    t.clock.advance({ minutes: 10 });
    expect((await gmailCard()).status).toBe('connected');

    t.clock.advance({ minutes: 1 });
    const delayed = await gmailCard();
    expect(delayed).toMatchObject({ status: 'delayed', lastSyncAt: syncedAt });
    expect(delayed.issues).toEqual(
      MAILBOXES.map((target) => ({
        target,
        status: 'delayed',
        lastSuccessAt: syncedAt,
        failingSince: null,
        failures: 0,
      })),
    );
    expect(await storeGmailStatus(MX.name)).toBe('delayed');
    // 同步延迟不出全站横幅（只有连接异常才出，G4）
    expect(await alerts(agent)).toEqual([]);

    // 定时的兜底同步：没有新信也算一次同步成功
    await t.enqueue(gmailPollJob, {});
    await t.runJobs();
    expect(await gmailCard()).toMatchObject({
      status: 'connected',
      lastSyncAt: t.clock.now().toISOString(),
      issues: [],
    });
  });

  it('游标过期（Fake 故障注入）→ 按 internalDate 区间补拉 → 补拉期间最近同步时间不前移 → 补拉完成后前移，之后照常增量同步（规格「Fake 故障注入」、ADR 0008）', async () => {
    t.clock.advance({ minutes: 3 });
    await pollAll();
    const syncedAt = (await gmailCard()).lastSyncAt;
    expect(syncedAt).toBe(t.clock.now().toISOString());
    t.clock.advance({ minutes: 1 });
    const early = letter(AUTO.mailbox);
    gmail.deliver(early);
    // history.list 返回 404（游标过期）；补拉取第一封原文时又失败一次，补拉中断
    gmail.faults.failNext({ kind: 'cursor_expired' }, { operation: 'users.history.list' });
    gmail.faults.failNext({ kind: 'error', status: 500 }, { operation: 'users.messages.get' });
    const interrupted = await runAllowingFailures();
    expect(interrupted.failed).toHaveLength(1);
    expect(gmail.faults.calls).toContain('users.getProfile');
    expect(gmail.faults.calls).toContain('users.messages.list');
    // 补拉没完成：最近同步时间不前移，那封信还没入库
    expect((await gmailCard()).lastSyncAt).toBe(syncedAt);
    expect(await subjects(AUTO.mailbox)).not.toContain(early.subject);

    // 补拉期间又到一封；兜底同步时补拉又中断一次：其余邮箱同步成功、时刻前进，这个邮箱的最近同步时间仍不前移
    t.clock.advance({ minutes: 1 });
    const during = letter(AUTO.mailbox);
    gmail.deliver(during);
    gmail.faults.failNext({ kind: 'timeout' }, { operation: 'users.messages.get', times: 2 });
    await pollAll({ allowFailures: true });
    expect((await gmailCard()).lastSyncAt).toBe(syncedAt);
    expect(await subjects(AUTO.mailbox)).not.toContain(during.subject);

    t.clock.advance({ minutes: 1 });
    gmail.faults.reset();
    await pollAll();
    // 补拉完成：两封都入库、各一次，最近同步时间前移到此刻
    expect(await subjects(AUTO.mailbox)).toEqual(
      expect.arrayContaining([early.subject, during.subject]),
    );
    expect((await subjects(AUTO.mailbox)).filter((s) => s === early.subject)).toHaveLength(1);
    expect(await gmailCard()).toMatchObject({
      status: 'connected',
      lastSyncAt: t.clock.now().toISOString(),
    });

    // 新游标照常增量：之后的信经 history.list 取到，补拉过的不重复入库
    t.clock.advance({ minutes: 1 });
    const later = letter(AUTO.mailbox);
    gmail.deliver(later);
    await t.runJobs();
    const all = await subjects(AUTO.mailbox);
    expect(all).toContain(later.subject);
    expect(all.filter((s) => s === during.subject)).toHaveLength(1);
  });

  it('「已发送」里的我方回信入库，方向为我方、店铺为发件邮箱的店铺，不建工单（规格「已发送也同步」）', async () => {
    t.clock.advance({ minutes: 1 });
    const customer = 'olivia.sent@example.com';
    gmail.send({
      from: AUTO.mailbox,
      to: customer,
      subject: 'Re: Where is my parcel',
      text: 'Your parcel is on the way.',
      at: t.clock.now(),
    });
    await t.runJobs();
    const sent = (await t.receivedMail({ mailbox: AUTO.mailbox })).find(
      (m) => m.subject === 'Re: Where is my parcel',
    );
    expect(sent).toMatchObject({
      direction: 'outbound',
      storeId: AUTO.id,
      from: { address: AUTO.mailbox },
      recognition: null,
    });
    // 我方发出的信不是来信：不建工单（归到工单与回复识别随 16）
    const tickets = await agent.get('/api/tickets');
    const body = (await tickets.json()) as { tickets: { subject: string }[] };
    expect(body.tickets.map((ticket) => ticket.subject)).not.toContain('Re: Where is my parcel');
  });

  it('持久化失败时水位不前进（故障注入）：失败那封与之后的信下次都补上，已入库的不重复；我们自己的错误不算连接失败', async () => {
    t.clock.advance({ minutes: 1 });
    await pollAll();
    const syncedAt = (await gmailCard()).lastSyncAt;
    // 数据库拒绝写入主题为 POISON 的来信（模拟入库失败）
    await t.runtime.db.execute(sql`
      CREATE FUNCTION channel.test_reject_poison() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.subject = 'POISON' THEN RAISE EXCEPTION '测试：拒绝写入'; END IF;
        RETURN NEW;
      END $$`);
    await t.runtime.db.execute(sql`
      CREATE TRIGGER test_reject_poison BEFORE INSERT ON channel.message
      FOR EACH ROW EXECUTE FUNCTION channel.test_reject_poison()`);
    const first = letter(MX.mailbox);
    const poison = letter(MX.mailbox, { subject: 'POISON' });
    const after = letter(MX.mailbox);
    gmail.deliver(first);
    gmail.deliver(poison);
    gmail.deliver(after);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      t.clock.advance({ minutes: 1 });
      const report = await pollAll({ allowFailures: true });
      expect(report.failed.map((f) => f.data)).toEqual([{ mailbox: MX.mailbox }]);
    }
    // 失败那封之前的已入库；它与之后的都没有；最近同步时间不前移，也不算连接失败（不出横幅）
    expect(await subjects(MX.mailbox)).toContain(first.subject);
    expect(await subjects(MX.mailbox)).not.toContain('POISON');
    expect(await subjects(MX.mailbox)).not.toContain(after.subject);
    const card = await gmailCard();
    expect(card.lastSyncAt).toBe(syncedAt);
    expect(card.status).toBe('connected');
    expect(await alerts(agent)).toEqual([]);

    await t.runtime.db.execute(sql`DROP TRIGGER test_reject_poison ON channel.message`);
    await t.runtime.db.execute(sql`DROP FUNCTION channel.test_reject_poison()`);
    t.clock.advance({ minutes: 1 });
    await pollAll();
    const all = await subjects(MX.mailbox);
    expect(all.filter((s) => s === first.subject)).toHaveLength(1);
    expect(all).toContain('POISON');
    expect(all).toContain(after.subject);
    expect((await gmailCard()).lastSyncAt).toBe(t.clock.now().toISOString());
  });

  it('某个邮箱连续 3 次失败进入连接异常：横幅接口返回异常、Gmail 卡列出该邮箱、管理员与客服主管收到通知（含钉钉工作通知）、记审计；恢复后回到已连接、横幅消失、收到「Gmail 已恢复」（E-02、G4、K7、11.4）', async () => {
    t.clock.advance({ minutes: 1 });
    await pollAll();
    const syncedAt = (await gmailCard()).lastSyncAt;
    t.clock.advance({ minutes: 1 });
    const failingFrom = t.clock.now().toISOString();
    // 只有 support@forcome.mx 有新信要同步：它的 history.list 连续失败
    gmail.faults.failNext(
      { kind: 'error', status: 403, message: 'Delegation denied' },
      { operation: 'users.history.list', times: 4 },
    );
    const waiting = letter(MX.mailbox);
    gmail.deliver(waiting);

    // 第 1、2 次失败：还在 10 分钟内，仍是已连接，没有横幅与通知
    await runAllowingFailures();
    t.clock.advance({ minutes: 1 });
    await runAllowingFailures();
    expect((await gmailCard()).status).toBe('connected');
    expect(await alerts(agent)).toEqual([]);
    expect(await channelNotices(admin)).toEqual([]);

    // 第 3 次：连接异常
    t.clock.advance({ minutes: 1 });
    await runAllowingFailures();
    const card = await gmailCard();
    expect(card.status).toBe('error');
    expect(card.issues).toEqual([
      {
        target: MX.mailbox,
        status: 'error',
        lastSuccessAt: syncedAt,
        failingSince: failingFrom,
        failures: 3,
      },
    ]);
    expect(await storeGmailStatus(MX.name)).toBe('error');
    expect(await storeGmailStatus(AUTO.name)).toBe('connected');
    // 全站横幅：所有登录成员都看得到（「查看渠道状态」只对管理员显示由前端决定）
    for (const client of [agent, supervisor, admin]) {
      expect(await alerts(client)).toEqual([
        { kind: 'gmail', targets: [MX.mailbox], since: failingFrom },
      ]);
    }
    const disconnected = {
      type: 'channel_disconnected',
      title: 'Gmail 连接异常',
      body: 'support@forcome.mx 连续 3 次失败，来信暂存',
      object: { type: 'channel', id: 'gmail', label: 'P18 · Gmail' },
    };
    expect(await channelNotices(admin)).toEqual([disconnected]);
    expect(await channelNotices(supervisor)).toEqual([disconnected]);
    expect(await channelNotices(agent)).toEqual([]);
    // 审计「连接异常」（操作人系统，P27「渠道」对象）
    const [audit] = await t.auditRecords({ action: 'channel.disconnected' });
    expect(audit).toMatchObject({
      actorType: 'system',
      objectType: 'channel',
      objectId: `gmail:${MX.mailbox}`,
      objectLabel: 'Gmail · support@forcome.mx',
    });
    const p27 = auditLogSchema.parse(
      await (await admin.get('/api/audit?period=today&type=channel')).json(),
    );
    expect(
      p27.entries.map((row) => [row.objectLabel, row.actionLabel, row.summary]),
    ).toContainEqual([
      'Gmail · support@forcome.mx',
      '连接异常',
      '状态：已连接 → 连接异常（连续 3 次失败）',
    ]);

    // 第 4 次失败：不再重复通知
    await runAllowingFailures();
    expect(await channelNotices(admin)).toHaveLength(1);
    expect((await gmailCard()).issues[0]?.failures).toBe(4);

    // 恢复：同步成功，自动补拉断开期间的来信（其余邮箱同时兜底同步，卡上的时刻取最旧的一个）
    await pollAll();
    expect(await subjects(MX.mailbox)).toContain(waiting.subject);
    expect(await gmailCard()).toMatchObject({
      status: 'connected',
      lastSyncAt: t.clock.now().toISOString(),
      issues: [],
    });
    expect(await storeGmailStatus(MX.name)).toBe('connected');
    for (const client of [agent, supervisor, admin]) expect(await alerts(client)).toEqual([]);
    const recovered = {
      type: 'channel_recovered',
      title: 'Gmail 已恢复',
      body: 'support@forcome.mx 已重新连接，补拉 1 封来信',
      object: { type: 'channel', id: 'gmail', label: 'P18 · Gmail' },
    };
    expect(await channelNotices(admin)).toEqual([recovered, disconnected]);
    expect(await channelNotices(supervisor)).toEqual([recovered, disconnected]);
    const p27After = auditLogSchema.parse(
      await (await admin.get('/api/audit?period=today&type=channel')).json(),
    );
    const recoveredRow = p27After.entries.find((row) => row.actionLabel === '恢复连接');
    expect(recoveredRow?.summary).toBe('状态：连接异常 → 已连接（补拉 1 封来信）');
    // 连接异常另发钉钉工作通知（11.4，同一接收人 5 分钟合并后发出）；恢复只发站内
    t.clock.advance({ minutes: 6 });
    await t.enqueue(sendWorkNotificationsJob, {});
    await t.runJobs();
    const texts = t.clients
      .fake(dingtalkClient)
      .sent.map((n) => n.text)
      .join('\n');
    expect(texts).toContain('Gmail 连接异常');
    expect(texts).not.toContain('Gmail 已恢复');
    expect(recoveredRow?.fields.map((f) => [f.label, f.before, f.after])).toEqual([
      ['状态', '连接异常', '已连接'],
      ['最近同步成功', expect.any(String), expect.any(String)],
      [
        '补拉',
        '—',
        expect.stringMatching(/^1 封来信（\d\d:\d\d–\d\d:\d\d 到达，SLA 按原到达时间）$/),
      ],
      ['触发', '连续 4 次失败', '第 5 次重试成功'],
    ]);
  });

  it('开始监听（watch）失败也算一次失败；新登记的邮箱连续 3 次 watch 失败同样进入连接异常', async () => {
    gmail.faults.reset();
    // 让新邮箱的 watch 一直失败，管理员登记一个新店铺
    gmail.faults.failNext({ kind: 'error', status: 401 }, { operation: 'users.watch', times: 3 });
    const res = await admin.post('/api/channel/stores', {
      name: '测试 watch 店铺',
      platform: 'shopify',
      sites: ['US'],
      defaultSite: 'US',
      mailboxes: ['watch-test@forcome.test'],
      platformId: 'watch-test.myshopify.com',
    });
    expect(res.status).toBe(201);
    await t.runJobs();
    expect(gmail.isWatched('watch-test@forcome.test')).toBe(false);
    expect(await storeGmailStatus('测试 watch 店铺')).toBe('not_connected');
    // 按退避重试（1 分钟起翻倍）
    t.clock.advance({ minutes: 1 });
    await t.runJobs();
    t.clock.advance({ minutes: 2 });
    await t.runJobs();
    expect(await storeGmailStatus('测试 watch 店铺')).toBe('error');
    expect((await alerts(agent))[0]?.targets).toEqual(['watch-test@forcome.test']);
    // 第 4 次成功：开始监听并立即同步，恢复
    t.clock.advance({ minutes: 4 });
    await t.runJobs();
    expect(gmail.isWatched('watch-test@forcome.test')).toBe(true);
    expect(await storeGmailStatus('测试 watch 店铺')).toBe('connected');
    expect(await alerts(agent)).toEqual([]);
  });

  it('每天续订各邮箱的 watch（不动游标）；续订失败记进同步记录', async () => {
    t.clock.advance({ days: 1 });
    await pollAll();
    gmail.faults.reset();
    await t.enqueue(gmailRenewWatchJob, {});
    await t.runJobs();
    const watched = (await settings()).stores.flatMap((s) => s.mailboxes);
    expect(gmail.faults.calls.filter((c) => c === 'users.watch')).toHaveLength(watched.length);

    // 续订后增量同步照常（游标没被续订跳过）
    await t.enqueue(gmailPollJob, {});
    await t.runJobs();
    const mail = letter(AUTO.mailbox);
    gmail.deliver(mail);
    await t.runJobs();
    expect(await subjects(AUTO.mailbox)).toContain(mail.subject);

    gmail.faults.failNext({ kind: 'timeout' }, { operation: 'users.watch' });
    await t.enqueue(gmailRenewWatchJob, {});
    const report = await runAllowingFailures();
    expect(report.failed.map((f) => f.name)).toContain('channel.gmail_renew_watch');
    expect((await gmailCard()).status).toBe('connected');
  });

  it('测试连接（K20，2026-10-06 用户确认）：Gmail 逐个邮箱试访问并立即排同步、不改连接状态；钉钉取根部门；只有管理员能测', async () => {
    gmail.faults.reset();
    t.clock.advance({ minutes: 11 });
    expect((await gmailCard()).status).toBe('delayed');

    const ok = await admin.post('/api/channel/connection-tests/gmail', {});
    expect(ok.status).toBe(200);
    const result = connectionTestResultSchema.parse(await ok.json());
    expect(result.kind).toBe('gmail');
    expect(result.targets).toEqual(expect.arrayContaining(MAILBOXES));
    // 测试连接本身不改状态；它排的同步跑完才回到已连接
    expect((await gmailCard()).status).toBe('delayed');
    await t.runJobs();
    expect((await gmailCard()).status).toBe('connected');

    // 访问不了的邮箱：502，写明哪个邮箱；不记失败、不改状态
    gmail.faults.failNext({ kind: 'error', status: 403 }, { operation: 'users.getProfile' });
    const failed = await admin.post('/api/channel/connection-tests/gmail', {});
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({
      error: 'connection_test_failed',
      message: `${MAILBOXES[0]} 无法访问`,
    });
    await t.runJobs();
    expect((await gmailCard()).issues).toEqual([]);

    const dingtalk = await admin.post('/api/channel/connection-tests/dingtalk', {});
    expect(dingtalk.status).toBe(200);
    expect(await dingtalk.json()).toEqual({ kind: 'dingtalk', targets: ['通讯录'] });
    t.clients.fake(dingtalkClient).faults.failNext({ kind: 'error', status: 500 });
    const dingtalkFailed = await admin.post('/api/channel/connection-tests/dingtalk', {});
    expect(dingtalkFailed.status).toBe(502);
    expect(await dingtalkFailed.json()).toEqual({
      error: 'connection_test_failed',
      message: '钉钉通讯录无法访问',
    });

    // 渠道与店铺只归管理员（10.1）
    expect((await supervisor.post('/api/channel/connection-tests/gmail', {})).status).toBe(403);
  });

  it('「重新检测」：开始监听失败、正在退避的邮箱，测试连接当场 watch 并同步，不用等退避', async () => {
    gmail.faults.reset();
    gmail.faults.failNext({ kind: 'error', status: 503 }, { operation: 'users.watch' });
    const res = await admin.post('/api/channel/stores', {
      name: '测试重新检测店铺',
      platform: 'shopify',
      sites: ['US'],
      defaultSite: 'US',
      mailboxes: ['recheck-test@forcome.test'],
      platformId: 'recheck-test.myshopify.com',
    });
    expect(res.status).toBe(201);
    await t.runJobs();
    expect(gmail.isWatched('recheck-test@forcome.test')).toBe(false);

    // 退避 1 分钟还没到，管理员点「重新检测」
    expect((await admin.post('/api/channel/connection-tests/gmail', {})).status).toBe(200);
    expect(gmail.isWatched('recheck-test@forcome.test')).toBe(true);
    await t.runJobs();
    expect(await storeGmailStatus('测试重新检测店铺')).toBe('connected');
  });

  it('同一封信发到两个邮箱、两个邮箱同时恢复：副本不算补拉的来信，另一个照写「补拉 0 封来信」（E1）', async () => {
    gmail.faults.reset();
    t.clock.advance({ minutes: 1 });
    await pollAll();
    const seen = new Set((await noticeItems(admin)).map((n) => n.id));
    const COM = stores.find((s) => s.name === 'forcome.com')!;
    gmail.faults.failNext({ kind: 'timeout' }, { operation: 'users.history.list', times: 6 });
    gmail.deliver(letter([MX.mailbox, COM.mailbox]));
    for (let round = 0; round < 3; round += 1) {
      t.clock.advance({ minutes: 1 });
      await runAllowingFailures();
    }
    expect((await alerts(agent))[0]?.targets).toEqual([COM.mailbox, MX.mailbox].sort());

    await pollAll();
    const recovered = (await noticeItems(admin))
      .filter((n) => n.type === 'channel_recovered' && !seen.has(n.id))
      .map((n) => n.body)
      .sort();
    // 先入库的一封为准（补拉 1 封），另一个邮箱收到的是它的副本（补拉 0 封）
    expect(recovered).toHaveLength(2);
    expect(recovered.filter((body) => body.endsWith('已重新连接，补拉 1 封来信'))).toHaveLength(1);
    expect(recovered.filter((body) => body.endsWith('已重新连接，补拉 0 封来信'))).toHaveLength(1);
    expect(await alerts(agent)).toEqual([]);
  });

  it('真实接口但没有配置 Google 凭据：不算连接失败，店铺的 Gmail 为未连接（6.9），不出横幅、不发通知', async () => {
    const before = await channelNotices(admin);
    const res = await admin.post('/api/channel/stores', {
      name: '测试未配置凭据店铺',
      platform: 'shopify',
      sites: ['US'],
      defaultSite: 'US',
      mailboxes: ['no-credentials@forcome.test'],
      platformId: 'no-credentials.myshopify.com',
      adapterMode: 'real',
    });
    expect(res.status).toBe(201);
    for (const minutes of [0, 1, 2, 4]) {
      t.clock.advance({ minutes });
      await t.runJobs();
    }
    expect(await storeGmailStatus('测试未配置凭据店铺')).toBe('not_connected');
    expect(await alerts(agent)).toEqual([]);
    expect(await channelNotices(admin)).toEqual(before);
    // Gmail 卡为最差的「未连接」，但没有异常的邮箱可列
    expect(await gmailCard()).toMatchObject({ status: 'not_connected', issues: [] });
  });
});

describe('生产环境没有配置 Google 凭据（用户 2026-10-04 口径：Google 资质还没有，验收返工）', () => {
  let p: TestHarness;
  let admin: ApiClient;

  beforeAll(async () => {
    // 只挂收信的常驻拉取：钉钉 Stream 在生产要凭据（钉钉资质已有，部署时必填），这里不测它
    p = await startTestHarness({ appEnv: 'production', feeds: (deps) => createChannelFeeds(deps) });
    admin = await p.loginAs('管理员');
  });

  afterAll(async () => {
    await p.close();
  });

  it('照常运行：店铺（真实接口）的 Gmail 与 Gmail 卡为未连接，没有异常的邮箱、不出横幅、不发通知；推送拉取安静跳过', async () => {
    const res = await admin.post('/api/channel/stores', {
      name: 'forcome.mx',
      platform: 'shopify',
      sites: ['MX'],
      defaultSite: 'MX',
      mailboxes: ['support@forcome.mx'],
      platformId: 'forcome-mx.myshopify.com',
    });
    expect(res.status).toBe(201);
    // 开始监听（按退避重试）、每 5 分钟的兜底同步、每天续订都跑几轮：都不抛错、不记失败
    for (const minutes of [0, 1, 2, 4, 8, 16]) {
      p.clock.advance({ minutes });
      await p.enqueue(gmailPollJob, {});
      await p.enqueue(gmailRenewWatchJob, {});
      await p.runJobs();
    }
    const data = channelSettingsSchema.parse(
      await (await admin.get('/api/channel/settings')).json(),
    );
    expect(data.channels.find((c) => c.kind === 'gmail')).toMatchObject({
      status: 'not_connected',
      simulated: false,
      lastSyncAt: null,
      issues: [],
    });
    expect(data.stores[0]?.connections.find((c) => c.kind === 'gmail')?.status).toBe(
      'not_connected',
    );
    const alertsRes = await admin.get('/api/channel/alerts');
    expect(channelAlertsSchema.parse(await alertsRes.json()).alerts).toEqual([]);
    const notices = notificationListSchema
      .parse(await (await admin.get('/api/notifications')).json())
      .items.filter((n) => n.type === 'channel_disconnected' || n.type === 'channel_recovered');
    expect(notices).toEqual([]);
    expect(await p.auditRecords({ objectType: 'channel' })).toEqual([]);
  });
});
