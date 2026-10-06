import type { CallPriority } from './call-priority';

interface Waiter {
  readonly priority: CallPriority;
  readonly resolve: () => void;
}

/**
 * Fake 的配额（待办 13）：模拟平台配额用完时调用排队、高优先级先走（真实现的配额见 sp-api-quota.ts、shopify-quota.ts）。
 * 默认不限；测试用 limit(n) 只放行接下来的 n 次调用，其余排队，grant(k) 再放行 k 个（先高优先级，同一优先级先来先得），
 * unlimit() 放行全部并恢复不限。另按先后记下每次调用的优先级（priorities），供测试核对回补与对账走低优先级。
 */
export class FakeQuota {
  /** 还能直接放行几次；null 为不限 */
  #remaining: number | null = null;
  #queue: Waiter[] = [];
  #priorities: CallPriority[] = [];

  /** 每次调用的优先级（按调用先后，含排队中的） */
  get priorities(): readonly CallPriority[] {
    return this.#priorities;
  }

  /** 在排队的调用数（只数某个优先级时给出 priority） */
  waiting(priority?: CallPriority): number {
    return this.#queue.filter((w) => !priority || w.priority === priority).length;
  }

  /** 只放行接下来的 n 次调用（默认 0：配额已用完），其余排队 */
  limit(n = 0): void {
    this.#remaining = n;
  }

  /** 再放行 k 个：先给排队的（高优先级先），剩下的留给之后的调用 */
  grant(k = 1): void {
    let left = k;
    while (left > 0 && this.#queue.length > 0) {
      const index = this.#queue.findIndex((w) => w.priority === 'high');
      this.#queue.splice(index === -1 ? 0 : index, 1)[0]!.resolve();
      left -= 1;
    }
    if (this.#remaining !== null) this.#remaining += left;
  }

  /** 恢复不限，排队的全部放行 */
  unlimit(): void {
    this.#remaining = null;
    for (const waiter of this.#queue.splice(0)) waiter.resolve();
  }

  /** Fake 在每个受配额约束的操作开头调用：有配额立即返回，没有就排队 */
  acquire(priority: CallPriority): Promise<void> {
    this.#priorities.push(priority);
    if (this.#remaining === null) return Promise.resolve();
    if (this.#remaining > 0 && this.#queue.length === 0) {
      this.#remaining -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.#queue.push({ priority, resolve }));
  }

  reset(): void {
    this.unlimit();
    this.#priorities = [];
  }
}
