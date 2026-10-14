import { LIVE_EVENT, LIVE_PATH, liveEventSchema, type LiveTopic } from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gmailClient, type FakeGmail, type FakeMailInput } from '../src/modules/integration';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 实时推送（待办 18；ADR 0006「SSE」，规格故事 61「数据变化时页面自动刷新」）：/api/live 是 SSE 连接，开始监听后先发 ready；
 * 业务事务里的 NOTIFY 随提交送到 api，推「某类对象变了」——新来信入库归并后推「工单变了」；站内通知只推给接收人，
 * 未归属店铺队列只推给有「指定店铺」能力的。连接不续期会话，会话结束（7 天无操作）后心跳时断开，重连得到 401。
 */

const stores = getDemoFixture().stores;
const AUTO = stores.find((s) => s.name === 'Forcome Auto')!;
const DIRECT = stores.find((s) => s.name === 'Forcome Direct')!;

/** 测试里调短的心跳（生产 25 秒） */
const HEARTBEAT_MS = 100;

interface LiveMessage {
  readonly event: string;
  readonly data: string;
}

/** 一条打开着的推送：按顺序读出一条条事件（注释行的心跳不算） */
interface LiveStream {
  next(timeoutMs?: number): Promise<LiveMessage | 'closed'>;
  /** 下一条「某类对象变了」 */
  nextTopic(timeoutMs?: number): Promise<LiveTopic>;
  close(): Promise<void>;
}

async function openLive(client: ApiClient): Promise<LiveStream> {
  const res = await client.get(LIVE_PATH);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let ended = false;

  async function next(timeoutMs = 10_000): Promise<LiveMessage | 'closed'> {
    for (;;) {
      const split = buffer.indexOf('\n\n');
      if (split >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const lines = block.split('\n').filter((line) => !line.startsWith(':'));
        if (lines.length === 0) continue;
        const field = (name: string) =>
          lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2) ?? '';
        return { event: field('event') || 'message', data: field('data') };
      }
      if (ended) return 'closed';
      let timer: NodeJS.Timeout | undefined;
      const read = await Promise.race([
        reader.read(),
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), timeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
      if (read === 'timeout') throw new Error(`推送 ${timeoutMs}ms 内没有新内容`);
      if (read.done) ended = true;
      else buffer += read.value;
    }
  }

  const ready = await next();
  expect(ready).toMatchObject({ event: 'ready' });
  return {
    next,
    async nextTopic(timeoutMs) {
      const message = await next(timeoutMs);
      if (message === 'closed') throw new Error('推送已断开');
      expect(message.event).toBe(LIVE_EVENT);
      return liveEventSchema.parse(JSON.parse(message.data)).topic;
    },
    async close() {
      await reader.cancel().catch(() => undefined);
    },
  };
}

