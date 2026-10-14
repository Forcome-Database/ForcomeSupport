import { channelSettingsSchema } from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gmailPollJob } from '../src/modules/channel';
import { selfCheckJob, syncExchangeRatesJob } from '../src/modules/core';
import {
  dingtalkClient,
  dingtalkRobotClient,
  exchangeRateClient,
  type FakeDingtalkRobot,
  type FakeExchangeRates,
} from '../src/modules/integration';
import { amazonPollJob, shopifyPollJob } from '../src/modules/order';
import { dingtalkReconcileJob } from '../src/modules/org';
import { startTestHarness, type TestHarness } from './harness';

/*
 * worker 每分钟自检（待办 28；规格「运维」第 97 条，ADR 0013 修订「监控告警」，协调者 2026-10-14 决定 Q1–Q4）：
 * 跑完同步 → 推进时钟、改数据造出异常 → 排一次自检（core.self_check）并跑完 → 看 Fake 钉钉群机器人收到的消息。
 * 心跳、告警状态、任务表与调用记录是运维数据，没有业务接口，直接读写本测试的库（同 order-backfill 读进度）。
 * 同一个库上的用例按顺序进行，时钟前后相接。
 */

const MAILBOXES = getDemoFixture()
  .stores.map((s) => s.mailbox)
  .sort();
const MINUTE = 60_000;

let t: TestHarness;
let robot: FakeDingtalkRobot;
let rates: FakeExchangeRates;

/** 排一次自检并跑完，返回这次机器人收到的消息（没发为 null） */
async function selfCheck() {
  const before = robot.sent.length;
  await t.enqueue(selfCheckJob, {});
  await t.runJobs();
  expect(robot.sent.length - before).toBeLessThanOrEqual(1);
  return robot.sent.length > before ? robot.sent[robot.sent.length - 1]! : null;
}

/** 各数据源同步一轮：Gmail（每个邮箱）、两个平台的订单、钉钉通讯录、汇率 */
async function syncAll() {
  for (const job of [gmailPollJob, shopifyPollJob, amazonPollJob, dingtalkReconcileJob]) {
    await t.enqueue(job, {});
  }
  await t.enqueue(syncExchangeRatesJob, {});
  await t.runJobs();
}

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await t.runtime.db.execute(query)).rows as T[];
}

beforeAll(async () => {
  t = await startTestHarness();
  await t.loadFixtures();
  t.clients.fake(dingtalkClient).replay(getDemoFixture());
  rates = t.clients.fake(exchangeRateClient);
  rates.replay(getDemoFixture());
  robot = t.clients.fake(dingtalkRobotClient);
  await t.runJobs();
  await syncAll();
});

afterAll(async () => {
  await t.close();
});

