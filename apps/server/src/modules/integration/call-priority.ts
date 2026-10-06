/**
 * 外部调用排队取配额的优先级（规格 order「增量优先、回补与对账让路」，待办 12、13）：high 为增量同步、通知触发的拉取与按订单号补拉，
 * low 为订单回补与夜间对账。真实现各按平台的配额排队（SP-API：sp-api-quota.ts；Shopify：shopify-quota.ts），Fake 用 fake-quota.ts
 */
export type CallPriority = 'high' | 'low';

/** 排队的下一个：先高优先级，同一优先级先来先得（队列按到达先后）；队列空为 -1 */
export function nextInQueue(queue: readonly { readonly priority: CallPriority }[]): number {
  if (queue.length === 0) return -1;
  const high = queue.findIndex((w) => w.priority === 'high');
  return high === -1 ? 0 : high;
}
