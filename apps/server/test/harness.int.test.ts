import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineJob, handleJob, recordAudit, systemActor, transaction } from '../src/modules/core';
import {
  defineClient,
  ExternalCallFailedError,
  FaultInjector,
  type FakeClient,
} from '../src/modules/integration';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 测试工具自己的测试（待办 02）：按角色建会话、推进时钟、「跑完所有已排队任务」、注入与重置 Fake、
 * 灌示例数据。这里用示范的任务与外部客户端，业务待办里换成各模块真实的任务与客户端。
 */

// 示范外部客户端：查快递单号是否签收（全局客户端）
interface ExampleTrackingClient {
  delivered(trackingNo: string): Promise<boolean>;
}
class FakeExampleTracking implements FakeClient<ExampleTrackingClient> {
  readonly faults = new FaultInjector('example_tracking');
  readonly delivered = new Set<string>();
  client(): ExampleTrackingClient {
    return {
      delivered: async (trackingNo) => {
        await this.faults.check('delivered');
        return this.delivered.has(trackingNo);
      },
    };
  }
  reset(): void {
    this.delivered.clear();
    this.faults.reset();
  }
}
const exampleTracking = defineClient({
  system: 'example_tracking',
  scope: 'global',
  createReal: (): ExampleTrackingClient => {
    throw new Error('测试里不应该用到真实现');
  },
  createFake: () => new FakeExampleTracking(),
});

// 示范任务：查一次签收；签收了就再排一个「通知」任务（任务里排任务，看 runJobs 能否一并跑完）
const checkDelivery = defineJob('example.check_delivery', z.object({ trackingNo: z.string() }), {
  retryLimit: 2,
});
const notifyDelivered = defineJob('example.notify_delivered', z.object({ trackingNo: z.string() }));
// 示范的坏任务：每次处理都再排一个自己，用来验证 runJobs 不会无限跑下去
const runaway = defineJob('example.runaway', z.object({ n: z.number() }), { retryLimit: 0 });

let t: TestHarness;
const handled: string[] = [];

beforeAll(async () => {
  t = await startTestHarness({
    clientDefinitions: [exampleTracking],
    // 示范客户端清单里没有 Gmail，不拉 Gmail 推送
    feeds: () => [],
    jobHandlers: ({ clients }) => [
      handleJob(checkDelivery, async ({ trackingNo }, { runtime }) => {
        handled.push(`check:${trackingNo}`);
        if (await clients.global(exampleTracking).delivered(trackingNo)) {
          await transaction(runtime, (tx) => tx.enqueue(notifyDelivered, { trackingNo }));
        }
      }),
      handleJob(runaway, async ({ n }, { runtime }) => {
        await transaction(runtime, (tx) => tx.enqueue(runaway, { n: n + 1 }));
      }),
      handleJob(notifyDelivered, async ({ trackingNo }, { runtime }) => {
        handled.push(`notify:${trackingNo}`);
        // 任务里的「当前时间」也来自手动时钟
        await transaction(runtime, (tx) =>
          recordAudit(tx, systemActor, {
            action: 'example.notified',
            objectType: 'aftersales',
            objectId: trackingNo,
          }),
        );
      }),
    ],
  });
});

afterAll(async () => {
  await t.close();
});

beforeEach(() => {
  handled.length = 0;
  t.resetFakes();
});

describe('跑完所有已排队任务（runJobs）', () => {
  it('处理已排队的任务，以及处理过程中新排进来的任务，直到空闲', async () => {
    t.clients.fake(exampleTracking).delivered.add('1Z-A');
    await t.enqueue(checkDelivery, { trackingNo: '1Z-A' });
    await t.enqueue(checkDelivery, { trackingNo: '1Z-B' });

    const report = await t.runJobs();

    expect(handled).toEqual(['check:1Z-A', 'check:1Z-B', 'notify:1Z-A']);
    expect(report.completed.map((j) => j.name)).toEqual([
      'example.check_delivery',
      'example.check_delivery',
      'example.notify_delivered',
    ]);
    expect(await t.runJobs()).toEqual({ completed: [], failed: [] });
  });

  it('延后开始的任务也跑（测试时间由手动时钟控制，不等真实时间）', async () => {
    await t.enqueue(checkDelivery, { trackingNo: '1Z-LATER' }, { startAfter: 86_400 });
    await t.runJobs();
    expect(handled).toEqual(['check:1Z-LATER']);
  });

  it('任务失败默认抛错并写明任务名；本次不重试，下次 runJobs 按 pg-boss 的重试再跑', async () => {
    const fake = t.clients.fake(exampleTracking);
    fake.faults.failNext({ kind: 'error', status: 503 });
    await t.enqueue(checkDelivery, { trackingNo: '1Z-RETRY' });

    await expect(t.runJobs()).rejects.toThrow(/example\.check_delivery.*503/);
    expect(handled).toEqual(['check:1Z-RETRY']);

    fake.delivered.add('1Z-RETRY');
    const retried = await t.runJobs();
    expect(retried.completed.map((j) => j.name)).toEqual([
      'example.check_delivery',
      'example.notify_delivered',
    ]);
  });

  it('allowFailures 时不抛错，失败的任务列在报告里', async () => {
    t.clients.fake(exampleTracking).faults.failNext({ kind: 'timeout' }, { times: 3 });
    await t.enqueue(checkDelivery, { trackingNo: '1Z-DOWN' });

    const report = await t.runJobs({ allowFailures: true });

    expect(report.completed).toEqual([]);
    expect(report.failed).toEqual([
      expect.objectContaining({ name: 'example.check_delivery', data: { trackingNo: '1Z-DOWN' } }),
    ]);
    // 队列设了重试 2 次：再跑两次用完重试，之后不再排队
    await t.runJobs({ allowFailures: true });
    await t.runJobs({ allowFailures: true });
    expect(await t.runJobs()).toEqual({ completed: [], failed: [] });
  });

  it('任务互相触发、一直跑不完时，超过轮数就停下并报错，留下的任务记为失败', async () => {
    await t.enqueue(runaway, { n: 0 });

    await expect(t.runJobs({ maxRounds: 3 })).rejects.toThrow(/跑了 3 轮.*example\.runaway/);
    expect(await t.runJobs()).toEqual({ completed: [], failed: [] });
  });
});

