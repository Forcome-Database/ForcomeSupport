import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestRuntime,
  type TestDatabase,
  type TestRuntime,
} from '../../../test/database';
import { transaction } from '../core';
import { noWrites } from './mirror';
import { orderSyncWatermark, recordOrderSyncSuccess } from './sync-health';

/*
 * 同步记录的水位只进不退（待办 12 评审修复，ADR 0008「待办 12 落地」修订）：SP-API 配额排队可能让一轮同步超过任务的过期时间，
 * 过期后下一轮已经推进了水位；晚结束的旧一轮记同步成功时不能把水位改回去。没有新水位（null）时不动它。
 */

const STORE = { id: '0190a5c4-0000-7000-8000-000000000031', name: 'Forcome Auto' };

let database: TestDatabase;
let t: TestRuntime;

beforeAll(async () => {
  database = await createTestDatabase();
  t = await createTestRuntime(database.url);
});

afterAll(async () => {
  await t.close();
  await database.drop();
});

const succeed = (watermark: Date | null) =>
  transaction(t.runtime, (tx) =>
    recordOrderSyncSuccess(tx, STORE, watermark, noWrites(), 'amazon_orders'),
  );

describe('订单同步的水位', () => {
  it('第一次记下水位；更新的往前走；更旧的（晚结束的旧一轮）不改回去；没有新水位时不动', async () => {
    await succeed(new Date('2026-09-11T02:00:00Z'));
    expect(await orderSyncWatermark(t.runtime.db, STORE.id, 'amazon_orders')).toEqual(
      new Date('2026-09-11T02:00:00Z'),
    );
    await succeed(new Date('2026-09-11T02:10:00Z'));
    await succeed(new Date('2026-09-11T01:50:00Z'));
    expect(await orderSyncWatermark(t.runtime.db, STORE.id, 'amazon_orders')).toEqual(
      new Date('2026-09-11T02:10:00Z'),
    );
    await succeed(null);
    expect(await orderSyncWatermark(t.runtime.db, STORE.id, 'amazon_orders')).toEqual(
      new Date('2026-09-11T02:10:00Z'),
    );
    // 别的数据源互不影响
    expect(await orderSyncWatermark(t.runtime.db, STORE.id, 'shopify_orders')).toBeNull();
  });
});
