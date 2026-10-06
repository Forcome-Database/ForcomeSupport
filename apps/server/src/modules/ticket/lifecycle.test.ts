import { describe, expect, it } from 'vitest';
import { IllegalTransitionError, transition } from './lifecycle';

/*
 * 第一期工单迁移表（PRD 6.1「第一阶段工单生命周期」，ADR 0008 要求单元测试覆盖全部迁移与非法迁移）。
 * 待办 08 有「新来信 → 待回复」（新建）与追加，14 加「已关闭（30 天内）同一订单来信 → 待回复（重开）」；
 * 其余各行随 16、17 补齐，补一行就在这里补对应的用例。
 */

describe('合法迁移（6.1 第一阶段迁移表）', () => {
  it('（无）+ 新来信，无可追加或重开的工单 → 待回复，触发方为系统', () => {
    expect(transition(null, 'inbound', 'system')).toEqual({
      from: null,
      to: 'awaiting_reply',
      changed: true,
      closeReason: null,
    });
  });

  it('已关闭（30 天内）+ 同一订单来信 → 重开为待回复，触发方为系统，关闭原因清空（R-TK-01、AC-TK-03 第一期改写）', () => {
    expect(transition('closed', 'inbound_reopen', 'system')).toEqual({
      from: 'closed',
      to: 'awaiting_reply',
      changed: true,
      closeReason: null,
    });
  });

  it('待回复 + 新来信 → 追加，状态不变（不记迁移）', () => {
    expect(transition('awaiting_reply', 'inbound', 'system')).toEqual({
      from: 'awaiting_reply',
      to: 'awaiting_reply',
      changed: false,
      closeReason: null,
    });
  });
});

describe('非法迁移一律拒绝', () => {
  it('已关闭的工单不接受普通的新来信（只追加到未关闭的工单；重开只经 inbound_reopen）', () => {
    expect(() => transition('closed', 'inbound', 'system')).toThrow(IllegalTransitionError);
    expect(() => transition('closed', 'inbound', 'system')).toThrow(
      '工单状态不能这样改变：已关闭 遇到「inbound」',
    );
  });

  it('新来信只能由系统触发，成员不能用它新建、追加或重开', () => {
    expect(() => transition(null, 'inbound', 'member')).toThrow(IllegalTransitionError);
    expect(() => transition('awaiting_reply', 'inbound', 'member')).toThrow(IllegalTransitionError);
    expect(() => transition('closed', 'inbound_reopen', 'member')).toThrow(IllegalTransitionError);
  });

  it('重开只对已关闭的工单（未关闭的同订单工单是追加），也不能用它新建', () => {
    for (const from of [null, 'awaiting_reply', 'awaiting_customer', 'resolved'] as const) {
      expect(() => transition(from, 'inbound_reopen', 'system')).toThrow(IllegalTransitionError);
    }
  });

  it('迁移表里还没有的行（随后续待办补齐）一律拒绝', () => {
    const notYet = [
      ['awaiting_reply', 'reply_detected', 'system'],
      ['awaiting_reply', 'all_marked_no_reply', 'member'],
      ['resolved', 'undo_mark_no_reply', 'member'],
      ['awaiting_reply', 'idle_14_days', 'system'],
      ['awaiting_customer', 'idle_7_days', 'system'],
      ['awaiting_customer', 'inbound', 'system'],
    ] as const;
    for (const [from, event, trigger] of notYet) {
      expect(() => transition(from, event, trigger)).toThrow(IllegalTransitionError);
    }
  });

  it('只有「新来信」能新建工单', () => {
    expect(() => transition(null, 'reply_detected', 'system')).toThrow(
      '工单状态不能这样改变：新建 遇到「reply_detected」',
    );
  });
});
