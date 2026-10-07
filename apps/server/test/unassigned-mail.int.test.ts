import {
  assignStoreResultSchema,
  auditLogSchema,
  notificationListSchema,
  slaDueAt,
  storeSchema,
  ticketDetailSchema,
  ticketListSchema,
  unassignedMailListSchema,
  type Notification,
  type StoreInput,
  type TicketListItem,
  type UnassignedMail,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { placeUnassignedJob } from '../src/modules/channel';
import { sendWorkNotificationsJob } from '../src/modules/core';
import {
  amazonOrdersClient,
  dingtalkClient,
  gmailClient,
  type FakeMailInput,
} from '../src/modules/integration';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 未归属店铺来信队列与指定店铺（待办 15；PRD E-13、R-ST-02、P04「第一阶段」、I17、11.4、AC-TK-09、AC-TK-11、AC-P1-15、AC-P1-16）：
 * Fake Gmail 里放一封落在店铺邮箱、收件地址却没登记在任何店铺的来信（别名或转发地址）→ 跑完任务 → 以客服主管身份看队列、
 * 指定店铺（5 秒撤销窗口在前端，窗口结束才调接口）；管理员登记新店铺或进线邮箱后自动归位。
 * 每个用例用自己的客户与收件地址（自动归位会把队列里收件地址已登记的来信都归位），互不影响。
 */

const stores = getDemoFixture().stores;
const store = (name: string) => stores.find((s) => s.name === name)!;
const DIRECT = store('Forcome Direct');
const AUTO = store('Forcome Auto');
const MX = store('forcome.mx');
const COM = store('forcome.com');

/** 演示时刻（周五 10:20） */
const NOW = '2026-09-11T10:20:00+08:00';

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.');

/**
 * 亚马逊买家消息写到店铺没登记的绑定邮箱（例如加拿大站另绑的 amz-ca2@forcome.com）：信落在 Forcome Direct 的邮箱里，
 * Delivered-To 与 To 都是那个没登记的地址（I17 Tom Harris 的样子）
 */
function buyerMessage(
  name: string,
  to: string,
  overrides: Partial<FakeMailInput> = {},
): FakeMailInput {
  return {
    to,
    mailbox: DIRECT.mailbox,
    deliveredTo: to,
    from: { name, address: `${slug(name)}.x7@marketplace.amazon.ca` },
    subject: `Where is my order? (${name})`,
    text: 'Tracking says delivered but nothing arrived.',
    at: '2026-09-11T10:02:00+08:00',
    ...overrides,
  };
}

/** 客户直接写到没登记的地址、转进店铺邮箱（只有 To，没有 Delivered-To；I17 Lucía Herrera 的样子） */
function forwardedLetter(
  name: string,
  to: string,
  overrides: Partial<FakeMailInput> = {},
): FakeMailInput {
  return {
    to,
    mailbox: MX.mailbox,
    deliveredTo: null,
    from: { name, address: `${slug(name)}@gmail.com` },
    subject: `El filtro no encaja (${name})`,
    text: 'El filtro no encaja en mi aspiradora.',
    at: '2026-09-11T09:47:00+08:00',
    ...overrides,
  };
}

describe('未归属店铺来信', () => {
  let t: TestHarness;
  let supervisor: ApiClient;
  let agent: ApiClient;
  let admin: ApiClient;
  /** 店铺范围只有 forcome.mx 的客服主管 */
  let mxSupervisor: ApiClient;

  const gmail = () => t.clients.fake(gmailClient);

  async function queue(client: ApiClient = supervisor): Promise<UnassignedMail[]> {
    const res = await client.get('/api/channel/unassigned-mail');
    expect(res.status).toBe(200);
    return unassignedMailListSchema.parse(await res.json()).mails;
  }

  async function queued(name: string, client: ApiClient = supervisor) {
    return (await queue(client)).find((m) => m.customer.name === name);
  }

  async function ticketsOf(
    name: string,
    client: ApiClient = supervisor,
  ): Promise<TicketListItem[]> {
    const res = await client.get('/api/tickets');
    expect(res.status).toBe(200);
    return ticketListSchema.parse(await res.json()).tickets.filter((x) => x.customer.name === name);
  }

  async function notifications(client: ApiClient): Promise<Notification[]> {
    const res = await client.get('/api/notifications');
    expect(res.status).toBe(200);
    return notificationListSchema.parse(await res.json()).items;
  }

  async function assign(client: ApiClient, mailId: string, storeId: string) {
    return client.post(`/api/channel/unassigned-mail/${mailId}/store`, { storeId });
  }

  /** 收到一封、跑完任务，返回它在队列里的样子 */
  async function arrive(mail: FakeMailInput, name: string): Promise<UnassignedMail> {
    gmail().deliver(mail);
    await t.runJobs();
    const found = await queued(name);
    expect(found).toBeDefined();
    return found!;
  }

  beforeAll(async () => {
    t = await startTestHarness();
    t.clock.set(NOW);
    await t.loadFixtures();
    // 系统开始监听店铺邮箱，之后到达的来信才会同步进来
    await t.runJobs();
    supervisor = await t.loginAs({ member: 'zhoumin' });
    agent = await t.loginAs('坐席');
    admin = await t.loginAs('管理员');
    const mxId = await t.addMember({
      name: '范围受限的客服主管',
      dept: 'FSH / 客服部',
      roles: ['supervisor'],
      allStores: false,
      storeIds: [MX.id],
    });
    mxSupervisor = await t.loginAs({ memberId: mxId });
  });

  beforeEach(() => {
    t.clock.set(NOW);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('进队列（AC-TK-09、E-13）', () => {
    it('买家消息的收件地址没登记：进队列、不建工单，SLA 按原到达时间照常计时（发件域是亚马逊的域，亚马逊 24 小时）', async () => {
      const mail = await arrive(
        buyerMessage('Tom Harrison', 'amz-ca7@forcome.com'),
        'Tom Harrison',
      );

      expect(mail).toEqual({
        id: expect.any(String) as string,
        customer: { name: 'Tom Harrison', address: 'tom.harrison.x7@marketplace.amazon.ca' },
        subject: 'Where is my order? (Tom Harrison)',
        // 识别依据：Delivered-To 在前（I17「Delivered-To amz-ca2@forcome.com 未登记」）
        basis: { header: 'delivered-to', address: 'amz-ca7@forcome.com' },
        fromDomain: 'marketplace.amazon.ca',
        receivedAt: '2026-09-11T02:02:00.000Z',
        sla: { target: 'platform', dueAt: '2026-09-12T02:02:00.000Z' },
      });
      // 尚未归并成工单（E-13）：谁都看不到这张工单
      expect(await ticketsOf('Tom Harrison')).toEqual([]);
      const [received] = (await t.receivedMail({ mailbox: DIRECT.mailbox })).filter(
        (m) => m.id === mail.id,
      );
      expect(received?.storeId).toBeNull();
    });

    it('转进来的直邮只有 To：识别依据为 To，发件域不是亚马逊的域按内部目标', async () => {
      const mail = await arrive(
        forwardedLetter('Lucía Hernán', 'info7@forcome.mx'),
        'Lucía Hernán',
      );
      expect(mail.basis).toEqual({ header: 'to', address: 'info7@forcome.mx' });
      expect(mail.fromDomain).toBe('gmail.com');
      expect(mail.sla).toEqual({ target: 'internal', dueAt: '2026-09-12T01:47:00.000Z' });
      expect(await ticketsOf('Lucía Hernán')).toEqual([]);
    });

    it('客服主管收到站内通知（全部在职客服主管，不按店铺）与钉钉工作通知；坐席不收', async () => {
      t.clients.fake(dingtalkClient).reset();
      const mail = await arrive(buyerMessage('Nora Quinn', 'amz-ca8@forcome.com'), 'Nora Quinn');
      for (const client of [supervisor, mxSupervisor]) {
        const found = (await notifications(client)).find((n) => n.object.id === mail.id);
        expect(found).toMatchObject({
          type: 'unassigned_mail',
          title: '未归属店铺来信',
          body: 'Nora Quinn · amz-ca8@forcome.com 未登记',
          object: { type: 'message', id: mail.id, label: 'P04 · 未归属店铺' },
          read: false,
        });
      }
      expect((await notifications(agent)).some((n) => n.object.id === mail.id)).toBe(false);

      // 钉钉工作通知（11.4，同一人 5 分钟内合并后发出）
      t.clock.set('2026-09-11T10:26:00+08:00');
      await t.enqueue(sendWorkNotificationsJob, {});
      await t.runJobs();
      const sent = t.clients.fake(dingtalkClient).sent;
      expect(sent.find((s) => s.userIds.includes('zhoumin'))?.text).toContain(
        '未归属店铺来信：Nora Quinn · amz-ca8@forcome.com 未登记（P04 · 未归属店铺',
      );
    });

    it('平台通知照样归档、不进队列；同一封邮件落到两个邮箱只进一次（R-TK-07）', async () => {
      gmail().deliver({
        to: 'amz-ca9@forcome.com',
        mailbox: DIRECT.mailbox,
        deliveredTo: 'amz-ca9@forcome.com',
        from: { name: 'Amazon Seller Central', address: 'seller-notification@amazon.ca' },
        subject: 'Your account health',
        text: 'Notice',
        at: '2026-09-11T08:00:00+08:00',
      });
      const twice = forwardedLetter('Paz Duplicada', 'hola7@forcome.mx', {
        messageId: '<twice@example.com>',
      });
      gmail().deliver(twice);
      gmail().deliver({ ...twice, mailbox: AUTO.mailbox });
      await t.runJobs();

      const mails = await queue();
      expect(mails.some((m) => m.subject === 'Your account health')).toBe(false);
      expect(mails.filter((m) => m.customer.name === 'Paz Duplicada')).toHaveLength(1);
    });

    it('同时写给两个店铺邮箱、落在后写的那个邮箱：按落到的店铺邮箱识别，不按 To 里先写的（识别的第一条分支，R-TK-07）', async () => {
      gmail().deliver(
        forwardedLetter('Dan Direct', '', {
          to: [DIRECT.mailbox, AUTO.mailbox],
          mailbox: AUTO.mailbox,
          deliveredTo: AUTO.mailbox,
        }),
      );
      await t.runJobs();
      expect(await queued('Dan Direct')).toBeUndefined();
      const [ticket] = await ticketsOf('Dan Direct');
      expect(ticket?.store.name).toBe('Forcome Auto');
    });

    it('Delivered-To 写的是信落到的同步邮箱本身（寄到它的别名）：落到的邮箱不算收件地址，按 To 的别名进队列', async () => {
      gmail().deliver(
        buyerMessage('Hal Alias', 'amz-ca9x@forcome.com', { deliveredTo: DIRECT.mailbox }),
      );
      await t.runJobs();
      const mail = await queued('Hal Alias');
      expect(mail?.basis).toEqual({ header: 'to', address: 'amz-ca9x@forcome.com' });
      expect(await ticketsOf('Hal Alias')).toEqual([]);
    });

    it('只写给第三方、密送店铺邮箱（Delivered-To 是落到的邮箱）：与寄到没登记的别名分不出来，进队列由客服主管指定（取舍，不丢信）', async () => {
      gmail().deliver(
        forwardedLetter('Cy Copy', 'friend.of.cy@example.com', {
          mailbox: MX.mailbox,
          deliveredTo: MX.mailbox,
        }),
      );
      await t.runJobs();
      expect((await queued('Cy Copy'))?.basis).toEqual({
        header: 'to',
        address: 'friend.of.cy@example.com',
      });
    });

    it('一个收件地址都没有（只密送、也没有 Delivered-To）：按落到的邮箱识别店铺', async () => {
      gmail().deliver({
        ...forwardedLetter('Bea Blind', 'unused@example.com', { mailbox: MX.mailbox }),
        to: [],
      });
      await t.runJobs();
      expect(await queued('Bea Blind')).toBeUndefined();
      const [ticket] = await ticketsOf('Bea Blind');
      expect(ticket?.store.name).toBe('forcome.mx');
    });

    it('收件地址登记在店铺时按它识别店铺，不看信落在哪个邮箱（R-ST-02「按收件邮箱」）', async () => {
      gmail().deliver(
        forwardedLetter('Iris Bello', MX.mailbox, { mailbox: COM.mailbox, deliveredTo: null }),
      );
      await t.runJobs();
      expect(await queued('Iris Bello')).toBeUndefined();
      const [ticket] = await ticketsOf('Iris Bello');
      expect(ticket?.store.name).toBe('forcome.mx');
    });
  });

  describe('指定店铺（AC-TK-11、AC-P1-15）', () => {
    it('指定后按 R-ST-02 重新识别站点、关联订单并归并成工单，SLA 仍按原到达时间（过了 24 小时为未达标）；记审计「指定店铺」', async () => {
      t.clients.fake(amazonOrdersClient).put(DIRECT.id, {
        orderId: '702-1234567-7654321',
        updatedAt: new Date('2026-09-05T10:00:00+08:00'),
      });
      const mail = await arrive(
        buyerMessage('Owen Ray', 'amz-ca3@forcome.com', {
          text: 'Order 702-1234567-7654321 never arrived.',
          at: '2026-09-10T09:00:00+08:00',
        }),
        'Owen Ray',
      );

      const res = await assign(supervisor, mail.id, DIRECT.id);
      expect(res.status).toBe(200);
      expect(assignStoreResultSchema.parse(await res.json())).toEqual({
        id: mail.id,
        store: { id: DIRECT.id, name: 'Forcome Direct' },
      });
      await t.runJobs();

      expect(await queued('Owen Ray')).toBeUndefined();
      const [ticket] = await ticketsOf('Owen Ray');
      expect(ticket).toMatchObject({
        store: { id: DIRECT.id, name: 'Forcome Direct' },
        channel: 'amazon',
        // 亚马逊店铺按买家消息中转域定站点：marketplace.amazon.ca → CA
        site: 'CA',
        orderNumber: '702-1234567-7654321',
        status: 'awaiting_reply',
        lastInboundAt: '2026-09-10T01:00:00.000Z',
      });
      // 工单号的日期取首封来信日期
      expect(ticket!.number).toMatch(/^T-20260910-/);
      const detail = ticketDetailSchema.parse(
        await (await supervisor.get(`/api/tickets/${ticket!.number}`)).json(),
      );
      expect(detail.messages).toHaveLength(1);
      expect(detail.messages[0]!.sla).toEqual({
        target: 'platform',
        dueAt: slaDueAt(new Date('2026-09-10T09:00:00+08:00')).toISOString(),
        result: 'missed',
      });

      const [record] = await t.auditRecords({ action: 'message.assign_store', objectId: mail.id });
      expect(record).toMatchObject({
        actorName: '周敏',
        objectType: 'message',
        objectLabel: 'Owen Ray · amz-ca3@forcome.com',
        storeId: DIRECT.id,
        before: {
          storeId: null,
          site: null,
          channel: 'amazon',
          recipient: 'amz-ca3@forcome.com',
          recipientHeader: 'delivered-to',
          subject: 'Where is my order? (Owen Ray)',
        },
        after: { storeId: DIRECT.id, site: 'CA', channel: 'amazon' },
      });
    });

    it('指定到 Shopify 店铺：按该店铺重新识别（直邮为邮件渠道、站点取默认站点），SLA 未到期、按内部目标', async () => {
      const mail = await arrive(forwardedLetter('Lucía Rey', 'info5@forcome.mx'), 'Lucía Rey');
      expect((await assign(supervisor, mail.id, MX.id)).status).toBe(200);
      await t.runJobs();
      const [ticket] = await ticketsOf('Lucía Rey');
      expect(ticket).toMatchObject({ channel: 'email', site: 'MX', store: { name: 'forcome.mx' } });
      const detail = ticketDetailSchema.parse(
        await (await supervisor.get(`/api/tickets/${ticket!.number}`)).json(),
      );
      expect(detail.messages[0]!.sla).toMatchObject({ target: 'internal', result: 'pending' });
    });

    it('撤销窗口内撤销（前端不提交）：来信留在队列、不产生工单；窗口结束才提交时归并成工单（AC-P1-15）', async () => {
      const mail = await arrive(buyerMessage('Una Vale', 'amz-ca4@forcome.com'), 'Una Vale');
      // 撤销：前端在 5 秒窗口内不提交，后台照常运转
      t.clock.set('2026-09-11T10:20:05+08:00');
      await t.runJobs();
      expect(await queued('Una Vale')).toBeDefined();
      expect(await ticketsOf('Una Vale')).toEqual([]);

      // 不撤销：窗口结束后提交
      expect((await assign(supervisor, mail.id, DIRECT.id)).status).toBe(200);
      await t.runJobs();
      expect(await queued('Una Vale')).toBeUndefined();
      expect(await ticketsOf('Una Vale')).toHaveLength(1);
    });

    it('来信已不在队列里（别人先指定了）再指定：409，不重复归并；没有这个店铺：400', async () => {
      const mail = await arrive(buyerMessage('Vic Twice', 'amz-ca5@forcome.com'), 'Vic Twice');
      expect(
        (await assign(supervisor, mail.id, '00000000-0000-7000-8000-000000000000')).status,
      ).toBe(400);
      expect((await assign(supervisor, mail.id, DIRECT.id)).status).toBe(200);
      const again = await assign(supervisor, mail.id, AUTO.id);
      expect(again.status).toBe(409);
      // 界面的失败浮层写它已归入哪个店铺（协调者 2026-10-07 决定 Q8）
      expect(await again.json()).toEqual({
        error: 'not_in_queue',
        message: '已归入 Forcome Direct',
      });
      await t.runJobs();
      const tickets = await ticketsOf('Vic Twice');
      expect(tickets.map((x) => x.store.name)).toEqual(['Forcome Direct']);
    });
  });

  describe('谁能看、能指定到哪', () => {
    it('店铺范围受限的客服主管看得到队列（来信尚无店铺）；指定为范围外的店铺被拒（403，记越权访问），范围内的可以', async () => {
      const mail = await arrive(forwardedLetter('Rita Scope', 'ventas7@forcome.mx'), 'Rita Scope');
      expect(await queued('Rita Scope', mxSupervisor)).toEqual(mail);

      expect((await assign(mxSupervisor, mail.id, DIRECT.id)).status).toBe(403);
      const denied = await t.auditRecords({ action: 'access.denied', objectId: mail.id });
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({ objectType: 'message', storeId: DIRECT.id });
      expect(await queued('Rita Scope')).toBeDefined();

      // 没有这个店铺：先报 400，不当成越权
      expect(
        (await assign(mxSupervisor, mail.id, '00000000-0000-7000-8000-000000000000')).status,
      ).toBe(400);
      expect(await t.auditRecords({ action: 'access.denied', objectId: mail.id })).toHaveLength(1);
      expect((await assign(mxSupervisor, mail.id, MX.id)).status).toBe(200);
    });

    it('坐席与售后负责人请求队列与指定接口被拒（只有客服主管有这项能力）', async () => {
      const mail = await arrive(buyerMessage('Sam Denied', 'amz-ca6@forcome.com'), 'Sam Denied');
      for (const client of [agent, await t.loginAs('售后负责人')]) {
        expect((await client.get('/api/channel/unassigned-mail')).status).toBe(403);
        expect((await assign(client, mail.id, DIRECT.id)).status).toBe(403);
      }
      expect((await t.api.get('/api/channel/unassigned-mail')).status).toBe(401);
      expect(await queued('Sam Denied')).toBeDefined();
    });
  });

  describe('登记新店铺后自动归位（AC-P1-16）', () => {
    const newStore = (overrides: Partial<StoreInput> = {}): StoreInput => ({
      name: 'Forcome Direct CA',
      platform: 'amazon',
      sites: ['CA'],
      defaultSite: 'CA',
      mailboxes: ['amz-ca2@forcome.com'],
      platformId: 'A2CA7Q2M9XK3LC',
      ...overrides,
    });

    it('管理员新增进线邮箱为该地址的店铺：来信自动归位成工单，店铺范围包含它的客服主管收到站内通知（不发钉钉）；记审计「自动归位」（系统）', async () => {
      const mail = await arrive(buyerMessage('Tom Harris', 'amz-ca2@forcome.com'), 'Tom Harris');
      const other = await arrive(buyerMessage('Ann Stay', 'amz-ca1@forcome.com'), 'Ann Stay');
      t.clients.fake(dingtalkClient).reset();

      const res = await admin.post('/api/channel/stores', newStore());
      expect(res.status).toBe(201);
      const created = storeSchema.parse(await res.json());
      await t.runJobs();

      expect(await queued('Tom Harris')).toBeUndefined();
      // 收件地址没登记的照样留在队列里
      expect(await queued('Ann Stay')).toEqual(other);
      const [ticket] = await ticketsOf('Tom Harris');
      expect(ticket).toMatchObject({
        store: { id: created.id, name: 'Forcome Direct CA' },
        channel: 'amazon',
        site: 'CA',
        status: 'awaiting_reply',
        lastInboundAt: '2026-09-11T02:02:00.000Z',
      });

      const placed = (await notifications(supervisor)).find(
        (n) => n.type === 'unassigned_mail_placed' && n.object.id === ticket!.number,
      );
      expect(placed).toMatchObject({
        title: '未归属店铺来信已自动归位',
        body: 'Tom Harris · amz-ca2@forcome.com 已归入 Forcome Direct CA',
        object: { type: 'ticket', id: ticket!.number, label: ticket!.number },
      });
      // 按店铺发：店铺范围不含新店铺的客服主管收不到
      expect(
        (await notifications(mxSupervisor)).some((n) => n.type === 'unassigned_mail_placed'),
      ).toBe(false);
      // 自动归位只发站内（11.4）
      t.clock.set('2026-09-11T10:30:00+08:00');
      await t.enqueue(sendWorkNotificationsJob, {});
      await t.runJobs();
      expect(t.clients.fake(dingtalkClient).sent.some((s) => s.text.includes('自动归位'))).toBe(
        false,
      );

      const [record] = await t.auditRecords({ action: 'message.auto_place', objectId: mail.id });
      expect(record).toMatchObject({
        actorType: 'system',
        actorName: '系统',
        objectType: 'message',
        objectLabel: 'Tom Harris · amz-ca2@forcome.com',
        storeId: created.id,
        after: {
          storeId: created.id,
          site: 'CA',
          channel: 'amazon',
          recipient: 'amz-ca2@forcome.com',
        },
      });
    });

    it('兜底扫描：信在新邮箱生效前入队的，每 5 分钟的扫描按已登记的收件地址归位', async () => {
      await arrive(buyerMessage('Gus Late', 'amz-late@forcome.com'), 'Gus Late');
      // 模拟「店铺已变更」已处理完、这封信才入队：直接改库登记邮箱，不发事件
      await t.runtime.db.execute(
        sql`INSERT INTO channel.store_mailbox (store_id, address, position, created_at)
            VALUES (${DIRECT.id}, 'amz-late@forcome.com', 9, now())`,
      );
      expect(await queued('Gus Late')).toBeDefined();
      await t.enqueue(placeUnassignedJob, {});
      await t.runJobs();
      expect(await queued('Gus Late')).toBeUndefined();
      const [ticket] = await ticketsOf('Gus Late');
      expect(ticket?.store.name).toBe('Forcome Direct');
    });

    it('编辑现有店铺、加一个进线邮箱（别名）后同样自动归位到该店铺', async () => {
      await arrive(forwardedLetter('Lola Alias', 'info3@forcome.mx'), 'Lola Alias');
      const settings = (await (await admin.get('/api/channel/settings')).json()) as {
        stores: { id: string; mailboxes: string[]; version: number }[];
      };
      const mx = settings.stores.find((s) => s.id === MX.id)!;
      const res = await admin.put(`/api/channel/stores/${MX.id}`, {
        ...newStore({
          name: 'forcome.mx',
          platform: 'shopify',
          sites: ['MX'],
          defaultSite: 'MX',
          mailboxes: [...mx.mailboxes, 'info3@forcome.mx'],
          platformId: MX.platformId,
        }),
        version: mx.version,
      });
      expect(res.status).toBe(200);
      await t.runJobs();
      expect(await queued('Lola Alias')).toBeUndefined();
      const [ticket] = await ticketsOf('Lola Alias');
      expect(ticket).toMatchObject({ store: { name: 'forcome.mx' }, channel: 'email', site: 'MX' });
      // forcome.mx 在范围内：范围受限的客服主管这次收得到
      expect(
        (await notifications(mxSupervisor)).some(
          (n) => n.type === 'unassigned_mail_placed' && n.object.id === ticket!.number,
        ),
      ).toBe(true);
    });
  });

  describe('审计记录的店铺范围（P27、10.2）', () => {
    it('「指定店铺」「自动归位」按所归店铺过滤：范围受限的客服主管只看到自己店铺的', async () => {
      const auditOf = async (client: ApiClient) => {
        const res = await client.get('/api/audit?type=message');
        expect(res.status).toBe(200);
        return auditLogSchema.parse(await res.json()).entries;
      };
      const all = await auditOf(supervisor);
      // 来信对象点进它所在工单的 P05（PRD P27「第一阶段」v2.31，待办 17）：给出归并成的工单号
      const [lola] = await ticketsOf('Lola Alias');
      expect(all.find((i) => i.objectLabel === 'Lola Alias · info3@forcome.mx')?.ticketNumber).toBe(
        lola!.number,
      );
      const labels = (items: typeof all) =>
        items.map((i) => [i.actionLabel, i.objectLabel, i.summary]).sort();
      expect(labels(all)).toEqual(
        expect.arrayContaining([
          ['指定店铺', 'Owen Ray · amz-ca3@forcome.com', '店铺：— → Forcome Direct'],
          ['指定店铺', 'Lucía Rey · info5@forcome.mx', '店铺：— → forcome.mx'],
          ['自动归位', 'Tom Harris · amz-ca2@forcome.com', '店铺：— → Forcome Direct CA'],
          ['自动归位', 'Lola Alias · info3@forcome.mx', '店铺：— → forcome.mx'],
        ]),
      );
      const limited = await auditOf(mxSupervisor);
      expect(limited.length).toBeGreaterThan(0);
      expect(
        limited
          .filter((i) => i.actionLabel !== '越权访问被拒')
          .every((i) => i.summary === '店铺：— → forcome.mx'),
      ).toBe(true);
      expect(labels(limited)).toEqual(
        expect.arrayContaining([
          ['指定店铺', 'Lucía Rey · info5@forcome.mx', '店铺：— → forcome.mx'],
          ['自动归位', 'Lola Alias · info3@forcome.mx', '店铺：— → forcome.mx'],
        ]),
      );
    });
  });
});

describe('示例数据回放（开发测试环境、本机与 Playwright：原型 I17 的两封）', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness();
    t.clock.set(NOW);
    await t.loadFixtures();
    t.clients.fake(gmailClient).replay(getDemoFixture());
    await t.runJobs();
  });

  afterAll(async () => {
    await t.close();
  });

  it('Tom Harris（Delivered-To amz-ca2@forcome.com）与 Lucía Herrera（To info@forcome.mx）进队列，通知写法同原型 G10', async () => {
    const supervisor = await t.loginAs({ member: 'zhoumin' });
    const { mails } = unassignedMailListSchema.parse(
      await (await supervisor.get('/api/channel/unassigned-mail')).json(),
    );
    expect(
      mails.map((m) => [m.customer.name, m.subject, m.basis, m.fromDomain, m.sla.target]),
    ).toEqual([
      [
        'Tom Harris',
        'Where is my order? Tracking says delivered.',
        { header: 'delivered-to', address: 'amz-ca2@forcome.com' },
        'marketplace.amazon.ca',
        'platform',
      ],
      [
        'Lucía Herrera',
        'El filtro no encaja en mi aspiradora.',
        { header: 'to', address: 'info@forcome.mx' },
        'gmail.com',
        'internal',
      ],
    ]);
    const { items } = notificationListSchema.parse(
      await (await supervisor.get('/api/notifications')).json(),
    );
    expect(
      items
        .filter((n) => n.type === 'unassigned_mail')
        .map((n) => [n.title, n.body, n.object.label]),
    ).toEqual(
      expect.arrayContaining([
        ['未归属店铺来信', 'Tom Harris · amz-ca2@forcome.com 未登记', 'P04 · 未归属店铺'],
        ['未归属店铺来信', 'Lucía Herrera · info@forcome.mx 未登记', 'P04 · 未归属店铺'],
      ]),
    );
  });
});
