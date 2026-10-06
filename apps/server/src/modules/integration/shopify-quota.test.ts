import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../core';
import { SHOPIFY_DEFAULT_COST, ShopifyQuota } from './shopify-quota';

/*
 * Shopify 查询成本配额（待办 13；规格 order「增量优先、回补与对账让路」）：手动时钟 + 由测试放行的等待（放行时把时钟推进等待的时长）。
 */

const SHOP = 'forcome-com.myshopify.com';

let clock: ManualClock;
let waits: { ms: number; release: () => void }[];
let quota: ShopifyQuota;

beforeEach(() => {
  clock = new ManualClock('2026-09-11T10:20:00+08:00');
  waits = [];
  quota = new ShopifyQuota(
    clock,
    (ms) =>
      new Promise<void>((resolve) => {
        waits.push({
          ms,
          release: () => {
            clock.advance({ milliseconds: ms });
            resolve();
          },
        });
      }),
  );
});

/** 一次响应：这种查询的请求成本与此刻桶里还剩几点（桶 1000 点、每秒恢复 50 点） */
function respond(operation: string, requested: number, currentlyAvailable: number) {
  quota.observe(SHOP, operation, {
    requestedQueryCost: requested,
    throttleStatus: { maximumAvailable: 1000, currentlyAvailable, restoreRate: 50 },
  });
}

describe('Shopify 查询成本配额', () => {
  it('点数够时立即发出；第一次按默认成本估，之后按响应的请求成本与剩余校准', async () => {
    await quota.acquire(SHOP, 'orders', 'high');
    expect(quota.available(SHOP)).toBe(2000 - SHOPIFY_DEFAULT_COST);
    respond('orders', 300, 940);
    expect(quota.available(SHOP)).toBe(940);
    await quota.acquire(SHOP, 'orders', 'high');
    expect(quota.available(SHOP)).toBe(640);
    expect(waits).toEqual([]);
  });

  it('低优先级要给增量留出一次订单查询：点数只够一次时低优先级等，高优先级立即发出', async () => {
    respond('orders', 300, 500);
    // 低优先级要 300 + 留给增量的 300 = 600 点：等 100 点恢复（2 秒）
    const low = quota.acquire(SHOP, 'orders', 'low');
    await vi.waitFor(() => expect(waits.map((w) => w.ms)).toEqual([2000]));
    expect(quota.queued(SHOP)).toBe(1);
    // 增量（高优先级）只要 300 点：插到前面，但 pump 正在等，等这一次结束后先发它
    const high = quota.acquire(SHOP, 'orders', 'high');
    waits.shift()!.release();
    await high;
    // 高优先级拿走 300 点后只剩 300：低优先级继续等
    await vi.waitFor(() => expect(waits).toHaveLength(1));
    expect(quota.queued(SHOP)).toBe(1);
    waits.shift()!.release();
    await low;
    expect(quota.queued(SHOP)).toBe(0);
  });

  it('点数不够时高优先级也排队等恢复，不发出去挨 THROTTLED；THROTTLED 的响应同样按剩余校准', async () => {
    respond('orders', 800, 100);
    const high = quota.acquire(SHOP, 'orders', 'high');
    // 要 800 点、剩 100 点，每秒恢复 50 点：等 14 秒
    await vi.waitFor(() => expect(waits.map((w) => w.ms)).toEqual([14_000]));
    waits.shift()!.release();
    await high;
    expect(quota.available(SHOP)).toBe(0);
  });

  it('不同店铺各一个桶', async () => {
    respond('orders', 900, 0);
    await quota.acquire('forcome-mx.myshopify.com', 'orders', 'low');
    expect(waits).toEqual([]);
  });
});
