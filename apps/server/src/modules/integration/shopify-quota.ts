import { setTimeout as sleep } from 'node:timers/promises';
import type { Clock } from '../core';
import { nextInQueue, type CallPriority } from './call-priority';

/*
 * Shopify Admin GraphQL 的查询成本配额（规格 order「增量优先、回补与对账让路」，待办 13；ADR 0008 修订）：
 * - Shopify 按店铺 × 应用限流：一个按「点」计的漏桶（最多 maximumAvailable 点、每秒恢复 restoreRate 点），每次查询先按请求成本
 *   （requestedQueryCost）扣点，不够的直接以 THROTTLED 拒绝；返回后按实际成本退回多扣的。每次响应的 extensions.cost.throttleStatus
 *   给出此刻还剩几点；
 * - 我们在发出前先从本进程同名的桶里扣点：点不够时排队等恢复，不发出去挨 THROTTLED（增量被拒会记一次连接失败）；
 *   排队的高优先级（增量、按订单名补拉）先于低优先级（回补与夜间对账），低优先级还要给高优先级留出一次订单查询的点数——
 *   回补一页接一页地查也不会把桶抽干，点数够时增量立即发出（不陪着排在前面、正等点数恢复的回补等）；
 * - 每种查询的成本取它上一次响应的 requestedQueryCost（第一次按 DEFAULT_COST 估），桶的大小与恢复速度以响应为准
 *   （第一次按标准版的默认值）；
 * - 只在本进程内共享：订单同步、回补与对账都在 worker 一个进程里。
 * 等待用注入的 wait（测试里推进手动时钟），时间按注入的时钟算。与 SP-API 的令牌桶（sp-api-quota.ts）不同：那边按次数计、
 * 平台不预告剩余，这边按点数计、每次响应都给出剩余。
 */

/** 经配额发出的查询（shopify-real.ts 的操作名） */
export type ShopifyOperation = 'orders' | 'order_by_name' | 'shop' | 'access_scopes';

/** 桶的默认大小与恢复速度（Shopify 标准版；收到第一次响应后按它给的） */
export const SHOPIFY_DEFAULT_BUCKET = { maximumAvailable: 2000, restoreRate: 100 } as const;
/** 还没见过某种查询的响应时按多少点估它的成本（订单一页 100 笔的请求成本在 1000 点之内） */
export const SHOPIFY_DEFAULT_COST = 1000;
/** 低优先级要给高优先级留出的：一次订单查询（增量）的请求成本 */
const RESERVED_OPERATION: ShopifyOperation = 'orders';

/** 响应里的查询成本（extensions.cost） */
export interface ShopifyQueryCost {
  readonly requestedQueryCost: number;
  readonly throttleStatus?: {
    readonly maximumAvailable: number;
    readonly currentlyAvailable: number;
    readonly restoreRate: number;
  };
}

interface Waiter {
  readonly priority: CallPriority;
  readonly operation: ShopifyOperation;
  readonly resolve: () => void;
}

interface Bucket {
  available: number;
  max: number;
  rate: number;
  /** 上次补点的时刻（毫秒） */
  last: number;
  /** 各种查询上一次的请求成本 */
  readonly costs: Map<ShopifyOperation, number>;
  /** 按到达先后 */
  readonly queue: Waiter[];
  /** 已约好的最早一次醒来（毫秒）；没有为 null */
  wakeAt: number | null;
}

export class ShopifyQuota {
  readonly #clock: Clock;
  readonly #wait: (ms: number) => Promise<void>;
  readonly #buckets = new Map<string, Bucket>();

  constructor(clock: Clock, wait: (ms: number) => Promise<void> = (ms) => sleep(ms)) {
    this.#clock = clock;
    this.#wait = wait;
  }

