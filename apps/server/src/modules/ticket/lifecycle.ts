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
 * 表结构（事件、触发方、关闭原因）见 contracts 的 ticket.ts。6.1 的 9 行在 16 补齐（08 有新建与追加，14 加了重开）：
 * 「待回复 → 已解决」与它 5 秒内的撤销两行由 17 的「标记无需回复」使用。哪些来信算「未回复」（决定识别到回复后是否转等客户、
 * 新来信是否让工单回到待回复）由调用方判断（replies.ts、merge.ts），迁移表只管状态。
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
  // 待回复 · 识别到我方回复，且该回复之后没有未回复来信 → 等客户 · 系统（R-SL-08，replies.ts）
  { from: 'awaiting_reply', event: 'reply_detected', trigger: 'system', to: 'awaiting_customer' },
  // 待回复 · 全部未回复来信都被「标记无需回复」→ 已解决 · 坐席 / 客服主管（17）
  { from: 'awaiting_reply', event: 'all_marked_no_reply', trigger: 'member', to: 'resolved' },
  // 已解决 · 5 秒内撤销「标记无需回复」→ 待回复 · 坐席 / 客服主管（17）
  { from: 'resolved', event: 'undo_mark_no_reply', trigger: 'member', to: 'awaiting_reply' },
  // 待回复 · 14 天无新来信 → 已关闭（未识别到回复；其中的应回复来信 SLA 计未达标）· 系统（time-limits.ts）
  {
    from: 'awaiting_reply',
    event: 'idle_14_days',
    trigger: 'system',
    to: 'closed',
    closeReason: 'reply_not_detected',
  },
  // 等客户、已解决 · 新来信（不论来源）→ 待回复 · 系统（merge.ts）
  { from: 'awaiting_customer', event: 'inbound', trigger: 'system', to: 'awaiting_reply' },
  { from: 'resolved', event: 'inbound', trigger: 'system', to: 'awaiting_reply' },
  // 等客户 · 7 天无来信 → 已关闭（客户未回复）· 系统
  {
    from: 'awaiting_customer',
    event: 'idle_7_days',
    trigger: 'system',
    to: 'closed',
    closeReason: 'customer_no_reply',
  },
  // 已解决 · 7 天无来信 → 已关闭（已解决后无来信）· 系统
  {
    from: 'resolved',
    event: 'idle_7_days',
    trigger: 'system',
    to: 'closed',
    closeReason: 'resolved_no_inbound',
  },
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