describe('worker 每分钟自检', () => {
  it('各数据源刚同步过：写心跳，不发告警', async () => {
    const admin = await t.loginAs('管理员');
    const settings = channelSettingsSchema.parse(
      await (await admin.get('/api/channel/settings')).json(),
    );
    expect(settings.channels.map((c) => [c.kind, c.status])).toEqual([
      ['amazon', 'connected'],
      ['shopify', 'connected'],
      ['gmail', 'connected'],
      ['dingtalk', 'connected'],
    ]);

    expect(await selfCheck()).toBeNull();
    const [beat] = await rows<{ beat_at: string; pid: number }>(
      sql`SELECT beat_at, pid FROM core.worker_heartbeat`,
    );
    expect(new Date(beat?.beat_at ?? 0)).toEqual(t.clock.now());
    expect(beat?.pid).toBe(process.pid);
  });

  it('数据源超过阈值没同步：Gmail、订单 10 分钟告警，钉钉 2 小时以内不告警；一条消息列全部异常项（PRD 6.9）', async () => {
    t.clock.advance({ minutes: 11 });
    const message = await selfCheck();
    expect(message?.title).toMatch(/^【Forcome Support · 测试】自检发现 \d+ 项异常$/);
    for (const mailbox of MAILBOXES) {
      expect(message?.markdown).toContain(`- **新** Gmail ${mailbox}：超过 10 分钟没有同步成功`);
    }
    expect(message?.markdown).toContain('亚马逊订单 Forcome Direct：超过 10 分钟没有同步成功');
    expect(message?.markdown).toContain('Shopify 订单 forcome.mx：超过 10 分钟没有同步成功');
    expect(message?.markdown).not.toContain('钉钉通讯录');
    expect(message?.markdown).toMatch(/检查时刻 \d\d-\d\d \d\d:\d\d · 处理见运维手册$/);
  });

  it('同一项持续异常：按键去重，不每分钟重发；满 2 小时再提醒一次，这时钉钉通讯录也超过 2 小时', async () => {
    t.clock.advance({ minutes: 1 });
    expect(await selfCheck()).toBeNull();
    t.clock.advance({ minutes: 58 });
    expect(await selfCheck()).toBeNull();

    t.clock.advance({ minutes: 61 });
    const message = await selfCheck();
    expect(message?.markdown).toContain('（持续中，自 ');
    expect(message?.markdown).toContain('- **新** 钉钉通讯录：超过 2 小时没有同步成功');
  });

  it('恢复后发「已恢复」，同一项再出问题时算新的一项', async () => {
    await syncAll();
    const message = await selfCheck();
    expect(message?.title).toMatch(/^【Forcome Support · 测试】已恢复 \d+ 项$/);
    expect(message?.markdown).toContain('**已恢复**');
    expect(message?.markdown).toContain(`- Gmail ${MAILBOXES[0]}（异常自 `);
    expect(await rows(sql`SELECT key FROM core.alert`)).toEqual([]);

    t.clock.advance({ minutes: 1 });
    expect(await selfCheck()).toBeNull();
  });

  it('上线切换前（待切换、回放中）不按 Gmail 告警（协调者 2026-10-14 决定 Q2）', async () => {
    await t.runtime.db.execute(sql`
      INSERT INTO channel.mail_cutover (id, t0, replay_from, created_at, updated_at)
      VALUES (1, now(), now() - interval '90 days', now(), now())`);
    t.clock.advance({ minutes: 11 });
    const message = await selfCheck();
    expect(message?.markdown).not.toContain('Gmail');
    expect(message?.markdown).toContain('订单');
    await t.runtime.db.execute(sql`DELETE FROM channel.mail_cutover`);
    await syncAll();
    await selfCheck();
  });

  it('汇率按最近一次同步成功判断，超过 1 天（多留 1 小时让当天的同步跑完）告警；两个来源都失败、重试用完进「失败任务」', async () => {
    t.clock.advance({ hours: 24, minutes: 30 });
    await syncAll();
    t.clock.advance({ minutes: 1 });
    expect(await selfCheck()).toBeNull();

    // 下一天的同步两个来源都取不到：重试 3 次后任务失败（测试里重试不等 30 分钟）
    rates.faults.failNext({ kind: 'error', status: 503 }, { times: 100 });
    await t.enqueue(syncExchangeRatesJob, {});
    for (let attempt = 0; attempt < 4; attempt += 1) await t.runJobs({ allowFailures: true });
    // 其余数据源照常同步，只有汇率停在 25 小时以前
    t.clock.advance({ hours: 25 });
    for (const job of [gmailPollJob, shopifyPollJob, amazonPollJob, dingtalkReconcileJob]) {
      await t.enqueue(job, {});
    }
    await t.runJobs();
    const message = await selfCheck();
    expect(message?.markdown).toContain('- **新** 汇率：超过 1 天没有同步成功（最近成功 ');
    expect(message?.markdown).toContain(
      '最近的错误：汇率主源（欧洲央行）与备用源（Frankfurter）都取不到',
    );
    expect(message?.markdown).toContain(
      '- **新** 任务 core.sync_exchange_rates：近 60 分钟有 1 个重试用完仍失败：',
    );

    rates.faults.reset();
    await syncAll();
    const recovered = await selfCheck();
    expect(recovered?.markdown).toContain('- 汇率（异常自 ');
    // 失败任务按近 60 分钟算，还在窗口里
    expect(recovered?.markdown).toContain('任务 core.sync_exchange_rates：');
  });

  it('任务队列积压：到点的任务最久等了 10 分钟以上（按数据库时间）', async () => {
    await t.runtime.boss.createQueue('test.backlog');
    await t.runtime.boss.send('test.backlog', {});
    await t.runtime.db.execute(
      sql`UPDATE pgboss.job SET start_after = now() - interval '11 minutes' WHERE name = 'test.backlog'`,
    );
    const message = await selfCheck();
    expect(message?.markdown).toMatch(
      /- \*\*新\*\* 任务队列 test\.backlog：1 个任务等待处理，最久已等 11 分钟/,
    );
    await t.runtime.db.execute(sql`DELETE FROM pgboss.job WHERE name = 'test.backlog'`);
  });

  it('外部调用错误率：近 15 分钟调用不少于 10 次、失败占一半以上（含 429 限流）', async () => {
    await t.runtime.db.execute(sql`
      INSERT INTO integration.call_record (system, operation, started_at, duration_ms, outcome, status, request)
      SELECT 'sp_api', 'searchOrders', now() - interval '1 minute', 120,
             CASE WHEN n <= 6 THEN 'failed' ELSE 'ok' END,
             CASE WHEN n <= 4 THEN 429 WHEN n <= 6 THEN 503 ELSE 200 END,
             'GET https://sellingpartnerapi-na.amazon.com/orders/2026-01-01/orders'
        FROM generate_series(1, 10) AS n`);
    await t.runtime.db.execute(sql`
      INSERT INTO integration.call_record (system, operation, started_at, duration_ms, outcome, status, request)
      SELECT 'shopify', 'graphql', now() - interval '1 minute', 80, 'failed', 500, 'POST https://forcome-mx.myshopify.com'
        FROM generate_series(1, 9)`);
    const message = await selfCheck();
    expect(message?.markdown).toContain(
      '- **新** 外部调用 亚马逊 SP-API：近 15 分钟 10 次调用失败 6 次（60%，其中限流 4 次）',
    );
    // 调用不到 10 次不判断
    expect(message?.markdown).not.toContain('外部调用 Shopify');
  });

  it('钉钉配额：本月工作通知调用达到 4,000 次告警', async () => {
    await t.runtime.db.execute(sql`
      INSERT INTO core.work_notification
        (recipient_id, dingtalk_user_id, type, title, body, object_type, object_id, object_label,
         created_at, sent_at, task_id)
      SELECT uuidv7(), 'u' || n, 'channel_disconnected', 'Gmail 连接异常', '-', 'channel', 'gmail', 'P18 · Gmail',
             ${t.clock.now()}, ${t.clock.now()}, 'task-' || n
        FROM generate_series(1, 4000) AS n`);
    const message = await selfCheck();
    expect(message?.markdown).toContain(
      '- **新** 钉钉调用配额：本月工作通知已调用 4,000 次（标准版每月 5,000 次，告警线 4,000 次）',
    );
  });

  it('订单通知队列（SQS）：连续 3 次拉取失败、积压 10 条、超过 10 分钟没有检查；没配置（没有记录）不告警', async () => {
    await t.runtime.db.execute(sql`
      INSERT INTO "order".order_queue (name, consecutive_failures, failing_since, last_error, backlog, checked_at, updated_at)
      VALUES ('amazon_orders', 3, ${t.clock.now()}, 'amazon_sqs ReceiveMessage：调用失败（403）', 12,
              ${new Date(t.clock.now().getTime() - 11 * MINUTE)}, ${t.clock.now()})
      ON CONFLICT (name) DO UPDATE SET consecutive_failures = 3, failing_since = excluded.failing_since,
        last_error = excluded.last_error, backlog = 12, checked_at = excluded.checked_at`);
    const message = await selfCheck();
    expect(message?.markdown).toContain('- **新** 亚马逊订单通知队列（SQS）：拉取失败：连续 3 次');
    expect(message?.markdown).toContain(
      '- **新** 亚马逊订单通知队列（SQS）：积压 12 条等待拉取的通知',
    );
    expect(message?.markdown).toContain(
      '- **新** 亚马逊订单通知队列（SQS）：超过 10 分钟没有检查记录（拉取源可能没在运行',
    );
  });

  it('夜间对账开始超过 1 天仍未完成、回补或对账失败持续 30 分钟以上', async () => {
    const [direct] = await rows<{ id: string }>(
      sql`SELECT id FROM channel.store WHERE name = 'Forcome Direct'`,
    );
    await t.runtime.db.execute(sql`
      INSERT INTO "order".order_sweep (store_id, kind, window_days, since, started_at, pages, last_error, failing_since, updated_at)
      VALUES (${direct!.id}, 'reconcile', 7, ${t.clock.now()}, ${new Date(t.clock.now().getTime() - 25 * 60 * MINUTE)}, 3,
              'sp_api searchOrders：调用失败（503）', ${new Date(t.clock.now().getTime() - 31 * MINUTE)}, ${t.clock.now()})
      ON CONFLICT (store_id, kind) DO UPDATE SET started_at = excluded.started_at, completed_at = NULL,
        pages = 3, last_error = excluded.last_error, failing_since = excluded.failing_since`);
    const message = await selfCheck();
    expect(message?.markdown).toMatch(
      /- \*\*新\*\* 夜间对账 Forcome Direct：开始于 .*，超过 24 小时仍未完成（已取 3 页）/,
    );
    expect(message?.markdown).toMatch(
      /- \*\*新\*\* 夜间对账 Forcome Direct：自 .* 起一直失败：sp_api searchOrders：调用失败（503）/,
    );
  });

  it('机器人发送失败：不记状态，下一分钟再发同样的内容', async () => {
    await t.runtime.db.execute(sql`DELETE FROM core.alert`);
    robot.faults.failNext();
    await t.enqueue(selfCheckJob, {});
    const before = robot.sent.length;
    await t.runJobs();
    expect(robot.sent.length).toBe(before);
    expect(await rows(sql`SELECT key FROM core.alert`)).toEqual([]);

    const message = await selfCheck();
    expect(message?.markdown).toContain('- **新** ');
    expect((await rows(sql`SELECT key FROM core.alert`)).length).toBeGreaterThan(0);
  });
});
