import { setTimeout as sleep } from 'node:timers/promises';
import type { Clock } from '../core';

/*
 * SP-API 的配额（规格 order「每个『卖家 × 接口』共享令牌桶，增量优先、回补与对账让路，配额以响应头为准」、ADR 0008 修订，待办 12）：
 * - 亚马逊按「卖家账户 × 应用 × 接口」限流（令牌桶：每秒恢复 rate 个，最多攒 burst 个），超出返回 429；
 * - 我们在调用前先从本进程的桶里取令牌：每个「卖家 × 接口」一个桶，同一卖家的增量同步、按订单号补拉、回补与对账（13）共用；
 *   桶空了调用排队等令牌，不报错；排队的按优先级取——高（增量同步、通知触发的拉取、按订单号补拉）先于低（回补、夜间对账，13），
 *   同一优先级先来先得；
 * - 默认用量计划取官方模型文件，响应头 x-amzn-RateLimit-Limit 给出实际的 rate 时按它（业务量大的卖家配额更高）；收到 429 时把桶清空，
 *   按 rate 重新攒；
 * - 只在本进程内共享：订单同步的调用都在 worker 里（一个 worker 进程），api 进程只有「测试连接」偶尔用一次。
 * 等待用注入的 wait（测试里推进手动时钟），时间按注入的时钟算。
 */

/** 排队取令牌的优先级：high 为增量同步、通知触发的拉取与按订单号补拉，low 为回补与夜间对账（13） */
export type SpApiPriority = 'high' | 'low';

/** 一个接口的用量计划：每秒恢复几个令牌、桶里最多几个（突发） */
export interface UsagePlan {
  readonly rate: number;
  readonly burst: number;
}

/** 各接口的默认用量计划（Orders v2026-01-01 与 Sellers v1 的官方模型文件）；实际以响应头为准 */
export const SP_API_USAGE_PLANS = {
  searchOrders: { rate: 0.0056, burst: 20 },
  getOrder: { rate: 0.5, burst: 30 },
  getMarketplaceParticipations: { rate: 0.016, burst: 15 },
} as const satisfies Record<string, UsagePlan>;
export type SpApiOperation = keyof typeof SP_API_USAGE_PLANS;

interface Waiter {
  readonly priority: SpApiPriority;
  readonly resolve: () => void;
}

interface Bucket {
  tokens: number;
  rate: number;
  readonly burst: number;
  /** 上次补令牌的时刻（毫秒） */
  last: number;
  /** 按到达先后 */
  readonly queue: Waiter[];
  /** 正在等下一个令牌 */
  waiting: boolean;
}

export class SpApiQuota {
  readonly #clock: Clock;
  readonly #wait: (ms: number) => Promise<void>;
  readonly #buckets = new Map<string, Bucket>();

  constructor(clock: Clock, wait: (ms: number) => Promise<void> = (ms) => sleep(ms)) {
    this.#clock = clock;
    this.#wait = wait;
  }

  #bucket(sellerId: string, operation: SpApiOperation): Bucket {
    const key = `${sellerId} × ${operation}`;
    let bucket = this.#buckets.get(key);
    if (!bucket) {
      const plan = SP_API_USAGE_PLANS[operation];
      bucket = {
        tokens: plan.burst,
        rate: plan.rate,
        burst: plan.burst,
        last: this.#clock.now().getTime(),
        queue: [],
        waiting: false,
      };
      this.#buckets.set(key, bucket);
    }
    return bucket;
  }

  #refill(bucket: Bucket): void {
    const now = this.#clock.now().getTime();
    const elapsed = Math.max(0, now - bucket.last) / 1000;
    bucket.tokens = Math.min(bucket.burst, bucket.tokens + elapsed * bucket.rate);
    bucket.last = now;
  }

  /** 发给排在最前的：先高优先级，同一优先级先来先得 */
  #next(bucket: Bucket): Waiter | undefined {
    const index = bucket.queue.findIndex((w) => w.priority === 'high');
    return bucket.queue.splice(index === -1 ? 0 : index, 1)[0];
  }

  #pump(bucket: Bucket): void {
    if (bucket.waiting) return;
    this.#refill(bucket);
    while (bucket.queue.length > 0 && bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.#next(bucket)?.resolve();
    }
    if (bucket.queue.length === 0) return;
    const ms = Math.ceil(((1 - bucket.tokens) / bucket.rate) * 1000);
    bucket.waiting = true;
    void this.#wait(ms).then(() => {
      bucket.waiting = false;
      this.#pump(bucket);
    });
  }

  /** 取一个令牌：有就立即返回，没有就排队等（不报错） */
  acquire(sellerId: string, operation: SpApiOperation, priority: SpApiPriority): Promise<void> {
    const bucket = this.#bucket(sellerId, operation);
    return new Promise((resolve) => {
      bucket.queue.push({ priority, resolve });
      this.#pump(bucket);
    });
  }

  /** 响应头 x-amzn-RateLimit-Limit 给出的实际 rate（每秒几个）；取不到或不合法时不变 */
  observeRate(sellerId: string, operation: SpApiOperation, header: string | null): void {
    const rate = header === null ? Number.NaN : Number(header);
    if (!Number.isFinite(rate) || rate <= 0) return;
    const bucket = this.#bucket(sellerId, operation);
    this.#refill(bucket);
    bucket.rate = rate;
  }

  /** 收到 429：亚马逊那边的桶已空，我们的也清空，按 rate 重新攒 */
  throttled(sellerId: string, operation: SpApiOperation): void {
    const bucket = this.#bucket(sellerId, operation);
    this.#refill(bucket);
    bucket.tokens = 0;
  }

  /** 在排队等令牌的调用数（排错与测试用） */
  queued(sellerId: string, operation: SpApiOperation): number {
    return this.#bucket(sellerId, operation).queue.length;
  }

  /** 桶里此刻有几个令牌（排错与测试用） */
  available(sellerId: string, operation: SpApiOperation): number {
    const bucket = this.#bucket(sellerId, operation);
    this.#refill(bucket);
    return bucket.tokens;
  }
}
