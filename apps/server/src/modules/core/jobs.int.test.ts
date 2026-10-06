import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createTestDatabase,
  createTestRuntime,
  type TestDatabase,
  type TestRuntime,
} from '../../../test/database';
import {
  defineJob,
  ensureQueues,
  handleJob,
  recordAudit,
  silentLogger,
  startWorker,
  systemActor,
  transaction,
} from './index';

// 只在本测试里用的示范任务：载荷带一个标记，处理器把收到的标记记下来
const echoJob = defineJob('test.echo', z.object({ marker: z.string() }));
// 示范定时任务：每天北京时间 06:00，worker 启动时也排一次
const tickJob = defineJob('test.tick', z.object({}), undefined, {
  cron: '0 6 * * *',
  tz: 'Asia/Shanghai',
  runAtStartup: true,
});

// 示范并发任务：一个 worker 进程同时处理 3 个（处理器等放行，记下同时在处理的最大个数）
const slowJob = defineJob('test.slow', z.object({ n: z.int() }), undefined, undefined, 3);
let running = 0;
let peak = 0;
let release: () => void = () => undefined;
const gate = new Promise<void>((resolve) => (release = resolve));

let database: TestDatabase;
let t: TestRuntime;
const received: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  t = await createTestRuntime(database.url, { role: 'worker' });
  await ensureQueues(t.runtime.boss, [echoJob, slowJob]);
  await startWorker(
    t.runtime,
    [
      handleJob(echoJob, ({ marker }) => {
        received.push(marker);
        return Promise.resolve();
      }),
      handleJob(tickJob, () => {
        received.push('tick');
        return Promise.resolve();
      }),
      handleJob(slowJob, async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate;
        running -= 1;
      }),
    ],
    { logger: silentLogger, pollingIntervalSeconds: 0.5 },
  );
});

afterAll(async () => {
  await t.close();
  await database.drop();
});

describe('后台任务：任务表即发件箱（ADR 0008）', () => {
  it('业务事务提交后，worker 消费到事务里插入的任务', async () => {
    await transaction(t.runtime, async (tx) => {
      await recordAudit(tx, systemActor, {
        action: 'store.create',
        objectType: 'store',
        objectId: 's1',
      });
      await tx.enqueue(echoJob, { marker: 'committed' });
    });

    await vi.waitFor(() => expect(received).toContain('committed'), {
      timeout: 10_000,
      interval: 100,
    });
  });

  it('业务事务回滚时任务一并撤销，worker 永远收不到', async () => {
    await expect(
      transaction(t.runtime, async (tx) => {
        await tx.enqueue(echoJob, { marker: 'rolled-back' });
        throw new Error('业务失败');
      }),
    ).rejects.toThrow('业务失败');
    // 之后再发一个提交的任务，等它被处理，证明队列已经走过回滚任务本该在的位置
    await transaction(t.runtime, (tx) => tx.enqueue(echoJob, { marker: 'after-rollback' }));
    await vi.waitFor(() => expect(received).toContain('after-rollback'), {
      timeout: 10_000,
      interval: 100,
    });

    expect(received).not.toContain('rolled-back');
    expect(
      await t.runtime.boss.findJobs(echoJob.name, { data: { marker: 'rolled-back' } }),
    ).toEqual([]);
  });

  it('载荷不符合任务模式时在发送端就拒绝，整个事务回滚', async () => {
    await expect(
      transaction(t.runtime, (tx) =>
        // @ts-expect-error 故意传错类型，验证运行时校验
        tx.enqueue(echoJob, { marker: 42 }),
      ),
    ).rejects.toThrow();
  });

  it('定时任务：worker 启动时按 cron 与时区登记到 pg-boss，并立即排一次', async () => {
    const schedules = await t.runtime.boss.getSchedules('test.tick');
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({ cron: '0 6 * * *', options: { tz: 'Asia/Shanghai' } });
    await vi.waitFor(() => expect(received).toContain('tick'), { timeout: 10_000 });
  });

  it('定时任务的载荷要接受 {}（到点排的任务只带空载荷）', () => {
    expect(() =>
      defineJob('test.bad_tick', z.object({ marker: z.string() }), undefined, {
        cron: '* * * * *',
        tz: 'UTC',
      }),
    ).toThrow(/载荷要接受 \{\}/);
  });

  it('任务可设每个 worker 进程的并发数：同时处理几个（待办 11，每分钟按店铺排的同步）', async () => {
    await transaction(t.runtime, async (tx) => {
      for (const n of [1, 2, 3, 4]) await tx.enqueue(slowJob, { n });
    });
    await vi.waitFor(() => expect(peak).toBe(3), { timeout: 10_000, interval: 50 });
    release();
    await vi.waitFor(() => expect(running).toBe(0), { timeout: 10_000, interval: 50 });
    expect(peak).toBe(3);
    expect(() => defineJob('test.bad', z.object({}), undefined, undefined, 0)).toThrow(/正整数/);
  });

  it('任务名必须是「模块.任务」形式', () => {
    expect(() => defineJob('EchoJob', z.object({}))).toThrow(/模块\.任务/);
    expect(() => defineJob('ticket.merge_inbound', z.object({}))).not.toThrow();
  });
});
