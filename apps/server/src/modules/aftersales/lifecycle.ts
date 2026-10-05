import { COMPLETE_UNDO_SECONDS, type AftersalesStatus } from '@forcome/contracts';

/*
 * 第一阶段台账状态的迁移表（PRD 6.5「第一阶段台账状态」、S15；ADR 0008：状态机写成纯函数迁移表，状态只能经迁移表改变）：
 * 进行中 → 已完成（设为已完成，不要求字段齐全）；已完成 → 进行中（刚设为已完成，撤销时限内撤销）；进行中 → 已取消（取消，
 * 原因必填、确认保留的费用）。已完成、已取消为终态。谁能做（10.1 的「○」）由 contracts 的 aftersalesActions 判断；
 * 唯一改状态的地方是 status.ts，编辑登记与补登不改状态。
 */

export type LedgerEvent = 'complete' | 'undo_complete' | 'cancel';

export const ledgerTransitions = [
  { from: 'in_progress', event: 'complete', to: 'completed' },
  { from: 'completed', event: 'undo_complete', to: 'in_progress' },
  { from: 'in_progress', event: 'cancel', to: 'cancelled' },
] as const satisfies readonly {
  from: AftersalesStatus;
  event: LedgerEvent;
  to: AftersalesStatus;
}[];

/**
 * 撤销「设为已完成」的服务端时限：界面倒计时 COMPLETE_UNDO_SECONDS 秒，从界面收到完成结果才开始数，
 * 撤销请求到服务端还要一段网络时间，所以服务端多留 5 秒（2026-10-05 协调者同意）
 */
const UNDO_GRACE_SECONDS = 5;

/** 撤销的守卫要看的：当前时间与完成时间 */
export interface UndoContext {
  readonly now: Date;
  readonly completedAt: Date | null;
}

/** 迁移的结果：目标状态，或不能迁移（不是这个状态能做的事 · 已超过撤销时限） */
export type LedgerTransitionResult =
  { readonly to: AftersalesStatus } | { readonly error: 'not_allowed' | 'undo_expired' };

export function ledgerTransition(
  from: AftersalesStatus,
  event: LedgerEvent,
  context?: UndoContext,
): LedgerTransitionResult {
  const row = ledgerTransitions.find((t) => t.from === from && t.event === event);
  if (!row) return { error: 'not_allowed' };
  if (event === 'undo_complete') {
    const limit = (COMPLETE_UNDO_SECONDS + UNDO_GRACE_SECONDS) * 1000;
    const completedAt = context?.completedAt ?? null;
    if (!context || !completedAt || context.now.getTime() - completedAt.getTime() > limit) {
      return { error: 'undo_expired' };
    }
  }
  return { to: row.to };
}
