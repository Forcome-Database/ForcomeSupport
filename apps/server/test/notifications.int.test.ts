import {
  notificationContentSchema,
  notificationListSchema,
  notificationUnreadSchema,
  type NotificationContent,
  type NotificationList,
  type NotificationType,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { OpenAPIHono } from '@hono/zod-openapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ServerDeps } from '../src/deps';
import { createJobHandlers } from '../src/jobs';
import { defineJob, handleJob, sendNotification, transaction } from '../src/modules/core';
import { notifyMembers, type AccessVariables } from '../src/modules/org';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 站内通知（待办 31；PRD 11.1 Notification、11.4、G10）：core 的写入（接收人、类型、关联对象、内容、时间）与
 * org 按 11.4 取接收人，经接口按接收人查询、标记已读与全部已读。
 * 第一期的业务调用方（渠道连接 09/11/12、钉钉同步 05、未归属来信 15、改派队列 23）都还没有：按 11.4 发通知经开发登录环境的
 * 示例通知接口（POST /api/dev/notifications，与业务调用方同一个 org 的 notifyMembers）；显式给接收人的写入接口本身与流水线任务
 * 用测试里的示范接口与示范任务当第一个使用者（ADR 0005「待办 04 落地」的示范接口写法）；回放模式按待办 26 的跑法——流水线的任务
 * 在回放的运行时里跑。
 */

const stores = getDemoFixture().stores;
const storeId = (name: string) => stores.find((s) => s.name === name)!.id;
const DIRECT = storeId('Forcome Direct');
const MX = storeId('forcome.mx');

const GMAIL_DOWN: NotificationContent = {
  type: 'channel_disconnected',
  title: 'Gmail 连接异常',
  body: 'support@forcome.mx 连续 3 次失败，来信暂存',
  object: { type: 'channel', id: 'gmail', label: 'P18 · Gmail' },
};

/** 写入接口本身：显式给出接收人（第二期按对象定接收人的通知直接调 core 的 sendNotification） */
function demoRoutes({ runtime }: ServerDeps) {
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  routes.post('/api/test/notify-members', async (c) => {
    const { recipientIds, ...content } = notificationContentSchema
      .extend({ recipientIds: z.array(z.string()) })
      .parse(await c.req.json());
    const recipients = await transaction(runtime, (tx) =>
      sendNotification(tx, { ...content, recipientIds }),
    );
    return c.json({ recipients });
  });
  return routes;
}

/** 示范的流水线任务：例如未归属来信入库后通知客服主管（15 号待办）；历史回放（26）在回放的运行时里跑它 */
const demoInboundJob = defineJob('channel.demo_unassigned_mail', z.object({ sender: z.string() }));
const demoInboundHandler = handleJob(demoInboundJob, async ({ sender }, { runtime }) => {
  await transaction(runtime, (tx) =>
    notifyMembers(tx, {
      type: 'unassigned_mail',
      title: '未归属店铺来信',
      body: `${sender} · amz-ca2@forcome.com 未登记`,
      object: { type: 'message', id: sender, label: 'P04 · 未归属店铺' },
    }),
  );
});

let t: TestHarness;

beforeAll(async () => {
  t = await startTestHarness({
    routes: demoRoutes,
    jobHandlers: (deps) => [...createJobHandlers(deps), demoInboundHandler],
  });
});

afterAll(async () => {
  await t.close();
});

/** 按 11.4 发一条（示例通知接口，与业务调用方同一个 notifyMembers），返回发给了谁（成员 ID）；at 为示例通知的时刻 */
async function notify(content: NotificationContent & { at?: string }): Promise<string[]> {
  const res = await t.api.post('/api/dev/notifications', content);
  expect(res.status).toBe(200);
  return ((await res.json()) as { recipients: string[] }).recipients;
}

async function list(client: ApiClient, view?: 'all' | 'unread'): Promise<NotificationList> {
  const res = await client.get(`/api/notifications${view ? `?view=${view}` : ''}`);
  expect(res.status).toBe(200);
  return notificationListSchema.parse(await res.json());
}

async function unread(client: ApiClient): Promise<number> {
  const res = await client.get('/api/notifications/unread-count');
  expect(res.status).toBe(200);
  return notificationUnreadSchema.parse(await res.json()).unread;
}

/** 新建一位成员登录（每条用例自己的接收人，互不干扰） */
async function member(
  roles: ('agent' | 'supervisor' | 'admin' | 'aftersales_owner')[],
  storeIds?: string[],
): Promise<ApiClient> {
  const id = await t.addMember({
    name: `成员${Math.random().toString(36).slice(2, 6)}`,
    dept: 'FSH / 客服部',
    roles,
    allStores: storeIds === undefined,
    storeIds,
  });
  return t.loginAs({ memberId: id });
}

describe('写入与按接收人查询（PRD 11.1 Notification、11.4）', () => {
  it('写入后接收人可查到（类型、标题、说明、对象、时间、未读），其他人查不到', async () => {
    t.clock.set('2026-09-11T02:05:00Z');
    const supervisor = await t.loginAs('客服主管');
    const admin = await t.loginAs('管理员');
    const agent = await t.loginAs('坐席');
    const owner = await t.loginAs('售后负责人');
    const before = { supervisor: await unread(supervisor), admin: await unread(admin) };

    // 渠道连接异常：管理员、客服主管（11.4）
    const members = getDemoFixture().members;
    expect(await notify(GMAIL_DOWN)).toEqual(
      expect.arrayContaining(
        members.filter((m) => m.key === 'zhoumin' || m.key === 'liuyang').map((m) => m.id),
      ),
    );

    for (const recipient of [supervisor, admin]) {
      const { items, now } = await list(recipient);
      // 服务端的当前时刻：面板按它判断时间是不是当天
      expect(now).toBe('2026-09-11T02:05:00.000Z');
      expect(items[0]).toMatchObject({
        type: 'channel_disconnected',
        title: 'Gmail 连接异常',
        body: 'support@forcome.mx 连续 3 次失败，来信暂存',
        object: { type: 'channel', id: 'gmail', label: 'P18 · Gmail' },
        createdAt: '2026-09-11T02:05:00.000Z',
        read: false,
      });
    }
    expect(await unread(supervisor)).toBe(before.supervisor + 1);
    expect(await unread(admin)).toBe(before.admin + 1);
    for (const other of [agent, owner]) {
      expect(await list(other)).toMatchObject({ items: [], unread: 0 });
      expect(await unread(other)).toBe(0);
    }
  });

  it.each<[NotificationType, string[]]>([
    ['dingtalk_sync_failed', ['admin']],
    ['unassigned_mail', ['supervisor']],
    ['channel_recovered', ['admin', 'supervisor']],
  ])('%s 只发给 11.4 写的接收人（%s）', async (type, expected) => {
    const supervisor = await member(['supervisor']);
    const admin = await member(['admin']);
    const agent = await member(['agent']);

    await notify({ ...GMAIL_DOWN, type, title: `示范 ${type}` });

    const got = async (client: ApiClient) =>
      (await list(client)).items.some((item) => item.title === `示范 ${type}`);
    expect(await got(supervisor)).toBe(expected.includes('supervisor'));
    expect(await got(admin)).toBe(expected.includes('admin'));
    expect(await got(agent)).toBe(false);
  });

  it('多角色的成员只收一条；已停用的成员不收', async () => {
    const bothId = await t.addMember({
      name: '兼管理员的主管',
      dept: 'FSH / 客服部',
      roles: ['supervisor', 'admin'],
      allStores: true,
    });
    const disabledId = await t.addMember({
      name: '已停用的主管',
      dept: 'FSH / 客服部',
      roles: ['supervisor'],
      allStores: true,
      status: 'disabled',
    });

    const recipients = await notify({ ...GMAIL_DOWN, title: '多角色只收一条' });

    expect(recipients.filter((id) => id === bothId)).toHaveLength(1);
    expect(recipients).not.toContain(disabledId);
    const both = await t.loginAs({ memberId: bothId });
    expect((await list(both)).items.filter((i) => i.title === '多角色只收一条')).toHaveLength(1);
  });

  it('关联对象属于店铺的通知只发给店铺范围包含该店铺的接收人（R-ST-06）', async () => {
    const directOnly = await member(['supervisor'], [DIRECT]);
    const mxOnly = await member(['supervisor'], [MX]);
    const all = await member(['supervisor']);

    await notify({
      type: 'reassign_queue',
      title: '售后单待改派',
      body: '赵六已停用，1 张进行中的售后单进入改派队列',
      object: { type: 'member', id: 'zhaoliu', label: 'P13 · 待分配' },
      storeId: DIRECT,
    });

    const got = async (client: ApiClient) =>
      (await list(client)).items.some((item) => item.title === '售后单待改派');
    expect(await got(directOnly)).toBe(true);
    expect(await got(all)).toBe(true);
    expect(await got(mxOnly)).toBe(false);
  });

  it('按店铺发的类型必须给出店铺，否则写入失败', async () => {
    const res = await t.api.post('/api/dev/notifications', {
      ...GMAIL_DOWN,
      type: 'unassigned_mail_placed',
    });
    expect(res.status).toBe(500);
  });

  it('店铺范围外的旧通知不再显示（范围收窄后，同 P27 v2.21）', async () => {
    const id = await t.addMember({
      name: '只管墨西哥站',
      dept: 'FSH / 客服部',
      roles: ['supervisor'],
      allStores: false,
      storeIds: [MX],
    });
    const client = await t.loginAs({ memberId: id });

    // 显式接收人写入（模拟写入时还在范围内、之后范围收窄）：范围外店铺的、本店铺的、没有店铺属性的各一条
    const send = async (title: string, type: NotificationType, store: string | null) => {
      t.clock.advance({ minutes: 1 });
      const res = await t.api.post('/api/test/notify-members', {
        ...GMAIL_DOWN,
        type,
        title,
        storeId: store,
        recipientIds: [id],
      });
      expect(res.status).toBe(200);
    };
    await send('范围外的店铺', 'unassigned_mail_placed', DIRECT);
    await send('本店铺的', 'unassigned_mail_placed', MX);
    await send('没有店铺属性', 'channel_disconnected', null);

    const { items, unread: count } = await list(client);
    expect(items.map((i) => i.title)).toEqual(['没有店铺属性', '本店铺的']);
    expect(count).toBe(2);
    expect(await unread(client)).toBe(2);
  });

  it('新的在前，最多列出最近 50 条；未读数是全部未读', async () => {
    const id = await t.addMember({
      name: '通知很多的主管',
      dept: 'FSH / 客服部',
      roles: ['supervisor'],
      allStores: true,
    });
    const client = await t.loginAs({ memberId: id });
    t.clock.set('2026-09-11T00:00:00Z');
    for (let i = 1; i <= 52; i += 1) {
      t.clock.advance({ minutes: 1 });
      await t.api.post('/api/test/notify-members', {
        ...GMAIL_DOWN,
        title: `第 ${i} 条`,
        recipientIds: [id],
      });
    }

    const { items, unread: count } = await list(client);
    expect(items).toHaveLength(50);
    expect(items[0]?.title).toBe('第 52 条');
    expect(items[49]?.title).toBe('第 3 条');
    expect(count).toBe(52);
  });
});

describe('标记已读与全部已读（G10）', () => {
  it('点一条标为已读：该条已读，未读数减一，未读页签不再列出；重复标记不报错', async () => {
    const client = await member(['supervisor']);
    await notify({ ...GMAIL_DOWN, title: '第一条' });
    await notify({ ...GMAIL_DOWN, title: '第二条' });
    const { items } = await list(client);
    const first = items.find((i) => i.title === '第一条')!;
    const before = await unread(client);

    const res = await client.post(`/api/notifications/${first.id}/read`);
    expect(res.status).toBe(204);

    const after = await list(client);
    expect(after.items.find((i) => i.id === first.id)?.read).toBe(true);
    expect(after.unread).toBe(before - 1);
    expect((await list(client, 'unread')).items.map((i) => i.id)).not.toContain(first.id);
    expect((await client.post(`/api/notifications/${first.id}/read`)).status).toBe(204);
    expect(await unread(client)).toBe(before - 1);
  });

  it('不能标记别人的通知（404），也不影响对方', async () => {
    const owner = await member(['supervisor']);
    const other = await member(['supervisor']);
    await notify({ ...GMAIL_DOWN, title: '别人的' });
    const mine = (await list(owner)).items.find((i) => i.title === '别人的')!;
    const before = await unread(owner);

    const res = await other.post(`/api/notifications/${mine.id}/read`);
    expect(res.status).toBe(404);
    expect(await unread(owner)).toBe(before);
    expect((await t.api.post(`/api/notifications/${mine.id}/read`)).status).toBe(401);
  });

  it('全部已读：自己的未读全部标为已读，别人的不变', async () => {
    const client = await member(['supervisor', 'admin']);
    const other = await member(['supervisor']);
    await notify({ ...GMAIL_DOWN, title: '甲' });
    await notify({ ...GMAIL_DOWN, type: 'dingtalk_sync_failed', title: '乙' });
    expect(await unread(client)).toBeGreaterThanOrEqual(2);
    const otherBefore = await unread(other);

    const res = await client.post('/api/notifications/read-all');
    expect(res.status).toBe(204);

    expect(await unread(client)).toBe(0);
    expect((await list(client)).items.every((item) => item.read)).toBe(true);
    expect(await list(client, 'unread')).toMatchObject({ items: [], unread: 0 });
    expect(await unread(other)).toBe(otherBefore);
  });

  it('没有登录不能查看（401）', async () => {
    expect((await t.api.get('/api/notifications')).status).toBe(401);
    expect((await t.api.get('/api/notifications/unread-count')).status).toBe(401);
    expect((await t.api.post('/api/notifications/read-all')).status).toBe(401);
  });
});

describe('历史回放（待办 26；规格「历史导入与切换」：提醒与通知在回放模式下关闭）', () => {
  it('回放模式下调用写入不产生通知；同一条流水线实时跑时照常通知', async () => {
    const supervisor = await member(['supervisor']);

    await t.enqueue(demoInboundJob, { sender: 'Replay Harris' });
    const replayed = await t.runJobs({ replay: true });
    expect(replayed.completed.map((job) => job.name)).toContain(demoInboundJob.name);
    expect((await list(supervisor)).items).toEqual([]);
    expect(await unread(supervisor)).toBe(0);

    await t.enqueue(demoInboundJob, { sender: 'Live Harris' });
    await t.runJobs();
    expect((await list(supervisor)).items.map((item) => item.body)).toEqual([
      'Live Harris · amz-ca2@forcome.com 未登记',
    ]);
  });
});

describe('示例通知接口（开发登录环境；按 11.4 发的用例都经它）', () => {
  it('可以指定时刻（演示与 e2e 造前一天的通知，G10 跨天写法）；不指定为服务端当前时间', async () => {
    t.clock.set('2026-09-11T02:20:00Z');
    const supervisor = await member(['supervisor']);
    await notify({ ...GMAIL_DOWN, title: '前一天的', at: '2026-09-10T18:12:00+08:00' });
    await notify({ ...GMAIL_DOWN, title: '当天的' });

    const { items, now } = await list(supervisor);
    expect(now).toBe('2026-09-11T02:20:00.000Z');
    expect(items.map((i) => [i.title, i.createdAt])).toEqual([
      ['当天的', '2026-09-11T02:20:00.000Z'],
      ['前一天的', '2026-09-10T10:12:00.000Z'],
    ]);
  });

  it('第一期没有的类型 400', async () => {
    const res = await t.api.post('/api/dev/notifications', {
      type: 'approval_created',
      title: '新审批单',
      body: '',
      object: { type: 'approval', id: 'AP-20260911-004', label: 'AP-20260911-004' },
    });
    expect(res.status).toBe(400);
  });
});

describe('示例数据（原型 G10 周敏的面板，第一期的类型）', () => {
  it('灌示例数据后周敏有 4 条通知、3 条未读；重复灌不重复、不重置已读', async () => {
    const zhoumin = getDemoFixture().members.find((m) => m.key === 'zhoumin')!;
    await t.loadFixtures();
    const client = await t.loginAs({ memberId: zhoumin.id });
    // 示例通知按夹具里的 id 认（本文件前面的用例也给客服主管发过通知）；时刻都在演示当天，新的在前
    const fixtureIds = new Set(getDemoFixture().notifications.map((n) => n.id));
    const fixtureItems = async () =>
      (await list(client)).items.filter((item) => fixtureIds.has(item.id));

    expect((await fixtureItems()).map((i) => [i.title, i.body, i.object.label, i.read])).toEqual([
      ['Gmail 已恢复', 'support@forcome.mx 已重新连接，补拉 3 封来信', 'P18 · Gmail', false],
      ['Gmail 连接异常', 'support@forcome.mx 连续 3 次失败，来信暂存', 'P18 · Gmail', false],
      ['未归属店铺来信', 'Tom Harris · amz-ca2@forcome.com 未登记', 'P04 · 未归属店铺', false],
      ['未归属店铺来信', 'Lucía Herrera · info@forcome.mx 未登记', 'P04 · 未归属店铺', true],
    ]);

    const tom = (await list(client)).items.find((i) => i.body.startsWith('Tom Harris'))!;
    await client.post(`/api/notifications/${tom.id}/read`);
    await t.loadFixtures();
    const again = await fixtureItems();
    expect(again).toHaveLength(4);
    expect(again.find((i) => i.id === tom.id)?.read).toBe(true);
  });
});
