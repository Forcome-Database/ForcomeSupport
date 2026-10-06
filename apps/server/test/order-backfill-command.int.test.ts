import { channelSettingsSchema } from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { amazonPollJob, orderBackfills, shopifyPollJob } from '../src/modules/order';
import { runOrderBackfillCommand } from '../src/order-backfill-command';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 「订单回补」命令（待办 13，协调者 2026-10-06 决定 Q1）：按店铺名选店铺（不给为全部），已完成的跳过、--again 重来，
 * 输出每个店铺做了什么；订单同步还没连上的店铺（例如还没配置凭据）照样登记，输出写明暂时取不到、P18 不显示、连上后自动开始
 * （协调者验收返工）。命令本身（runOrderBackfillCommand）在本测试的库上跑，运行时用测试工具的。
 */

const stores = getDemoFixture().stores;
const DIRECT = stores.find((s) => s.name === 'Forcome Direct')!;
const MX = stores.find((s) => s.name === 'forcome.mx')!;

const STARTED = '开始回补近 90 天的订单';
const RUNNING_NOTE = 'worker 在后台逐页回补（增量同步先走），进度见 P18 的亚马逊、Shopify 卡。';
const NOT_CONNECTED =
  '已登记近 90 天的订单回补；订单同步还没连上（例如还没配置凭据或卖家授权），暂时取不到订单，P18 也不显示它的进度；连上后 10 分钟内自动开始，不用再执行';

async function run(h: TestHarness, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runOrderBackfillCommand(args, {
    startRuntime: () => Promise.resolve({ runtime: h.runtime, stop: () => Promise.resolve() }),
    io: { stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

/** 两个平台各增量同步一次：示例店铺（模拟数据）为已连接 */
async function syncAll(h: TestHarness) {
  await h.enqueue(amazonPollJob, {});
  await h.enqueue(shopifyPollJob, {});
  await h.runJobs();
}

describe('开始订单回补的命令', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    await syncAll(t);
  });

  afterAll(async () => {
    await t.close();
  });

  it('按店铺名开始（可多个）；worker 逐页做完后再执行为已完成、跳过；--again 从头重来', async () => {
    expect(await run(t, ['--store', 'Forcome Direct', '--store', 'forcome.mx'])).toEqual({
      code: 0,
      stdout: `Forcome Direct：${STARTED}\nforcome.mx：${STARTED}\n${RUNNING_NOTE}\n`,
      stderr: '',
    });
    expect([...(await orderBackfills(t.runtime.db)).keys()].sort()).toEqual(
      [DIRECT.id, MX.id].sort(),
    );
    await t.runJobs();
    expect((await run(t, ['--store', 'forcome.mx'])).stdout).toBe(
      'forcome.mx：已回补完成，跳过（要从头重来加 --again）\n',
    );
    expect((await run(t, ['--store', 'forcome.mx', '--again'])).stdout).toContain(
      `forcome.mx：${STARTED}\n`,
    );
  });

  it('不给店铺为全部订单店铺：还没做完的接着做，没开始的开始', async () => {
    const result = await run(t, []);
    expect(result.code).toBe(0);
    expect(result.stdout.split('\n').slice(0, stores.length).sort()).toEqual(
      [
        `Forcome Auto：${STARTED}`,
        'Forcome Direct：已回补完成，跳过（要从头重来加 --again）',
        `forcome.com：${STARTED}`,
        'forcome.mx：上次的回补还没做完，接着回补',
      ].sort(),
    );
  });

  it('店铺名对不上、参数写错时退出码非 0，不开始任何回补', async () => {
    const before = await orderBackfills(t.runtime.db);
    const unknown = await run(t, ['--store', 'Forcome Outdoor']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('没有这些店铺：Forcome Outdoor');
    const wrong = await run(t, ['--days', '60']);
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain('用法：');
    // 回补记录一条没变（没有新登记、没有重开）
    expect(await orderBackfills(t.runtime.db)).toEqual(before);
  });
});

describe('部分店铺的订单同步还没连上（例如改成真实接口而没配置凭据）', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    const admin = await t.loginAs('管理员');
    const mx = channelSettingsSchema
      .parse(await (await admin.get('/api/channel/settings')).json())
      .stores.find((s) => s.id === MX.id)!;
    const saved = await admin.put(`/api/channel/stores/${MX.id}`, {
      version: mx.version,
      name: mx.name,
      platform: mx.platform,
      sites: mx.sites,
      defaultSite: mx.defaultSite,
      mailboxes: mx.mailboxes,
      platformId: mx.platformId,
      adapterMode: 'real',
    });
    expect(saved.status).toBe(200);
    await syncAll(t);
  });

  afterAll(async () => {
    await t.close();
  });

  it('连上的店铺照常开始；没连上的写明暂时取不到、P18 不显示、连上后自动开始；仍有连上的店铺时提示进度见 P18', async () => {
    const result = await run(t, []);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines.slice(0, stores.length).sort()).toEqual(
      [
        `Forcome Auto：${STARTED}`,
        `Forcome Direct：${STARTED}`,
        `forcome.com：${STARTED}`,
        `forcome.mx：${NOT_CONNECTED}`,
      ].sort(),
    );
    expect(lines.at(-1)).toBe(RUNNING_NOTE);
    // 照样登记了；worker 跑过之后它仍停在未取（没配置凭据不算失败），连上的都做完了
    await t.runJobs();
    const backfills = await orderBackfills(t.runtime.db);
    expect(backfills.get(MX.id)).toMatchObject({ completed: false, orders: 0 });
    expect(backfills.get(DIRECT.id)).toMatchObject({ completed: true });
    // 再执行一次：还是写明没连上（接着等），不说「接着回补」
    expect((await run(t, ['--store', 'forcome.mx'])).stdout).toBe(
      'forcome.mx：已登记的回补还没做完；订单同步还没连上（例如还没配置凭据或卖家授权），暂时取不到订单，P18 也不显示它的进度；连上后 10 分钟内自动开始，不用再执行\n',
    );
  });
});

describe('生产环境全部店铺都还没配置凭据（用户 2026-10-04 口径）', () => {
  let p: TestHarness;

  beforeAll(async () => {
    p = await startTestHarness({ appEnv: 'production', feeds: () => [] });
    const admin = await p.loginAs('管理员');
    for (const store of [
      {
        name: 'Forcome Direct',
        platform: 'amazon',
        sites: ['US'],
        defaultSite: 'US',
        mailboxes: ['amz-direct@forcome.com'],
        platformId: 'A1FD7Q2M9XK3LC',
      },
      {
        name: 'forcome.mx',
        platform: 'shopify',
        sites: ['MX'],
        defaultSite: 'MX',
        mailboxes: ['support@forcome.mx'],
        platformId: 'forcome-mx.myshopify.com',
      },
    ]) {
      expect((await admin.post('/api/channel/stores', store)).status).toBe(201);
    }
    await syncAll(p);
  });

  afterAll(async () => {
    await p.close();
  });

  it('每个店铺都写明暂时取不到、P18 不显示、连上后自动开始，不说「进度见 P18」；照样登记', async () => {
    expect(await run(p, [])).toEqual({
      code: 0,
      stdout: `Forcome Direct：${NOT_CONNECTED}\nforcome.mx：${NOT_CONNECTED}\n`,
      stderr: '',
    });
    expect([...(await orderBackfills(p.runtime.db)).values()].map((b) => b.completed)).toEqual([
      false,
      false,
    ]);
  });
});
