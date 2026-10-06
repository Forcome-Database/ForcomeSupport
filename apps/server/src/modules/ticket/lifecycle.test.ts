import {
  ticketEvents,
  ticketStatuses,
  ticketTriggers,
  type TicketEvent,
  type TicketStatus,
  type TicketTrigger,
} from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { IllegalTransitionError, transition } from './lifecycle';

/*
 * 第一期工单迁移表（PRD 6.1「第一阶段工单生命周期」，ADR 0008 要求单元测试覆盖全部迁移与非法迁移）。
 * 表的 9 行（含「已解决 → 待回复」撤销迁移与三种关闭原因）与「待回复 + 新来信」的追加一行逐条核对；
 * 其余（状态 × 事件 × 触发方）的组合全部拒绝。
 */

type Row = readonly [TicketStatus | null, TicketEvent, TicketTrigger, TicketStatus, string | null];

/** 迁移表的合法行：当前状态（null 为还没有工单）· 事件 · 触发方 → 目标状态 · 关闭原因 */
const LEGAL: readonly Row[] = [
  // （无）· 新来信，无可追加或重开的工单 → 待回复 · 系统
  [null, 'inbound', 'system', 'awaiting_reply', null],
  // 已关闭（30 天内）· 同一订单来信 → 待回复（重开）· 系统
  ['closed', 'inbound_reopen', 'system', 'awaiting_reply', null],
  // 待回复 · 识别到我方回复，且该回复之后没有未回复来信 → 等客户 · 系统
  ['awaiting_reply', 'reply_detected', 'system', 'awaiting_customer', null],
  // 待回复 · 全部未回复来信都被「标记无需回复」→ 已解决 · 坐席 / 客服主管
  ['awaiting_reply', 'all_marked_no_reply', 'member', 'resolved', null],
  // 已解决 · 5 秒内撤销「标记无需回复」→ 待回复 · 坐席 / 客服主管
  ['resolved', 'undo_mark_no_reply', 'member', 'awaiting_reply', null],
  // 待回复 · 14 天无新来信 → 已关闭（未识别到回复）· 系统
  ['awaiting_reply', 'idle_14_days', 'system', 'closed', 'reply_not_detected'],
  // 等客户、已解决 · 新来信 → 待回复 · 系统
  ['awaiting_customer', 'inbound', 'system', 'awaiting_reply', null],
  ['resolved', 'inbound', 'system', 'awaiting_reply', null],
  // 等客户 · 7 天无来信 → 已关闭（客户未回复）· 系统
  ['awaiting_customer', 'idle_7_days', 'system', 'closed', 'customer_no_reply'],
  // 已解决 · 7 天无来信 → 已关闭（已解决后无来信）· 系统
  ['resolved', 'idle_7_days', 'system', 'closed', 'resolved_no_inbound'],
];

describe('合法迁移（6.1 第一阶段迁移表）', () => {
  it.each(LEGAL)('%s + %s（%s）→ %s，关闭原因 %s', (from, event, trigger, to, closeReason) => {
    expect(transition(from, event, trigger)).toEqual({ from, to, changed: true, closeReason });
  });

  it('追加：待回复的工单收到新来信，仍是待回复（状态不变，不记迁移）', () => {
    expect(transition('awaiting_reply', 'inbound', 'system')).toEqual({
      from: 'awaiting_reply',
      to: 'awaiting_reply',
      changed: false,
      closeReason: null,
    });
  });

  it('重开、撤销与新来信都把关闭原因清空（只有到已关闭的三行带原因）', () => {
    for (const [from, event, trigger, to] of LEGAL) {
      if (to !== 'closed') expect(transition(from, event, trigger).closeReason).toBeNull();
    }
  });
});

describe('非法迁移一律拒绝', () => {
  const legal = new Set(
    [...LEGAL, ['awaiting_reply', 'inbound', 'system', 'awaiting_reply', null] as const].map(
      ([from, event, trigger]) => `${from}|${event}|${trigger}`,
    ),
  );
  const all = [null, ...ticketStatuses].flatMap((from) =>
    ticketEvents.flatMap((event) =>
      ticketTriggers.map((trigger) => [from, event, trigger] as const),
    ),
  );
  const illegal = all.filter(([from, event, trigger]) => !legal.has(`${from}|${event}|${trigger}`));

  it('表外的组合（状态 × 事件 × 触发方）都抛 IllegalTransitionError', () => {
    expect(illegal).toHaveLength(all.length - 11);
    for (const [from, event, trigger] of illegal) {
      expect(() => transition(from, event, trigger), `${from} + ${event}（${trigger}）`).toThrow(
        IllegalTransitionError,
      );
    }
  });

  it('已关闭的工单不接受普通的新来信（重开只经 inbound_reopen），也不能再关闭', () => {
    expect(() => transition('closed', 'inbound', 'system')).toThrow(
      '工单状态不能这样改变：已关闭 遇到「inbound」',
    );
    expect(() => transition('closed', 'idle_7_days', 'system')).toThrow(IllegalTransitionError);
    expect(() => transition('closed', 'idle_14_days', 'system')).toThrow(IllegalTransitionError);
  });

  it('系统事件不能由成员触发，成员的两个动作也不能由系统触发', () => {
    expect(() => transition('awaiting_reply', 'reply_detected', 'member')).toThrow(
      IllegalTransitionError,
    );
    expect(() => transition('awaiting_customer', 'idle_7_days', 'member')).toThrow(
      IllegalTransitionError,
    );
    expect(() => transition('awaiting_reply', 'all_marked_no_reply', 'system')).toThrow(
      IllegalTransitionError,
    );
    expect(() => transition('resolved', 'undo_mark_no_reply', 'system')).toThrow(
      IllegalTransitionError,
    );
  });

  it('按时关闭各看各的时限：等客户、已解决不走 14 天，待回复不走 7 天', () => {
    expect(() => transition('awaiting_reply', 'idle_7_days', 'system')).toThrow(
      IllegalTransitionError,
    );
    expect(() => transition('awaiting_customer', 'idle_14_days', 'system')).toThrow(
      IllegalTransitionError,
    );
    expect(() => transition('resolved', 'idle_14_days', 'system')).toThrow(IllegalTransitionError);
  });

  it('识别到回复只对待回复的工单迁移；撤销只对已解决的工单', () => {
    for (const from of ['awaiting_customer', 'resolved', 'closed'] as const) {
      expect(() => transition(from, 'reply_detected', 'system')).toThrow(IllegalTransitionError);
    }
    for (const from of ['awaiting_reply', 'awaiting_customer', 'closed'] as const) {
      expect(() => transition(from, 'undo_mark_no_reply', 'member')).toThrow(
        IllegalTransitionError,
      );
    }
  });

  it('只有「新来信」能新建工单', () => {
    expect(() => transition(null, 'reply_detected', 'system')).toThrow(
      '工单状态不能这样改变：新建 遇到「reply_detected」',
    );
  });
});
