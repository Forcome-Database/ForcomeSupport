import { demoFixture } from '@forcome/fixtures';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestRuntime,
  type TestDatabase,
  type TestRuntime,
} from '../../../test/database';
import { defineFixtureStep, loadFixtures } from './index';

let database: TestDatabase;
let t: TestRuntime;

beforeAll(async () => {
  database = await createTestDatabase();
  t = await createTestRuntime(database.url);
  // 只在本测试库里建一张探测表，记录各加载步骤写入的内容
  await t.runtime.db.execute(sql`CREATE TABLE core.fixture_probe (step text NOT NULL)`);
});

afterAll(async () => {
  await t.close();
  await database.drop();
});

beforeEach(async () => {
  await t.runtime.db.execute(sql`TRUNCATE core.fixture_probe`);
});

async function probe(): Promise<string[]> {
  const result = await t.runtime.db.execute<{ step: string }>(
    sql`SELECT step FROM core.fixture_probe`,
  );
  return result.rows.map((r) => r.step);
}

function writer(name: string, after?: string[]) {
  return defineFixtureStep({
    name,
    after,
    async load(tx, fixture) {
      // 步骤拿到的是同一份夹具，在业务事务里写入
      await tx.db.execute(
        sql`INSERT INTO core.fixture_probe (step) VALUES (${`${name}:${fixture.tickets.length}`})`,
      );
    },
  });
}

describe('示例数据加载器（各模块登记加载步骤）', () => {
  it('没有登记任何步骤时，空库上运行不报错', async () => {
    const report = await loadFixtures(t.runtime, {
      appEnv: 'test',
      fixture: demoFixture,
      steps: [],
    });
    expect(report).toEqual({ steps: [] });
  });

  it('按依赖顺序执行，与登记顺序无关', async () => {
    const report = await loadFixtures(t.runtime, {
      appEnv: 'test',
      fixture: demoFixture,
      steps: [
        writer('aftersales.ledger', ['org.members', 'channel.stores']),
        writer('channel.stores'),
        writer('org.members'),
      ],
    });
    expect(report.steps).toEqual(['channel.stores', 'org.members', 'aftersales.ledger']);
    expect(await probe()).toEqual(['channel.stores:16', 'org.members:16', 'aftersales.ledger:16']);
  });

  it('一步失败则全部回滚，不留下半套数据', async () => {
    const failing = defineFixtureStep({
      name: 'ticket.tickets',
      after: ['channel.stores'],
      load: () => Promise.reject(new Error('写入失败')),
    });
    await expect(
      loadFixtures(t.runtime, {
        appEnv: 'test',
        fixture: demoFixture,
        steps: [writer('channel.stores'), failing],
      }),
    ).rejects.toThrow(/ticket\.tickets.*写入失败/);
    expect(await probe()).toEqual([]);
  });

  it('依赖了没登记的步骤、循环依赖或重名，在写库之前报错', async () => {
    const run = (steps: ReturnType<typeof writer>[]) =>
      loadFixtures(t.runtime, { appEnv: 'test', fixture: demoFixture, steps });

    await expect(run([writer('ticket.tickets', ['channel.stores'])])).rejects.toThrow(
      /ticket\.tickets 依赖的 channel\.stores 没有登记/,
    );
    await expect(run([writer('a.one', ['b.two']), writer('b.two', ['a.one'])])).rejects.toThrow(
      /循环依赖/,
    );
    await expect(run([writer('a.one'), writer('a.one')])).rejects.toThrow(/重复/);
    expect(await probe()).toEqual([]);
  });

  it('生产环境拒绝加载示例数据', async () => {
    await expect(
      loadFixtures(t.runtime, {
        appEnv: 'production',
        fixture: demoFixture,
        steps: [writer('channel.stores')],
      }),
    ).rejects.toThrow(/生产环境不能加载示例数据/);
    expect(await probe()).toEqual([]);
  });

  it('步骤名必须是「模块.内容」形式', () => {
    expect(() => writer('Stores')).toThrow(/模块\.内容/);
  });
});
