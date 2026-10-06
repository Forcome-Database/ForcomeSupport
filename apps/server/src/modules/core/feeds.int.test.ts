import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createTestDatabase,
  createTestRuntime,
  type TestDatabase,
  type TestRuntime,
} from '../../../test/database';
import { defineFeed, silentLogger, startFeeds, type RunningFeeds } from './index';

/*
 * 常驻拉取的选主（ADR 0008「常驻连接用 advisory lock 保证只有一个 worker 持有，持有者挂掉时自动由其他实例接手」，待办 05）：
 * 两个 worker（同一个库上的两个运行时）都起同一个独占的拉取源，只有一个在拉；持有者停止后另一个接手，
 * 交出持有权时断开长连接（release）。普通的拉取源两个 worker 都拉。用真实的计时，间隔调短。
 */

const TIMING = { waitSeconds: 0, idleMs: 20, standbyMs: 50, heartbeatMs: 50 };

let database: TestDatabase;
let a: TestRuntime;
let b: TestRuntime;

beforeAll(async () => {
  database = await createTestDatabase();
  a = await createTestRuntime(database.url, { role: 'worker' });
  b = await createTestRuntime(database.url, { role: 'worker' });
});

afterAll(async () => {
  await a.close();
  await b.close();
  await database.drop();
});

/** 一个 worker 上的拉取源：记下它拉了几次、断开了几次 */
function workerFeeds(exclusive: boolean) {
  const stats = { pulls: 0, releases: 0 };
  const feed = defineFeed(
    'test.stream',
    () => {
      stats.pulls += 1;
      return Promise.resolve(0);
    },
    {
      exclusive,
      release: () => {
        stats.releases += 1;
        return Promise.resolve();
      },
    },
  );
  return { feed, stats };
}

describe('独占的常驻拉取：多个 worker 时只有一个在拉', () => {
  it('先拿到持有权的拉，另一个待命；持有者停止（交出持有权、断开长连接）后另一个接手', async () => {
    const onA = workerFeeds(true);
    const onB = workerFeeds(true);
    const runningA = startFeeds(a.runtime, [onA.feed], { logger: silentLogger, timing: TIMING });
    await vi.waitFor(() => expect(onA.stats.pulls).toBeGreaterThan(0));
    const runningB = startFeeds(b.runtime, [onB.feed], { logger: silentLogger, timing: TIMING });
    let stopped: RunningFeeds | null = null;
    try {
      // B 至少试过几轮选主，仍然没有拉
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(onB.stats.pulls).toBe(0);

      await runningA.stop();
      stopped = runningA;
      expect(onA.stats.releases).toBe(1);
      const pullsOfA = onA.stats.pulls;
      await vi.waitFor(() => expect(onB.stats.pulls).toBeGreaterThan(0));
      expect(onA.stats.pulls).toBe(pullsOfA);
    } finally {
      if (!stopped) await runningA.stop();
      await runningB.stop();
    }
    expect(onB.stats.releases).toBe(1);
  });

  it('持有者的数据库连接断了（进程崩溃时同样如此）：锁随连接释放，持有者停拉并断开长连接，之后仍只有一个在拉', async () => {
    const onA = workerFeeds(true);
    const onB = workerFeeds(true);
    const runningA = startFeeds(a.runtime, [onA.feed], { logger: silentLogger, timing: TIMING });
    await vi.waitFor(() => expect(onA.stats.pulls).toBeGreaterThan(0));
    const runningB = startFeeds(b.runtime, [onB.feed], { logger: silentLogger, timing: TIMING });
    const holders = async () => {
      // 只看应用连接池上的（pg-boss 自己的连接名是 forcome-worker-pgboss，它也会短暂持有咨询锁）
      const { rows } = await b.runtime.db.$client.query<{ pid: number }>(
        `SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' AND l.granted AND a.application_name = 'forcome-worker'`,
      );
      return rows.map((row) => row.pid);
    };
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(onB.stats.pulls).toBe(0);
      const [holder] = await holders();
      // 从 B 的连接上断掉持有咨询锁的那条连接
      await b.runtime.db.$client.query('SELECT pg_terminate_backend($1)', [holder]);
      // A 发现持有权没了：停拉、断开长连接
      await vi.waitFor(() => expect(onA.stats.releases).toBe(1));
      // 之后由重新选出的一个（A 或 B）接着拉，锁只在一条连接上
      const before = onA.stats.pulls + onB.stats.pulls;
      await vi.waitFor(() => expect(onA.stats.pulls + onB.stats.pulls).toBeGreaterThan(before));
      const after = await holders();
      expect(after).toHaveLength(1);
      expect(after[0]).not.toBe(holder);
    } finally {
      await runningA.stop();
      await runningB.stop();
    }
  });

  it('普通的拉取源每个 worker 都拉', async () => {
    const onA = workerFeeds(false);
    const onB = workerFeeds(false);
    const runningA = startFeeds(a.runtime, [onA.feed], { logger: silentLogger, timing: TIMING });
    const runningB = startFeeds(b.runtime, [onB.feed], { logger: silentLogger, timing: TIMING });
    try {
      await vi.waitFor(() => {
        expect(onA.stats.pulls).toBeGreaterThan(0);
        expect(onB.stats.pulls).toBeGreaterThan(0);
      });
    } finally {
      await runningA.stop();
      await runningB.stop();
    }
  });
});
