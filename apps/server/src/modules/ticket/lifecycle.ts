import {
  ticketStatusLabels,
  type TicketCloseReason,
  type TicketEvent,
  type TicketStatus,
  type TicketTrigger,
} from '@forcome/contracts';

/*
 * 第一期工单迁移表（PRD 6.1「第一阶段工单生命周期」，ADR 0008：纯函数迁移表，状态只能经它改变）。
 * 一行 = 当前状态（null 为还没有工单）+ 事件 + 触发方 → 目标状态（到已关闭的行另带关闭原因）。
 * 表结构（事件、触发方、关闭原因）一次定好，见 contracts 的 ticket.ts；各行随待办补齐：
 * - 08：新建（新来信，无可追加或重开的工单 → 待回复）与追加（待回复收到新来信，状态不变）；
 * - 14：已关闭（30 天内）同一订单来信 → 待回复（重开），已加；
 * - 16：待回复 → 等客户（识别到我方回复）、等客户 / 已解决 → 待回复（新来信）、三条按时关闭；
 * - 17：待回复 → 已解决（全部未回复来信被标记无需回复）及其 5 秒内撤销。
 * 写库只经 ticket-status.ts 的 createTicket / applyTransition（同一事务写状态变更记录；数据库约束保证状态与最近一条记录一致）。
 */

interface TransitionRule {
  readonly from: TicketStatus | null;
  readonly event: TicketEvent;
  readonly trigger: TicketTrigger;
  readonly to: TicketStatus;
  /** 目标为已关闭时的关闭原因 */
  readonly closeReason?: TicketCloseReason;
}

const PHASE1_TRANSITIONS: readonly TransitionRule[] = [
  // （无）· 新来信，无可追加或重开的工单 → 待回复 · 系统
  { from: null, event: 'inbound', trigger: 'system', to: 'awaiting_reply' },
  // 追加：待回复的工单收到新来信，仍是待回复。6.1 的表只列状态有变化的行，这一行写出来是为了让
  // 「追加」也经迁移表判断（已关闭的工单不能追加），它不产生状态变更记录
  { from: 'awaiting_reply', event: 'inbound', trigger: 'system', to: 'awaiting_reply' },
  // 已关闭（30 天内）· 同一订单来信 → 待回复（重开）· 系统（R-TK-01）。「30 天内」由归并判断（merge.ts），关闭原因随之清空
  { from: 'closed', event: 'inbound_reopen', trigger: 'system', to: 'awaiting_reply' },
];

/** 迁移的结果：changed 为 false 时状态不变（追加），不记状态变更 */
export interface Transition {
  readonly from: TicketStatus | null;
  readonly to: TicketStatus;
  readonly changed: boolean;
  readonly closeReason: TicketCloseReason | null;
}

/** 迁移表里没有这一行：调用方的判断出了错，抛出后整个事务回滚 */
export class IllegalTransitionError extends Error {
  override name = 'IllegalTransitionError';
}

/** 按迁移表求目标状态；没有对应的行抛 IllegalTransitionError */
export function transition(
  from: TicketStatus | null,
  event: TicketEvent,
  trigger: TicketTrigger,
): Transition {
  const rule = PHASE1_TRANSITIONS.find(
    (r) => r.from === from && r.event === event && r.trigger === trigger,
  );
  if (!rule) {
    const state = from === null ? '新建' : ticketStatusLabels[from];
    throw new IllegalTransitionError(
      `工单状态不能这样改变：${state} 遇到「${event}」（触发方 ${trigger}）`,
    );
  }
  return {
    from,
    to: rule.to,
    changed: rule.from !== rule.to,
    closeReason: rule.closeReason ?? null,
  };
}
