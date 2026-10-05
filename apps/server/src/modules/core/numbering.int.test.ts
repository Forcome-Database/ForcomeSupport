import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestRuntime,
  type TestDatabase,
  type TestRuntime,
} from '../../../test/database';
import {
  businessNumberSequence,
  nextBusinessNumber,
  reserveBusinessNumbers,
  transaction,
  type BusinessNumberKind,
} from './index';

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

const next = (kind: BusinessNumberKind, at: string) =>
  transaction(t.runtime, (tx) => nextBusinessNumber(tx, kind, new Date(at)));

describe('业务编号（事务内生成）', () => {
  it('工单 T- 按北京时间当日计数，跨日从 0001 重新开始', async () => {
    expect(await next('ticket', '2026-08-01T01:00:00Z')).toBe('T-20260801-0001');
    expect(await next('ticket', '2026-08-01T15:59:59Z')).toBe('T-20260801-0002');
    // UTC 16:00 是北京时间次日 0 点
    expect(await next('ticket', '2026-08-01T16:00:00Z')).toBe('T-20260802-0001');
    // 回放历史来信：日期取首封来信日期，回到之前的日子接着计数
    expect(await next('ticket', '2026-08-01T09:00:00Z')).toBe('T-20260801-0003');
  });

  it('售后单 S- 序号全局递增，不按日重置；日期取创建日期', async () => {
    expect(await next('aftersales', '2026-08-03T02:00:00Z')).toBe('S-20260803-0001');
    expect(await next('aftersales', '2026-08-04T02:00:00Z')).toBe('S-20260804-0002');
    // 历史导入：日期取原登记日期，序号照样全局递增
    expect(await next('aftersales', '2026-05-20T02:00:00Z')).toBe('S-20260520-0003');
  });

  it('带着既有编号写入的售后单（示例数据、历史导入）预留序号后，新发的号接在它们后面；已经更大时不回退', async () => {
    const reserve = (value: number) =>
      transaction(t.runtime, (tx) => reserveBusinessNumbers(tx, 'aftersales', value));
    // 上一个用例已发到 0003
    await reserve(21);
    expect(await next('aftersales', '2026-09-11T02:00:00Z')).toBe('S-20260911-0022');
    await reserve(5);
    expect(await next('aftersales', '2026-09-11T02:00:00Z')).toBe('S-20260911-0023');
    expect(businessNumberSequence('S-20260911-0021')).toBe(21);
    expect(() => businessNumberSequence('S-20260911')).toThrow(/不是业务编号/);
    // 工单编号按日计数，不能整体预留
    await expect(
      transaction(t.runtime, (tx) => reserveBusinessNumbers(tx, 'ticket', 9)),
    ).rejects.toThrow(/按日重置/);
  });

  it('事务回滚时编号不被占用', async () => {
    await expect(
      transaction(t.runtime, async (tx) => {
        await nextBusinessNumber(tx, 'ticket', new Date('2026-08-05T02:00:00Z'));
        throw new Error('业务失败');
      }),
    ).rejects.toThrow('业务失败');
    expect(await next('ticket', '2026-08-05T03:00:00Z')).toBe('T-20260805-0001');
  });

  it('并发事务同时取同一天的工单编号，互不重复且连续', async () => {
    const count = 20;
    const numbers = await Promise.all(
      Array.from({ length: count }, () =>
        transaction(t.runtime, async (tx) => {
          const number = await nextBusinessNumber(tx, 'ticket', new Date('2026-08-06T02:00:00Z'));
          // 拉长事务，让并发事务真正重叠在计数器行上
          await tx.db.execute('SELECT pg_sleep(0.02)');
          return number;
        }),
      ),
    );
    expect(new Set(numbers).size).toBe(count);
    expect([...numbers].sort()).toEqual(
      Array.from({ length: count }, (_, i) => `T-20260806-${String(i + 1).padStart(4, '0')}`),
    );
  });
});
