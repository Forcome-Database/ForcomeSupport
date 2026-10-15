import {
  amazonDomains,
  apiErrorSchema,
  auditLogSchema,
  channelAlertsSchema,
  channelSettingsSchema,
  connectionTestResultSchema,
  mailboxTestFailureSchema,
  mailboxTestResultSchema,
  notificationListSchema,
  storeSchema,
  ticketDetailSchema,
  ticketListSchema,
  type ChannelCard,
  type StoreMailboxInput,
  type TicketDetail,
  type TicketListItem,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { beginCutover, imapPollJob } from '../src/modules/channel';
import { toMilliseconds } from '../src/modules/core';
import {
  databaseCredentialVault,
  FIXTURE_MAILBOX_AUTH_CODE,
  imapClient,
  type FakeImap,
  type FakeMailInput,
} from '../src/modules/integration';
import type { ApiClient } from './api-client';
import { startTestHarness, TEST_CREDENTIAL_MASTER_KEY, type TestHarness } from './harness';

/*
 * 163 企业邮箱 IMAP 收信（待办 35；PRD D-28、6.9、R-TK-07、R-SL-08、E-02、11.4、P18、P27、AC-P1-23–25；ADR 0015）：
 * 示例数据里 Forcome Auto 的 amz-auto@forcome.com 是 163 企业邮箱（存了模拟授权码）。往 Fake IMAP 放信（收件箱 deliver、「已发送」send）、
 * 注入故障（认证失败、IP 限制、连不上、超时、IDLE 掉线、UIDVALIDITY 变化）→ 推进时钟、跑完任务（常驻拉取 channel.imap_idle 每轮拉一次）→
 * 经 P04、P05、P18、横幅、站内通知、P27 的接口断言。收信之后的流水线与 Gmail 同一条，所以这里只核对「从 IMAP 进来也一样」的那几处。
 */

const fixture = getDemoFixture();
const AUTO = fixture.stores.find((s) => s.name === 'Forcome Auto')!;
const ADDRESS = AUTO.mailbox;
const RELAY_US = amazonDomains.US.relay;
const slug = (buyer: string) => buyer.toLowerCase().replace(/\W+/g, '.');
const relayOf = (buyer: string) => `${slug(buyer)}@${RELAY_US}`;
const iso = (at: string | Date) => new Date(at).toISOString();
const MINUTE = toMilliseconds({ minutes: 1 });
const DAY = toMilliseconds({ days: 1 });

/** 亚马逊买家消息（经中转地址寄到 163 企业邮箱） */
function letter(
  buyer: string,
  at: string | Date,
  n = 1,
  text = `Hello from ${buyer}`,
): FakeMailInput {
  return {
    to: ADDRESS,
    from: { name: buyer, address: relayOf(buyer) },
    subject: 'Question about my order',
    text,
    at,
    messageId: `<${slug(buyer)}-${n}@buyer.example>`,
  };
}

/** 店铺邮箱「已发送」里的我方回复（163 企业邮箱没有线程，只靠 In-Reply-To 识别） */
function reply(buyer: string, at: string | Date, n = 1): Parameters<FakeImap['send']>[0] {
  return {
    from: ADDRESS,
    to: relayOf(buyer),
    subject: 'Re: Question about my order',
    text: `Hi ${buyer}`,
    at,
    headers: { 'In-Reply-To': `<${slug(buyer)}-${n}@buyer.example>` },
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

async function detailOf(client: ApiClient, customer: string): Promise<TicketDetail> {
  const tickets = await ticketsOf(client, customer);
  expect(tickets).toHaveLength(1);
  const res = await client.get(`/api/tickets/${tickets[0]!.number}`);
  expect(res.status).toBe(200);
  return ticketDetailSchema.parse(await res.json());
}

/** 这个邮箱入库了几封、各是什么（按到达时间） */
async function stored(t: TestHarness, subjectOrSender?: string) {
  return (await t.receivedMail({ mailbox: ADDRESS })).filter(
    (m) =>
      !subjectOrSender ||
      m.subject === subjectOrSender ||
      m.from.address === subjectOrSender ||
      m.recognition?.sender.name === subjectOrSender,
  );
}

/** 同步记录（直接查库：IMAP 游标、最近同步成功、连续失败） */
async function syncRow(t: TestHarness) {
  const { rows } = await t.runtime.db.execute<{
    imap_cursor: {
      inbox: { uidValidity: string; uid: number };
      sent: unknown;
      sentFolder: string | null;
    } | null;
    last_success_at: string | null;
    synced_through: string | null;
    consecutive_failures: number;
    watched_at: string | null;
  }>(sql`SELECT imap_cursor, last_success_at, synced_through, consecutive_failures, watched_at
    FROM channel.mailbox_sync WHERE address = ${ADDRESS}`);
  const row = rows[0];
  if (!row) return null;
  const date = (at: string | null) => (at === null ? null : new Date(at));
  return {
    ...row,
    last_success_at: date(row.last_success_at),
    synced_through: date(row.synced_through),
    watched_at: date(row.watched_at),
  };
}

async function settingsOf(client: ApiClient) {
  const res = await client.get('/api/channel/settings');
  expect(res.status).toBe(200);
  return channelSettingsSchema.parse(await res.json());
}

async function qiyeCard(client: ApiClient): Promise<ChannelCard> {
  return (await settingsOf(client)).channels.find((c) => c.kind === 'qiye163')!;
}

/** Forcome Auto 的店铺（P18 店铺表的一行） */
async function autoStore(client: ApiClient) {
  return (await settingsOf(client)).stores.find((s) => s.id === AUTO.id)!;
}

/** 编辑 Forcome Auto 的请求体：沿用其余字段，进线邮箱换成给的 */
async function autoUpdate(client: ApiClient, mailboxes: StoreMailboxInput[]) {
  const store = await autoStore(client);
  return {
    name: store.name,
    platform: store.platform,
    sites: store.sites,
    defaultSite: store.defaultSite,
    mailboxes,
    platformId: store.platformId,
    version: store.version,
  };
}

const QIYE_ROW: StoreMailboxInput = {
  address: ADDRESS,
  provider: 'qiye163',
  imapHost: 'imap.qiye.163.com',
  imapPort: 993,
};

describe('163 企业邮箱收信（Fake IMAP）', () => {
  let t: TestHarness;
  let imap: FakeImap;
  let admin: ApiClient;
  let supervisor: ApiClient;
  let agent: ApiClient;
  const demoNotices = new Set<string>();

  async function notices(client: ApiClient) {
    const res = await client.get('/api/notifications');
    return notificationListSchema
      .parse(await res.json())
      .items.filter((n) => n.type === 'channel_disconnected' || n.type === 'channel_recovered')
      .filter((n) => !demoNotices.has(n.id))
      .map((n) => ({ title: n.title, body: n.body, object: n.object }));
  }

  /** 每 5 分钟的检查：给已开始监听的 163 企业邮箱排一次同步再跑完 */
  async function poll() {
    await t.enqueue(imapPollJob, {});
    return t.runJobs({ allowFailures: true });
  }

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    imap = t.clients.fake(imapClient);
    admin = await t.loginAs('管理员');
    supervisor = await t.loginAs('客服主管');
    agent = await t.loginAs('坐席');
    for (const client of [admin, supervisor]) {
      const res = await client.get('/api/notifications');
      for (const item of notificationListSchema.parse(await res.json()).items) {
        demoNotices.add(item.id);
      }
    }
  });

  afterAll(async () => {
    await t.close();
  });

  describe('入库、识别、归并与回复识别', () => {
    it('开始监听：常驻拉取记下收件箱与「已发送」的位置、在收件箱上 IDLE，立即同步一次；163 企业邮箱卡与店铺表为已连接', async () => {
      expect(await qiyeCard(admin)).toMatchObject({ status: 'not_connected', lastSyncAt: null });
      // 开始监听前就在邮箱里的信不在增量里（历史邮件由回放导入）
      imap.deliver(letter('Before Listening', new Date(t.clock.now().getTime() - 2 * 60 * MINUTE)));
      await t.runJobs();
      expect(imap.isListening(ADDRESS)).toBe(true);
      expect(imap.idleConnections(ADDRESS)).toBe(1);
      const row = await syncRow(t);
      expect(row?.imap_cursor).toMatchObject({
        inbox: { uid: 1 },
        sent: { uid: 0 },
        sentFolder: '已发送',
      });
      expect(row?.watched_at?.toISOString()).toBe(t.clock.now().toISOString());
      expect(row?.last_success_at?.toISOString()).toBe(t.clock.now().toISOString());
      expect(await stored(t)).toEqual([]);
      expect(await qiyeCard(admin)).toMatchObject({
        status: 'connected',
        simulated: true,
        lastSyncAt: t.clock.now().toISOString(),
        issues: [],
      });
      expect((await autoStore(admin)).connections).toEqual([
        { kind: 'qiye163', status: 'connected' },
        { kind: 'orders', status: 'not_connected' },
      ]);
      // Gmail 卡不算它
      const gmailCard = (await settingsOf(admin)).channels.find((c) => c.kind === 'gmail')!;
      expect(gmailCard.issues.map((i) => i.target)).not.toContain(ADDRESS);
    });

    it('收件箱来信：IDLE 收到新信即同步，入库、识别店铺与来源（亚马逊、US、客户）、归并成工单，到达时间取 INTERNALDATE', async () => {
      t.clock.advance({ minutes: 1 });
      const at = new Date(t.clock.now().getTime() - 30_000);
      imap.deliver(letter('Ava Chen', at));
      await t.runJobs();
      const [mail] = await stored(t, 'Ava Chen');
      expect(mail).toMatchObject({
        direction: 'inbound',
        storeId: AUTO.id,
        recognition: { channel: 'amazon', site: 'US', source: 'customer' },
      });
      expect(mail?.receivedAt.toISOString()).toBe(iso(at));
      const [ticket] = await ticketsOf(agent, 'Ava Chen');
      expect(ticket).toMatchObject({
        store: { id: AUTO.id, name: 'Forcome Auto' },
        channel: 'amazon',
        site: 'US',
        source: 'customer',
        status: 'awaiting_reply',
        lastInboundAt: iso(at),
      });
      const { rows } = await t.runtime.db.execute<{
        provider_message_id: string;
        thread_id: string | null;
      }>(sql`SELECT provider_message_id, thread_id FROM channel.message WHERE id = ${mail!.id}`);
      // 服务商的消息标识：文件夹角色 : UIDVALIDITY : UID；163 企业邮箱没有线程
      expect(rows[0]!.provider_message_id).toMatch(/^inbox:\d+:2$/);
      expect(rows[0]!.thread_id).toBeNull();
    });

    it('「已发送」里的回复（In-Reply-To 指向来信）每 5 分钟检查时收到，识别为首次回复，工单转等客户，首次回复时间 = 回信的 INTERNALDATE（AC-P1-24）', async () => {
      t.clock.advance({ minutes: 2 });
      const repliedAt = new Date(t.clock.now().getTime() - 60_000);
      imap.send(reply('Ava Chen', repliedAt));
      // 「已发送」不另开 IDLE：只跑任务收不到
      await t.runJobs();
      expect(await stored(t, 'Re: Question about my order')).toEqual([]);
      await poll();
      const [sent] = await stored(t, 'Re: Question about my order');
      expect(sent).toMatchObject({ direction: 'outbound', storeId: AUTO.id });
      const detail = await detailOf(agent, 'Ava Chen');
      expect(detail.ticket.status).toBe('awaiting_customer');
      const inbound = detail.messages.find((m) => m.direction === 'inbound')!;
      expect(inbound.firstReplyAt).toBe(iso(repliedAt));
      expect(inbound.sla?.result).toBe('met');
    });

    it('同一封信重复同步不重复入库：再同步一次、同一封在收件箱里又出现一次（新的 UID）都只入库一次（R-TK-07、E-15）', async () => {
      const before = await stored(t);
      await poll();
      const uid = imap.deliver(letter('Ben Ortiz', t.clock.now()))[0]!;
      await t.runJobs();
      imap.redeliver(ADDRESS, 'inbox', uid);
      await poll();
      await poll();
      const after = await stored(t);
      expect(after).toHaveLength(before.length + 1);
      expect(await ticketsOf(agent, 'Ben Ortiz')).toHaveLength(1);
    });
  });

  describe('UIDVALIDITY、IDLE 掉线与连接状态（6.9，与 Gmail 同口径）', () => {
    it('UIDVALIDITY 变化：变了的文件夹按到达时间区间补拉，没变的文件夹照常增量（到达时间早于补拉起点的也收到），已收过的不重复；之后照常增量', async () => {
      t.clock.advance({ minutes: 5 });
      const before = await stored(t);
      const oldValidity = (await syncRow(t))!.imap_cursor!.inbox.uidValidity;
      imap.resetUidValidity(ADDRESS, 'inbox');
      imap.deliver(letter('Cara Diaz', t.clock.now()));
      // 「已发送」没重建：客户端离线后补存进去的一封，到达时间在补拉起点之前，照常按游标收到
      imap.send(reply('Offline Sender', new Date(t.clock.now().getTime() - 2 * DAY)));
      await t.runJobs();
      const after = await stored(t);
      expect(after).toHaveLength(before.length + 2);
      expect(
        after.find((m) => m.direction === 'inbound' && !before.some((b) => b.id === m.id))
          ?.recognition?.sender.name,
      ).toBe('Cara Diaz');
      const outbound = (list: typeof after) =>
        list.filter((m) => m.direction === 'outbound').length;
      expect(outbound(after)).toBe(outbound(before) + 1);
      const row = await syncRow(t);
      expect(row?.imap_cursor?.inbox.uidValidity).not.toBe(oldValidity);
      expect(row?.last_success_at?.toISOString()).toBe(t.clock.now().toISOString());
      t.clock.advance({ minutes: 1 });
      imap.deliver(letter('Dan Wu', t.clock.now()));
      await t.runJobs();
      expect(await ticketsOf(agent, 'Dan Wu')).toHaveLength(1);
      expect(await stored(t)).toHaveLength(before.length + 3);
    });

    it('IDLE 掉线后不算连接失败；新信由每 5 分钟的检查收到，水位与最近同步照常前进；1 分钟后重连上', async () => {
      t.clock.advance({ minutes: 1 });
      imap.dropIdle(ADDRESS);
      await t.runJobs();
      expect(imap.idleConnections(ADDRESS)).toBe(0);
      expect((await syncRow(t))?.consecutive_failures).toBe(0);
      t.clock.advance({ minutes: 4 });
      imap.deliver(letter('Eve Park', t.clock.now()));
      // 没有 IDLE：重连的时刻已过（1 分钟），这一轮先重连、重连上先同步一次
      await poll();
      expect(await ticketsOf(agent, 'Eve Park')).toHaveLength(1);
      expect(imap.idleConnections(ADDRESS)).toBe(1);
      const row = await syncRow(t);
      expect(row?.last_success_at?.toISOString()).toBe(t.clock.now().toISOString());
      expect(row?.consecutive_failures).toBe(0);
    });

    it('授权码失效：登录连续失败到 3 次为连接异常——卡片、全站横幅、管理员与客服主管的通知、审计（AC-P1-25）；常驻连接不连环重试', async () => {
      const since = new Date(t.clock.now().getTime() + 5 * MINUTE);
      imap.rejectLogin(ADDRESS, 'auth_failed');
      imap.dropIdle(ADDRESS);
      await t.runJobs();
      // 第一次检查：常驻连接到了重连的时刻、登录失败（算一次，要管理员处理，停下不再重连），同步登录失败（再一次）
      t.clock.advance({ minutes: 5 });
      await poll();
      expect((await syncRow(t))?.consecutive_failures).toBe(2);
      expect(await notices(admin)).toEqual([]);
      // 之后只靠每 5 分钟的检查：第 3 次失败转连接异常
      t.clock.advance({ minutes: 5 });
      await poll();
      expect((await syncRow(t))?.consecutive_failures).toBe(3);
      const card = await qiyeCard(admin);
      expect(card).toMatchObject({
        status: 'error',
        issues: [{ target: ADDRESS, status: 'error', failures: 3 }],
      });
      // 常驻连接遇到认证失败就停下，不在每次拉取里重连（网易对连续登录失败可能锁定账号）
      const loginsBefore = imap.faults.calls.length;
      await t.runJobs();
      await t.runJobs();
      expect(imap.faults.calls.slice(loginsBefore)).toEqual([]);

      for (const client of [agent, admin]) {
        const res = await client.get('/api/channel/alerts');
        const { alerts } = channelAlertsSchema.parse(await res.json());
        expect(alerts).toEqual([
          { kind: 'qiye163', targets: [ADDRESS], since: since.toISOString() },
        ]);
      }
      for (const client of [admin, supervisor]) {
        expect(await notices(client)).toEqual([
          {
            title: '163 企业邮箱连接异常',
            body: `${ADDRESS} 连续 3 次失败，来信暂存`,
            object: { type: 'channel', id: 'qiye163', label: 'P18 · 163 企业邮箱' },
          },
        ]);
      }
      const [audit] = await t.auditRecords({ action: 'channel.disconnected' });
      expect(audit).toMatchObject({
        objectId: `qiye163:${ADDRESS}`,
        objectLabel: `163 企业邮箱 · ${ADDRESS}`,
        after: { channel: 'qiye163', status: 'error' },
      });
    });

    it('管理员在 P18 重新填写授权码：立即重连并补拉暂存的来信，回到已连接、横幅消失，收到「163 企业邮箱已恢复」', async () => {
      t.clock.advance({ minutes: 1 });
      imap.deliver(letter('Fay Lin', t.clock.now()));
      imap.acceptLogin(ADDRESS);
      const res = await admin.put(
        `/api/channel/stores/${AUTO.id}`,
        await autoUpdate(admin, [{ ...QIYE_ROW, authCode: 'renewed-code-1' }]),
      );
      expect(res.status).toBe(200);
      // 授权码换了：常驻连接立即重连，重连上先同步一次
      await t.runJobs();
      expect(imap.idleConnections(ADDRESS)).toBe(1);
      expect(await ticketsOf(agent, 'Fay Lin')).toHaveLength(1);
      expect((await qiyeCard(admin)).status).toBe('connected');
      const alertsRes = await agent.get('/api/channel/alerts');
      expect(channelAlertsSchema.parse(await alertsRes.json()).alerts).toEqual([]);
      expect((await notices(admin))[0]).toEqual({
        title: '163 企业邮箱已恢复',
        body: `${ADDRESS} 已重新连接，补拉 1 封来信`,
        object: { type: 'channel', id: 'qiye163', label: 'P18 · 163 企业邮箱' },
      });
      const [recovered] = await t.auditRecords({ action: 'channel.recovered' });
      expect(recovered).toMatchObject({
        objectLabel: `163 企业邮箱 · ${ADDRESS}`,
        after: { channel: 'qiye163', status: 'connected', backfilled: { count: 1 } },
      });
    });

    it('找不到「已发送」：收件箱照收、记同步成功，不计连接失败；之后找到了从那时起收', async () => {
      t.clock.advance({ minutes: 5 });
      imap.removeSentFolder(ADDRESS);
      imap.deliver(letter('Gus Hall', t.clock.now()));
      await poll();
      expect(await ticketsOf(agent, 'Gus Hall')).toHaveLength(1);
      const row = await syncRow(t);
      expect(row?.consecutive_failures).toBe(0);
      expect(row?.last_success_at?.toISOString()).toBe(t.clock.now().toISOString());
      imap.restoreSentFolder(ADDRESS);
      t.clock.advance({ minutes: 5 });
      await poll();
      imap.send(reply('Gus Hall', t.clock.now()));
      t.clock.advance({ minutes: 5 });
      await poll();
      expect((await detailOf(agent, 'Gus Hall')).ticket.status).toBe('awaiting_customer');
    });
  });

  describe('按时关闭的前提（待办 33，对 163 企业邮箱同样成立）', () => {
    it('等客户 7 天：邮箱同步滞后（登录失败）时不关，追上后照常关闭，关闭存到期时刻', async () => {
      const start = t.clock.now();
      imap.deliver(letter('Hal Moore', start));
      await t.runJobs();
      t.clock.advance({ minutes: 10 });
      imap.send(reply('Hal Moore', t.clock.now()));
      await poll();
      const replied = await detailOf(agent, 'Hal Moore');
      expect(replied.ticket.status).toBe('awaiting_customer');
      const due = new Date(start.getTime() + 7 * DAY);

      // 到期之后，邮箱一直登录不上：同步不到到期时刻，扫描不关
      imap.rejectLogin(ADDRESS, 'unreachable');
      t.clock.set(new Date(due.getTime() + MINUTE));
      // 拨钟超过 7 天，会话按 7 天无操作过期：重新登录
      agent = await t.loginAs('坐席');
      admin = await t.loginAs('管理员');
      await t.scanTimeLimits({ allowFailures: true });
      expect((await detailOf(agent, 'Hal Moore')).ticket.status).toBe('awaiting_customer');

      // 恢复：同步追上到期时刻后照常关闭
      imap.acceptLogin(ADDRESS);
      t.clock.advance({ minutes: 1 });
      await t.scanTimeLimits({ allowFailures: true });
      const closed = await detailOf(agent, 'Hal Moore');
      expect(closed.ticket).toMatchObject({ status: 'closed', closeReason: 'customer_no_reply' });
      const { rows } = await t.runtime.db.execute<{ due_at: string | null }>(sql`
        SELECT sc.due_at FROM ticket.status_change sc JOIN ticket.ticket tk ON tk.id = sc.ticket_id
         WHERE tk.number = ${closed.ticket.number} AND sc.event = 'idle_7_days'`);
      expect(iso(rows[0]!.due_at!)).toBe(due.toISOString());
    });
  });

  describe('客户端授权码与 P18 接口（AC-P1-23）', () => {
    it('示例的授权码已加密存库：店铺接口只写「已保存」，不返回授权码；密文换了地址就解不开', async () => {
      const res = await admin.get('/api/channel/settings');
      const text = await res.clone().text();
      expect(text).not.toContain(FIXTURE_MAILBOX_AUTH_CODE);
      expect(text).not.toContain('renewed-code-1');
      expect((await autoStore(admin)).mailboxes).toEqual([{ ...QIYE_ROW, authCodeSaved: true }]);
      const { rows } = await t.runtime.db.execute<{ ciphertext: Buffer }>(
        sql`SELECT ciphertext FROM integration.mailbox_credential WHERE address = ${ADDRESS}`,
      );
      expect(rows[0]!.ciphertext.toString('utf8')).not.toContain('renewed-code-1');
      const vault = databaseCredentialVault(t.runtime, TEST_CREDENTIAL_MASTER_KEY)!;
      expect(await vault.readMailboxAuthCode(ADDRESS)).toBe('renewed-code-1');
      await t.runtime.db.execute(
        sql`UPDATE integration.mailbox_credential SET address = 'moved@forcome.com' WHERE address = ${ADDRESS}`,
      );
      expect(await vault.readMailboxAuthCode('moved@forcome.com')).toBeNull();
      await t.runtime.db.execute(
        sql`UPDATE integration.mailbox_credential SET address = ${ADDRESS} WHERE address = 'moved@forcome.com'`,
      );
    });

    it('重新填写授权码：审计「编辑店铺」只写「已重新填写」，前后值与摘要里都没有授权码（P27）', async () => {
      const audits = await t.auditRecords({ action: 'store.update' });
      const audit = audits.find((a) => a.objectId === AUTO.id)!;
      expect(audit.after).toMatchObject({
        mailboxes: [ADDRESS],
        mailboxServers: [
          { address: ADDRESS, provider: 'qiye163', imapHost: 'imap.qiye.163.com', imapPort: 993 },
        ],
        authCodeRenewed: [ADDRESS],
      });
      expect(JSON.stringify(audit)).not.toContain('renewed-code-1');
      const res = await admin.get(
        '/api/audit?period=custom&from=2026-09-01&to=2026-09-30&type=store',
      );
      expect(res.status).toBe(200);
      const entry = auditLogSchema.parse(await res.json()).entries.find((e) => e.id === audit.id)!;
      expect(entry.summary).toBe(`进线邮箱 ${ADDRESS}：客户端授权码已重新填写`);
      expect(JSON.stringify(entry)).not.toContain('renewed-code-1');
    });

    it('不带授权码就沿用已保存的；163 企业邮箱的行校验授权码（新加或从 Gmail 改来时必填）、IMAP 服务器与端口，错误写在该行', async () => {
      const keep = await admin.put(
        `/api/channel/stores/${AUTO.id}`,
        await autoUpdate(admin, [QIYE_ROW]),
      );
      expect(keep.status).toBe(200);
      expect(storeSchema.parse(await keep.json()).mailboxes[0]?.authCodeSaved).toBe(true);
      const audit = (await t.auditRecords({ action: 'store.update' }))
        .filter((a) => a.objectId === AUTO.id)
        .at(-1)!;
      expect(audit.after).not.toHaveProperty('authCodeRenewed');

      const bad = await admin.put(
        `/api/channel/stores/${AUTO.id}`,
        await autoUpdate(admin, [
          QIYE_ROW,
          {
            address: 'amz-auto2@forcome.com',
            provider: 'qiye163',
            imapHost: ' ',
            imapPort: '99999',
          },
        ]),
      );
      expect(bad.status).toBe(400);
      expect(apiErrorSchema.parse(await bad.json()).fields).toEqual({
        'mailboxes.1.authCode': '请填写客户端授权码',
        'mailboxes.1.imapHost': '请填写 IMAP 服务器',
        'mailboxes.1.imapPort': '端口为 1–65535 的整数',
      });
    });

    it('改了 IMAP 服务器或端口就要重填授权码（不把已保存的授权码发给别的主机，协调者 2026-10-15 决定）：保存与按行测试都不沿用', async () => {
      const evil = { ...QIYE_ROW, imapHost: 'imap.attacker.example' };
      const save = await admin.put(
        `/api/channel/stores/${AUTO.id}`,
        await autoUpdate(admin, [evil]),
      );
      expect(save.status).toBe(400);
      expect(apiErrorSchema.parse(await save.json()).fields).toEqual({
        'mailboxes.0.authCode': '请填写客户端授权码',
      });
      const port = await admin.put(
        `/api/channel/stores/${AUTO.id}`,
        await autoUpdate(admin, [{ ...QIYE_ROW, imapPort: 143 }]),
      );
      expect(port.status).toBe(400);
      const calls = imap.faults.calls.length;
      const test = await admin.post('/api/channel/mailbox-tests', {
        address: ADDRESS,
        imapHost: 'imap.attacker.example',
        imapPort: 993,
        storeId: AUTO.id,
      });
      expect(test.status).toBe(400);
      expect(apiErrorSchema.parse(await test.json()).fields).toEqual({
        authCode: '请填写客户端授权码',
      });
      // 没有登录任何主机
      expect(imap.faults.calls.slice(calls)).toEqual([]);
    });

    it('改成 Gmail 或删掉：保存时一并删掉授权码；再改回 163 企业邮箱必须重新填写', async () => {
      const toGmail = await admin.put(
        `/api/channel/stores/${AUTO.id}`,
        await autoUpdate(admin, [{ address: ADDRESS, provider: 'gmail' }]),
      );
      expect(toGmail.status).toBe(200);
      const { rows } = await t.runtime.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM integration.mailbox_credential WHERE address = ${ADDRESS}`,
      );
      expect(rows[0]!.n).toBe(0);
      const back = await admin.put(
        `/api/channel/stores/${AUTO.id}`,
        await autoUpdate(admin, [QIYE_ROW]),
      );
      expect(back.status).toBe(400);
      expect(apiErrorSchema.parse(await back.json()).fields).toEqual({
        'mailboxes.0.authCode': '请填写客户端授权码',
      });
      const restored = await admin.put(
        `/api/channel/stores/${AUTO.id}`,
        await autoUpdate(admin, [{ ...QIYE_ROW, authCode: 'renewed-code-2' }]),
      );
      expect(restored.status).toBe(200);
      // 服务商换过：同步记录从头算，重新开始监听
      await t.runJobs();
      expect((await syncRow(t))?.imap_cursor).not.toBeNull();
    });

    it('只有管理员能改店铺与测试连接（PRD 10.1）', async () => {
      const body = await autoUpdate(admin, [{ ...QIYE_ROW, authCode: 'x' }]);
      for (const role of ['坐席', '客服主管', '售后负责人', '知识库负责人']) {
        const client = await t.loginAs(role);
        expect((await client.put(`/api/channel/stores/${AUTO.id}`, body)).status).toBe(403);
        expect(
          (
            await client.post('/api/channel/mailbox-tests', {
              ...QIYE_ROW,
              imapHost: 'imap.qiye.163.com',
              imapPort: 993,
              storeId: AUTO.id,
            })
          ).status,
        ).toBe(403);
        expect((await client.post('/api/channel/connection-tests/qiye163')).status).toBe(403);
      }
    });

    it('按行测试连接：成功写「连接正常」；认证失败、IP 限制、连不上、超时、找不到「已发送」各给可读的原因（原型 QIYE_ROW_TESTS），不改连接状态', async () => {
      const row = {
        address: ADDRESS,
        imapHost: 'imap.qiye.163.com',
        imapPort: 993,
        storeId: AUTO.id,
      };
      const ok = await admin.post('/api/channel/mailbox-tests', row);
      expect(ok.status).toBe(200);
      expect(mailboxTestResultSchema.parse(await ok.json())).toEqual({
        address: ADDRESS,
        sentFolder: '已发送',
        message: '连接正常：收件箱与「已发送」均可访问',
      });
      const failure = async (body: object = row) => {
        const res = await admin.post('/api/channel/mailbox-tests', body);
        expect(res.status).toBe(502);
        return mailboxTestFailureSchema.parse(await res.json());
      };
      const failuresBefore = (await syncRow(t))?.consecutive_failures;
      imap.rejectLogin(ADDRESS, 'auth_failed');
      expect(await failure()).toEqual({
        error: 'connection_test_failed',
        reason: 'auth_failed',
        message: '登录失败：请检查客户端授权码，以及网易企业邮箱是否开启 IMAP 与客户端登录',
      });
      imap.rejectLogin(ADDRESS, 'login_denied_ip');
      expect((await failure()).message).toBe(
        '登录被拒：网易企业邮箱限制了登录 IP，请管理员在网易后台放行本系统服务器的出口 IP',
      );
      imap.rejectLogin(ADDRESS, 'unreachable');
      expect(
        await failure({ ...row, imapHost: 'imaphz.qiye.163.com', authCode: 'typed' }),
      ).toMatchObject({
        reason: 'unreachable',
        message: '连不上 imaphz.qiye.163.com:993：请检查 IMAP 服务器与端口',
      });
      imap.acceptLogin(ADDRESS);
      imap.faults.failNext({ kind: 'timeout' }, { operation: 'connect' });
      expect(await failure()).toMatchObject({
        reason: 'timeout',
        message: '连不上 imap.qiye.163.com:993：请检查 IMAP 服务器与端口',
      });
      imap.removeSentFolder(ADDRESS);
      expect(await failure()).toMatchObject({
        reason: 'no_sent_folder',
        message: '找不到「已发送」文件夹：请在网易企业邮箱里确认有「已发送」',
      });
      imap.restoreSentFolder(ADDRESS);
      // 测试不记同步记录、不改连接状态
      expect((await syncRow(t))?.consecutive_failures).toBe(failuresBefore);
    });

    it('按行测试连接的校验：新店铺的行没有已保存的授权码要带上；地址、服务器、端口填错照 P18 的校验报在字段上', async () => {
      const res = await admin.post('/api/channel/mailbox-tests', {
        address: 'new-shop@forcome',
        imapHost: '',
        imapPort: 'x',
      });
      expect(res.status).toBe(400);
      expect(apiErrorSchema.parse(await res.json()).fields).toEqual({
        address: '邮箱格式不正确，例如 info@forcome.mx',
        imapHost: '请填写 IMAP 服务器',
        imapPort: '端口为 1–65535 的整数',
        authCode: '请填写客户端授权码',
      });
      const typed = await admin.post('/api/channel/mailbox-tests', {
        address: 'new-shop@forcome.com',
        imapHost: 'imap.qiye.163.com',
        imapPort: '993',
        authCode: 'typed',
      });
      expect(typed.status).toBe(200);
      // Fake IMAP 的约定写法（e2e 在另一个进程里注入不了故障）：这两个授权码为登录失败、登录被拒，服务器以 .invalid 结尾为连不上
      const viaInput = async (body: object) => {
        const res = await admin.post('/api/channel/mailbox-tests', {
          address: 'new-shop@forcome.com',
          imapHost: 'imap.qiye.163.com',
          imapPort: 993,
          ...body,
        });
        expect(res.status).toBe(502);
        return mailboxTestFailureSchema.parse(await res.json()).reason;
      };
      expect(await viaInput({ authCode: 'fake-auth-failed' })).toBe('auth_failed');
      expect(await viaInput({ authCode: 'fake-ip-denied' })).toBe('login_denied_ip');
      expect(await viaInput({ authCode: 'typed', imapHost: 'imap.example.invalid' })).toBe(
        'unreachable',
      );
    });

    it('渠道卡「测试连接」：测全部 163 企业邮箱，访问不了时 502 写哪个邮箱（测试连接失败浮层），不改连接状态', async () => {
      const ok = await admin.post('/api/channel/connection-tests/qiye163');
      expect(ok.status).toBe(200);
      expect(connectionTestResultSchema.parse(await ok.json())).toEqual({
        kind: 'qiye163',
        targets: [ADDRESS],
      });
      imap.rejectLogin(ADDRESS, 'auth_failed');
      const failed = await admin.post('/api/channel/connection-tests/qiye163');
      expect(failed.status).toBe(502);
      expect(apiErrorSchema.parse(await failed.json()).message).toBe(`${ADDRESS} 无法访问`);
      imap.acceptLogin(ADDRESS);
      expect((await syncRow(t))?.consecutive_failures).toBe(0);
    });
  });
});

describe('历史回放与 T0 切换覆盖 163 企业邮箱（待办 26 的命令，ADR 0015）', () => {
  let t: TestHarness;
  let imap: FakeImap;
  let agent: ApiClient;
  let output: { exitCode: number; stdout: string; stderr: string };
  let notificationsBefore: number;

  async function notificationCount() {
    const { rows } = await t.runtime.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM core.notification`,
    );
    return rows[0]!.n;
  }

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    imap = t.clients.fake(imapClient);
    // 上线前的历史邮件：收件箱与「已发送」（邮箱还没开始监听，都不在增量里）
    imap.deliver(letter('Ivy Stone', '2026-08-20T10:00:00+08:00'));
    imap.send(reply('Ivy Stone', '2026-08-20T11:00:00+08:00'));
    imap.deliver(letter('Jon Reed', '2026-09-05T09:00:00+08:00'));
    // 早于 90 天的不回放
    imap.deliver(letter('Old Buyer', '2026-06-01T09:00:00+08:00'));
    // T0 前开始监听（worker 起着，同步照常但开始监听前的信不在增量里）
    await t.runJobs();
    expect(imap.isListening(ADDRESS)).toBe(true);
    // 写下 T0、进入回放中：之后到的信、IDLE 与同步都等切换完成
    t.clock.advance({ minutes: 1 });
    await beginCutover(t.runtime, t.clock.now());
    t.clock.advance({ minutes: 1 });
    imap.deliver(letter('Kim Lee', t.clock.now()));
    await t.runJobs();
    agent = await t.loginAs('坐席');
    notificationsBefore = await notificationCount();
  });

  afterAll(async () => {
    await t.close();
  });

  it('切换完成前只监听不入库：T0 之后到的信不收，常驻连接不开、不记成败', async () => {
    expect(imap.idleConnections(ADDRESS)).toBe(0);
    expect((await t.receivedMail({ mailbox: ADDRESS })).map((m) => m.subject)).toEqual([]);
    const { rows } = await t.runtime.db.execute<{ consecutive_failures: number }>(
      sql`SELECT consecutive_failures FROM channel.mailbox_sync WHERE address = ${ADDRESS}`,
    );
    expect(rows[0]?.consecutive_failures).toBe(0);
  });

  it('回放命令：163 企业邮箱的收件箱与「已发送」按邮件时间回放（早于 90 天的不回放），回放期间不发通知；完成后实时同步接着收 T0 之后的信', async () => {
    output = await t.runMailReplay(['--confirm']);
    expect(output.exitCode, output.stderr).toBe(0);
    const ivy = await detailOf(agent, 'Ivy Stone');
    // 按邮件时间：回复转等客户，7 天无来信在回放里按时关闭
    expect(ivy.ticket.number).toMatch(/^T-20260820-/);
    expect(ivy.messages.find((m) => m.direction === 'inbound')?.firstReplyAt).toBe(
      iso('2026-08-20T11:00:00+08:00'),
    );
    expect(ivy.ticket).toMatchObject({ status: 'closed', closeReason: 'customer_no_reply' });
    expect((await ticketsOf(agent, 'Jon Reed'))[0]?.number).toMatch(/^T-20260905-/);
    expect(await ticketsOf(agent, 'Old Buyer')).toEqual([]);
    expect(await notificationCount()).toBe(notificationsBefore);
    // T0 之后的信：切换完成后由实时同步接着收，只入库一次
    await t.runJobs();
    expect(await ticketsOf(agent, 'Kim Lee')).toHaveLength(1);
    await t.runJobs();
    const subjects = (await t.receivedMail({ mailbox: ADDRESS })).filter(
      (m) => m.recognition?.sender.name === 'Kim Lee',
    );
    expect(subjects).toHaveLength(1);
    expect(imap.idleConnections(ADDRESS)).toBe(1);
  });
});