  #bucket(shop: string): Bucket {
    let bucket = this.#buckets.get(shop);
    if (!bucket) {
      bucket = {
        available: SHOPIFY_DEFAULT_BUCKET.maximumAvailable,
        max: SHOPIFY_DEFAULT_BUCKET.maximumAvailable,
        rate: SHOPIFY_DEFAULT_BUCKET.restoreRate,
        last: this.#clock.now().getTime(),
        costs: new Map(),
        queue: [],
        wakeAt: null,
      };
      this.#buckets.set(shop, bucket);
    }
    return bucket;
  }

  #refill(bucket: Bucket): void {
    const now = this.#clock.now().getTime();
    const elapsed = Math.max(0, now - bucket.last) / 1000;
    bucket.available = Math.min(bucket.max, bucket.available + elapsed * bucket.rate);
    bucket.last = now;
  }

  #cost(bucket: Bucket, operation: ShopifyOperation): number {
    return bucket.costs.get(operation) ?? SHOPIFY_DEFAULT_COST;
  }

  /** 发出前要有多少点：自己的成本；低优先级另给高优先级留一次订单查询（不超过桶的大小） */
  #need(bucket: Bucket, waiter: Waiter): number {
    const own = this.#cost(bucket, waiter.operation);
    const reserve = waiter.priority === 'low' ? this.#cost(bucket, RESERVED_OPERATION) : 0;
    return Math.min(bucket.max, own + reserve);
  }

  /**
   * 放行点数够的：按「先高优先级、同一优先级先来先得」依次放，排在最前的不够就停。还有没放的时约好醒来的时刻——
   * 已约的醒得更早就不再约（新来的高优先级要的少，可能约得更早；早醒的那次放不了时会再约）
   */
  #pump(bucket: Bucket): void {
    this.#refill(bucket);
    while (bucket.queue.length > 0) {
      const index = nextInQueue(bucket.queue);
      const waiter = bucket.queue[index]!;
      const need = this.#need(bucket, waiter);
      if (bucket.available < need) {
        const ms = Math.ceil(((need - bucket.available) / bucket.rate) * 1000);
        const at = this.#clock.now().getTime() + ms;
        if (bucket.wakeAt !== null && bucket.wakeAt <= at) return;
        bucket.wakeAt = at;
        void this.#wait(ms).then(() => {
          if (bucket.wakeAt === at) bucket.wakeAt = null;
          this.#pump(bucket);
        });
        return;
      }
      bucket.available -= this.#cost(bucket, waiter.operation);
      bucket.queue.splice(index, 1);
      waiter.resolve();
    }
  }

  /** 发出一次查询前扣点：够就立即返回，不够就排队等恢复（不报错） */
  acquire(shop: string, operation: ShopifyOperation, priority: CallPriority): Promise<void> {
    const bucket = this.#bucket(shop);
    return new Promise((resolve) => {
      bucket.queue.push({ priority, operation, resolve });
      this.#pump(bucket);
    });
  }

  /** 响应给出的查询成本：记下这种查询的请求成本，按 throttleStatus 校准桶（剩余、大小、恢复速度） */
  observe(shop: string, operation: ShopifyOperation, cost: ShopifyQueryCost | undefined): void {
    if (!cost) return;
    const bucket = this.#bucket(shop);
    if (cost.requestedQueryCost > 0) bucket.costs.set(operation, cost.requestedQueryCost);
    const status = cost.throttleStatus;
    if (status && status.maximumAvailable > 0 && status.restoreRate > 0) {
      bucket.max = status.maximumAvailable;
      bucket.rate = status.restoreRate;
      bucket.available = Math.min(status.maximumAvailable, Math.max(0, status.currentlyAvailable));
      bucket.last = this.#clock.now().getTime();
    }
  }

  /** 在排队的查询数（排错与测试用） */
  queued(shop: string): number {
    return this.#bucket(shop).queue.length;
  }

  /** 此刻估计还剩几点（排错与测试用） */
  available(shop: string): number {
    const bucket = this.#bucket(shop);
    this.#refill(bucket);
    return bucket.available;
  }
}
