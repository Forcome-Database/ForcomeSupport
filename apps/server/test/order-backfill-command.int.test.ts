import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderBackfills } from '../src/modules/order';
import { runOrderBackfillCommand } from '../src/order-backfill-command';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 「订单回补」命令（待办 13，协调者 2026-10-06 决定 Q1）：按店铺名选店铺（不给为全部），已完成的跳过、--again 重来，
 * 输出每个店铺做了什么。命令本身（runOrderBackfillCommand）在本测试的库上跑，运行时用测试工具的。
 */

const stores = getDemoFixture().stores;
const DIRECT = stores.find((s) => s.name === 'Forcome Direct')!;
const MX = stores.find((s) => s.name === 'forcome.mx')!;

let t: TestHarness;

beforeAll(async () => {
  t = await startTestHarness();
  await t.loadFixtures();
});

afterAll(async () => {
  await t.close();
});

async function run(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runOrderBackfillCommand(args, {
    startRuntime: () => Promise.resolve({ runtime: t.runtime, stop: () => Promise.resolve() }),
    io: { stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

describe('开始订单回补的命令', () => {
  it('按店铺名开始（可多个）；worker 逐页做完后再执行为已完成、跳过；--again 从头重来', async () => {
    expect(await run(['--store', 'Forcome Direct', '--store', 'forcome.mx'])).toEqual({
      code: 0,
      stdout:
        'Forcome Direct：开始回补近 90 天的订单\n' +
        'forcome.mx：开始回补近 90 天的订单\n' +
        'worker 在后台逐页回补（增量同步先走），进度见 P18 的亚马逊、Shopify 卡。\n',
      stderr: '',
    });
    expect([...(await orderBackfills(t.runtime.db)).keys()].sort()).toEqual(
      [DIRECT.id, MX.id].sort(),
    );
    await t.runJobs();
    expect((await run(['--store', 'forcome.mx'])).stdout).toBe(
      'forcome.mx：已回补完成，跳过（要从头重来加 --again）\n',
    );
    expect((await run(['--store', 'forcome.mx', '--again'])).stdout).toContain(
      'forcome.mx：开始回补近 90 天的订单\n',
    );
  });

  it('不给店铺为全部订单店铺：还没做完的接着做，没开始的开始', async () => {
    const result = await run([]);
    expect(result.code).toBe(0);
    expect(result.stdout.split('\n').slice(0, stores.length).sort()).toEqual(
      [
        'Forcome Auto：开始回补近 90 天的订单',
        'Forcome Direct：已回补完成，跳过（要从头重来加 --again）',
        'forcome.com：开始回补近 90 天的订单',
        'forcome.mx：上次的回补还没做完，接着回补',
      ].sort(),
    );
  });

  it('店铺名对不上、参数写错时退出码非 0，不开始任何回补', async () => {
    const unknown = await run(['--store', 'Forcome Outdoor']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('没有这些店铺：Forcome Outdoor');
    const wrong = await run(['--days', '60']);
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain('用法：');
  });
});