describe('推进时钟', () => {
  it('接口与任务里的「当前时间」都来自手动时钟', async () => {
    t.clock.set('2026-09-11T02:20:00Z');
    t.clock.advance({ days: 7, minutes: 1 });
    t.clients.fake(exampleTracking).delivered.add('1Z-CLOCK');
    await t.enqueue(checkDelivery, { trackingNo: '1Z-CLOCK' });
    await t.runJobs();

    const [record] = await t.auditRecords({ action: 'example.notified', objectId: '1Z-CLOCK' });
    expect(record?.occurredAt).toEqual(new Date('2026-09-18T02:21:00Z'));
    const health = (await (await t.api.get('/api/health')).json()) as { time: string };
    expect(health.time).toBe('2026-09-18T02:21:00.000Z');
  });
});

describe('注入与重置 Fake', () => {
  it('被测代码经 IntegrationClients 拿到的就是测试里那个 Fake；重置后数据与故障都清空', async () => {
    const fake = t.clients.fake(exampleTracking);
    fake.delivered.add('1Z-SAME');
    fake.faults.failNext({ kind: 'error' });
    await expect(t.clients.global(exampleTracking).delivered('1Z-SAME')).rejects.toBeInstanceOf(
      ExternalCallFailedError,
    );

    t.resetFakes();

    await expect(t.clients.global(exampleTracking).delivered('1Z-SAME')).resolves.toBe(false);
    expect(fake.faults.calls).toEqual(['delivered']);
  });
});

describe('按角色建会话', () => {
  it('每个第一期角色都能登录，审计里记下各自的来源 IP', async () => {
    for (const [label, role] of [
      ['坐席', 'agent'],
      ['客服主管', 'supervisor'],
      ['售后负责人', 'aftersales_owner'],
      ['知识库负责人', 'knowledge_owner'],
      ['管理员', 'admin'],
    ]) {
      const client = await t.loginAs(label!, { ip: '10.20.9.9' });
      const me = (await (await client.get('/api/me')).json()) as { roles: string[] };
      expect(me.roles).toEqual([role]);
    }
    const logins = await t.auditRecords({ action: 'auth.login' });
    expect(logins.filter((r) => r.ip === '10.20.9.9')).toHaveLength(5);
  });

  it('示例数据里没有的角色或成员给出明确的错误', async () => {
    await expect(t.loginAs('仓库管理员')).rejects.toThrow(/没有角色「仓库管理员」/);
    await expect(t.loginAs({ member: 'nobody' })).rejects.toThrow(/没有成员 nobody/);
    // 生产厂对接人第一期不能进入（PRD 4.1、AC-P1-21）：开发登录列出了，登录被拒
    await expect(t.loginAs({ member: 'chengong' })).rejects.toThrow(
      /开发登录失败（403）.*工厂工作台第二阶段上线/,
    );
  });
});

describe('灌示例数据', () => {
  it('按各模块登记的加载步骤灌库，重复加载不报错（测试工具启动时已灌过示例成员）', async () => {
    const steps = [
      'org.members',
      'channel.stores',
      'channel.sender_rules',
      'factory.parts',
      'aftersales.ledger',
    ];
    await expect(t.loadFixtures()).resolves.toEqual({ steps });
    await expect(t.loadFixtures()).resolves.toEqual({ steps });
  });
});

describe('开发测试环境（HTTPS）的会话 Cookie', () => {
  it('带 Secure', async () => {
    const staging = await startTestHarness({ appEnv: 'staging' });
    try {
      const res = await staging.api.get('/api/dev/members');
      const { members } = (await res.json()) as { members: { id: string }[] };
      const login = await staging.api.post('/api/dev/login', { memberId: members[0]?.id });
      expect(login.headers.getSetCookie()[0]).toContain('Secure');
    } finally {
      await staging.close();
    }
  });
});

describe('测试库互相隔离', () => {
  it('每个测试文件一个独立的库', async () => {
    const result = await t.runtime.db.execute<{ name: string }>(
      sql`SELECT current_database() AS name`,
    );
    expect(result.rows[0]?.name).toMatch(/^forcome_test_[0-9a-f]{8}_[0-9a-f]{8}$/);
  });
});
