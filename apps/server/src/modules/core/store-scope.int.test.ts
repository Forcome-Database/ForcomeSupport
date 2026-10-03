import { and, asc, eq, sql } from 'drizzle-orm';
import { text, uuid } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestRuntime,
  type TestDatabase,
  type TestRuntime,
} from '../../../test/database';
import type { DbExecutor } from './db';
import {
  isStoreInScope,
  memberStoreScope,
  storeScopeCondition,
  storesOutsideScope,
  SYSTEM_STORE_SCOPE,
  type StoreScope,
} from './index';
import { coreSchema } from './schema';
import { primaryId } from './columns';

// 只在本测试里建的示范表：带店铺列的业务对象
const demo = coreSchema.table('__store_scoped_demo', {
  id: primaryId(),
  storeId: uuid('store_id'),
  label: text('label').notNull(),
});

const DIRECT = '8adf47ec-435b-55d3-bd18-f3429dbee2df';
const AUTO = 'b6f7210f-1d82-55ff-9217-2a7c8c4f6f3a';
const MX = '0b0ec4f2-1b7d-5d39-8f8b-6a9d6c5f2e11';

/** 示范仓储查询：店铺范围是必需参数，缺了编译不过（ADR 0010） */
async function listDemo(db: DbExecutor, scope: StoreScope, label?: string): Promise<string[]> {
  const rows = await db
    .select({ label: demo.label })
    .from(demo)
    .where(and(storeScopeCondition(scope, demo.storeId), label ? eq(demo.label, label) : undefined))
    .orderBy(asc(demo.label));
  return rows.map((row) => row.label);
}

let database: TestDatabase;
let t: TestRuntime;

beforeAll(async () => {
  database = await createTestDatabase();
  t = await createTestRuntime(database.url);
  await t.runtime.db.execute(sql`
    CREATE TABLE core.__store_scoped_demo (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      store_id uuid,
      label text NOT NULL
    )`);
  await t.runtime.db.insert(demo).values([
    { storeId: DIRECT, label: 'a-direct' },
    { storeId: AUTO, label: 'b-auto' },
    { storeId: MX, label: 'c-mx' },
    { storeId: null, label: 'd-unassigned' },
  ]);
});

afterAll(async () => {
  await t.close();
  await database.drop();
});

describe('店铺数据范围（R-ST-06、ADR 0010：仓储查询必须带范围参数）', () => {
  it('全部店铺：不加条件，含未归属店铺的行', async () => {
    const all = memberStoreScope({ allStores: true, storeIds: [] });
    expect(await listDemo(t.runtime.db, all)).toEqual([
      'a-direct',
      'b-auto',
      'c-mx',
      'd-unassigned',
    ]);
    expect(await listDemo(t.runtime.db, SYSTEM_STORE_SCOPE)).toHaveLength(4);
  });

  it('指定店铺：只返回授权店铺的行，未归属店铺的行不在范围内', async () => {
    const scope = memberStoreScope({ allStores: false, storeIds: [DIRECT, AUTO, DIRECT] });
    expect(await listDemo(t.runtime.db, scope)).toEqual(['a-direct', 'b-auto']);
    expect(await listDemo(t.runtime.db, scope, 'c-mx')).toEqual([]);
  });

  it('没有授权店铺：什么也查不到', async () => {
    const none = memberStoreScope({ allStores: false, storeIds: [] });
    expect(await listDemo(t.runtime.db, none)).toEqual([]);
  });

  it('判断单个店铺与找出越权的店铺', () => {
    const scope = memberStoreScope({ allStores: false, storeIds: [DIRECT] });
    expect(isStoreInScope(scope, DIRECT)).toBe(true);
    expect(isStoreInScope(scope, MX)).toBe(false);
    expect(storesOutsideScope(scope, [DIRECT, MX, MX, AUTO])).toEqual([MX, AUTO]);
    expect(storesOutsideScope(SYSTEM_STORE_SCOPE, [MX])).toEqual([]);
  });

  it('缺了范围参数、或用对象字面量冒充范围，都编译不过（由 pnpm typecheck 检查）', () => {
    const misuse = () => [
      // @ts-expect-error 仓储查询缺了店铺范围参数
      listDemo(t.runtime.db),
      // @ts-expect-error 店铺范围只能经 memberStoreScope 或 SYSTEM_STORE_SCOPE 得到
      listDemo(t.runtime.db, { all: true }),
    ];
    expect(misuse).toBeTypeOf('function');
  });
});