function letter(name: string, overrides: Partial<FakeMailInput> = {}): FakeMailInput {
  return {
    to: AUTO.mailbox,
    from: { name, address: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com` },
    subject: `Question from ${name}`,
    text: 'Hello',
    at: '2026-09-11T09:00:00+08:00',
    ...overrides,
  };
}

/** 写给没登记的地址、落在 Forcome Direct 邮箱里的买家消息（进未归属店铺队列，通知客服主管） */
function unassignedLetter(name: string): FakeMailInput {
  return {
    to: 'amz-ca2@forcome.com',
    mailbox: DIRECT.mailbox,
    deliveredTo: 'amz-ca2@forcome.com',
    from: { name, address: `${name.toLowerCase().replace(/\W+/g, '.')}@marketplace.amazon.ca` },
    subject: `Where is my order? (${name})`,
    text: 'Tracking says delivered but nothing arrived.',
    at: '2026-09-11T10:02:00+08:00',
  };
}

describe('实时推送', () => {
  let t: TestHarness;
  let gmail: FakeGmail;

  beforeAll(async () => {
    t = await startTestHarness({ liveHeartbeatMs: HEARTBEAT_MS });
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    // 邮箱开始监听（之后到达的来信才同步进来）
    await t.runJobs();
  });

  afterAll(async () => {
    await t.close();
  });

  it('新来信入库归并成工单后，推送「工单变了」（不带数据）', async () => {
    const live = await openLive(await t.loginAs('坐席'));
    try {
      gmail.deliver(letter('Live Buyer'));
      await t.runJobs();
      expect(await live.nextTopic()).toBe('tickets');
    } finally {
      await live.close();
    }
  });

  it('只推给该收的人：未归属店铺队列与它的站内通知推给客服主管，坐席只收到之后的「工单变了」', async () => {
    const supervisor = await openLive(await t.loginAs('客服主管'));
    const agent = await openLive(await t.loginAs('坐席'));
    try {
      gmail.deliver(unassignedLetter('Queue Buyer'));
      await t.runJobs();
      const topics = new Set([await supervisor.nextTopic(), await supervisor.nextTopic()]);
      expect(topics).toEqual(new Set(['unassigned_mail', 'notifications']));

      // 坐席没有「指定店铺」能力、也不是通知的接收人：前面两条都没有，下一条就是工单变了
      gmail.deliver(letter('Another Buyer'));
      await t.runJobs();
      expect(await agent.nextTopic()).toBe('tickets');
      expect(await supervisor.nextTopic()).toBe('tickets');
    } finally {
      await supervisor.close();
      await agent.close();
    }
  });

  it('标为已读推给本人（别的标签页跟着刷新），不推给别人', async () => {
    const supervisorClient = await t.loginAs('客服主管');
    const supervisor = await openLive(supervisorClient);
    const agent = await openLive(await t.loginAs('坐席'));
    try {
      expect((await supervisorClient.post('/api/notifications/read-all')).status).toBe(204);
      expect(await supervisor.nextTopic()).toBe('notifications');
      gmail.deliver(letter('Third Buyer'));
      await t.runJobs();
      expect(await agent.nextTopic()).toBe('tickets');
    } finally {
      await supervisor.close();
      await agent.close();
    }
  });

  it('推送连接不续期会话：会话 7 天无操作过期后，心跳时断开，重连得到 401', async () => {
    const client = await t.loginAs('坐席');
    const token = client.cookie('forcome_session');
    expect(token).toBeDefined();
    // 这个会话最近一次续期的时刻（库里只存令牌的 SHA-256）
    const hash = createHash('sha256').update(token!).digest('hex');
    const lastActive = async () => {
      const { rows } = await t.runtime.db.execute<{ last_active_at: Date }>(
        sql`SELECT last_active_at FROM org.session WHERE token_hash = ${hash}`,
      );
      return new Date(rows[0]!.last_active_at).getTime();
    };
    const start = t.clock.now();
    try {
      // 6 天 23 小时后连上推送：会话还有效，但连接不算一次操作
      t.clock.set(new Date(start.getTime() + (7 * 24 - 1) * 3_600_000));
      const before = await lastActive();
      const live = await openLive(client);
      expect(await lastActive()).toBe(before);
      // 再过 2 小时满 7 天：下一次心跳核对会话时断开
      t.clock.set(new Date(start.getTime() + (7 * 24 + 1) * 3_600_000));
      expect(await live.next(5_000)).toBe('closed');
      // 重连被拒（EventSource 读不到说明），会话留着：浏览器随后核对会话时才删掉并拿到 session_expired（G12「已退出登录」）
      expect((await client.get(LIVE_PATH)).status).toBe(401);
      const me = await client.get('/api/me');
      expect(me.status).toBe(401);
      expect(await me.json()).toMatchObject({ error: 'session_expired' });
    } finally {
      t.clock.set(start);
    }
  });

  it('没登录 401', async () => {
    expect((await t.api.get(LIVE_PATH)).status).toBe(401);
  });
});
