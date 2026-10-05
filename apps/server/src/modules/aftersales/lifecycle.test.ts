import type { AftersalesStatus } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { ledgerTransition, ledgerTransitions, type LedgerEvent } from './lifecycle';

/*
 * 第一阶段台账状态的迁移表（PRD 6.5「第一阶段台账状态」、S15；ADR 0008：状态机写成纯函数迁移表，单元测试覆盖全部迁移）：
 * 进行中 → 已完成（设为已完成）；已完成 → 进行中（5 秒内撤销）；进行中 → 已取消（取消）。已完成、已取消为终态。
 */

const NOW = new Date('2026-09-11T02:20:00Z');
const seconds = (n: number) => new Date(NOW.getTime() - n * 1000);

describe('第一阶段台账状态的迁移表（6.5）', () => {
  it('合法的迁移只有四行：新建登记、设为已完成、撤销（带撤销时限的守卫）、取消', () => {
    expect(ledgerTransitions.map(({ from, event, to }) => [from, event, to])).toEqual([
      [null, 'register', 'in_progress'],
      ['in_progress', 'complete', 'completed'],
      ['completed', 'undo_complete', 'in_progress'],
      ['in_progress', 'cancel', 'cancelled'],
    ]);
    expect(ledgerTransitions.filter((t) => t.guard).map((t) => t.event)).toEqual(['undo_complete']);
  });

  it('新建登记的单是进行中；已有状态的单不能再「新建」', () => {
    expect(ledgerTransition(null, 'register')).toEqual({ to: 'in_progress' });
    expect(ledgerTransition('in_progress', 'register')).toEqual({ error: 'not_allowed' });
  });

  it('进行中可以设为已完成、取消', () => {
    expect(ledgerTransition('in_progress', 'complete')).toEqual({ to: 'completed' });
    expect(ledgerTransition('in_progress', 'cancel')).toEqual({ to: 'cancelled' });
  });

  it('设为已完成后在撤销时限内撤销回到进行中（界面 5 秒，服务端多留 5 秒网络余量）', () => {
    expect(
      ledgerTransition('completed', 'undo_complete', { now: NOW, completedAt: seconds(4) }),
    ).toEqual({ to: 'in_progress' });
    expect(
      ledgerTransition('completed', 'undo_complete', { now: NOW, completedAt: seconds(10) }),
    ).toEqual({ to: 'in_progress' });
    expect(
      ledgerTransition('completed', 'undo_complete', { now: NOW, completedAt: seconds(11) }),
    ).toEqual({ error: 'undo_expired' });
    // 没有完成时间（例如历史导入的已完成单）不能撤销
    expect(ledgerTransition('completed', 'undo_complete', { now: NOW, completedAt: null })).toEqual(
      { error: 'undo_expired' },
    );
  });

  it('已完成、已取消为终态：不能再设为已完成或取消；不是已完成的单没有可撤销的', () => {
    const illegal: [AftersalesStatus, LedgerEvent][] = [
      ['completed', 'complete'],
      ['completed', 'cancel'],
      ['cancelled', 'complete'],
      ['cancelled', 'cancel'],
      ['cancelled', 'undo_complete'],
      ['in_progress', 'undo_complete'],
      ['completed', 'register'],
      ['cancelled', 'register'],
    ];
    for (const [from, event] of illegal) {
      expect(
        ledgerTransition(from, event, { now: NOW, completedAt: NOW }),
        `${from} · ${event}`,
      ).toEqual({
        error: 'not_allowed',
      });
    }
  });
});
