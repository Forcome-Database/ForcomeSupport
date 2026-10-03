import { sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestRuntime,
  type TestDatabase,
  type TestRuntime,
} from '../../../test/database';
import { OptimisticLockError, primaryId, transaction, updateWithVersion, version } from './index';
import { coreSchema } from './schema';

// 只在本测试里建的示范主表：带 version 列
const demo = coreSchema.table('__versioned_demo', {
  id: primaryId(),
  name: text('name').notNull(),
  version: version(),
});

let database: TestDatabase;
let t: TestRuntime;
let id: string;

beforeAll(async () => {
  database = await createTestDatabase();
  t = await createTestRuntime(database.url);
  await t.runtime.db.execute(sql`
    CREATE TABLE core.__versioned_demo (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      name text NOT NULL,
      version integer NOT NULL DEFAULT 1
    )`);
  const [row] = await t.runtime.db.insert(demo).values({ name: 'Forcome Direct' }).returning();
  id = row!.id;
});

afterAll(async () => {
  await t.close();
  await database.drop();
});

describe('乐观锁更新（规格「数据约定」）', () => {
  it('版本号一致时更新成功，版本号加 1', async () => {
    const updated = await transaction(t.runtime, (tx) =>
      updateWithVersion(tx, demo, { id, version: 1 }, { name: 'Forcome Direct US' }),
    );
    expect(updated).toEqual({ id, name: 'Forcome Direct US', version: 2 });
  });

  it('拿着旧版本号保存时报冲突，数据不变', async () => {
    await expect(
      transaction(t.runtime, (tx) =>
        updateWithVersion(tx, demo, { id, version: 1 }, { name: '覆盖别人的修改' }),
      ),
    ).rejects.toBeInstanceOf(OptimisticLockError);

    const [row] = await t.runtime.db.select().from(demo);
    expect(row).toEqual({ id, name: 'Forcome Direct US', version: 2 });
  });

  it('两人同时基于同一版本保存，只有先提交的成功（G7）', async () => {
    const results = await Promise.allSettled(
      ['甲的修改', '乙的修改'].map((name) =>
        transaction(t.runtime, (tx) => updateWithVersion(tx, demo, { id, version: 2 }, { name })),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OptimisticLockError);

    const [row] = await t.runtime.db.select().from(demo);
    expect(row?.version).toBe(3);
  });
});
