import {
  aftersalesActions,
  CANCEL_REASON_MAX,
  ownsRegistration,
  feeItems,
  ledgerActionMessages,
  type CancelInput,
  type FieldErrors,
  type VersionInput,
} from '@forcome/contracts';
import {
  AccessDeniedError,
  FieldValidationError,
  OptimisticLockError,
  recordAudit,
  transaction,
  updateWithVersion,
  type Runtime,
  type Tx,
} from '../core';
import { listAftersalesOwners, lockMembersForShare, type Access } from '../org';
import { actorName, auditSnapshot, ownerNameOf } from './audit';
import { keptFeeColumns } from './fees';
import { findOwnedAftersales, type AftersalesRow } from './ledger';
import { ledgerTransition, type LedgerEvent } from './lifecycle';
import { aftersales } from './schema';

/*
 * 台账的状态（6.5「第一阶段台账状态」、S15、PRD 10.1）：设为已完成（登记人或负责人，不要求字段齐全，记完成时间，5 秒内可撤销）、
 * 撤销、取消（客服主管或售后负责人，原因必填，确认保留的已产生费用，AC-AS-16）。状态只经迁移表（lifecycle.ts）改变，
 * 这里是唯一的写入口。都先比版本号（G7，409）；不是这个状态能做的事报在 status 上（400）；没有权限 403；都记审计（完整前后值）。
 */

const m = ledgerActionMessages;

/** 按单号取一张（店铺范围外记越权审计 403，E-24）并比版本号 */
async function loadForChange(
  runtime: Runtime,
  access: Access,
  number: string,
  version: number,
): Promise<AftersalesRow | null> {
  const found = await findOwnedAftersales(runtime.db, access, number);
  if (found && found.version !== version) throw new OptimisticLockError('aftersales', found.id);
  return found;
}

/** 问迁移表要目标状态；不能迁移时报在 status 上 */
function targetOf(runtime: Runtime, found: AftersalesRow, event: LedgerEvent) {
  const result = ledgerTransition(found.status, event, {
    now: runtime.clock.now(),
    completedAt: found.completedAt,
  });
  if ('error' in result) {
    const message =
      result.error === 'undo_expired'
        ? m.undoExpired
        : event === 'undo_complete'
          ? m.undoNotCompleted
          : m.notOpen;
    throw new FieldValidationError({ status: message });
  }
  return result.to;
}

/** 写新状态（与这次的其他列，按事务时间给出）并记审计；完成、取消时刻与更新时间、审计时间同一个 tx.now */
function changeStatus(
  runtime: Runtime,
  access: Access,
  found: AftersalesRow,
  action: 'aftersales.complete' | 'aftersales.undo_complete' | 'aftersales.cancel',
  values: (
    tx: Tx,
  ) => Partial<typeof aftersales.$inferInsert> | Promise<Partial<typeof aftersales.$inferInsert>>,
): Promise<AftersalesRow> {
  return transaction(runtime, async (tx) => {
    const updated = await updateWithVersion(
      tx,
      aftersales,
      { id: found.id, version: found.version },
      { ...(await values(tx)), updatedAt: tx.now, updatedByName: actorName(access) },
    );
    const ownerName = await ownerNameOf(tx.db, found.ownerId);
    await recordAudit(tx, access.actor, {
      action,
      objectType: 'aftersales',
      objectId: found.id,
      objectLabel: found.number,
      storeId: found.storeId,
      before: auditSnapshot(found, ownerName),
      after: auditSnapshot(updated, ownerName),
    });
    return updated;
  });
}

/** 设为已完成（S15 ①）：登记人或负责人；不要求字段齐全，记完成时间（完整率按它归月） */
export async function completeAftersales(
  runtime: Runtime,
  access: Access,
  number: string,
  input: VersionInput,
): Promise<AftersalesRow | null> {
  const found = await loadForChange(runtime, access, number, input.version);
  if (!found) return null;
  const status = targetOf(runtime, found, 'complete');
  if (!aftersalesActions(access.member, found).complete) throw new AccessDeniedError(m.editDenied);
  return changeStatus(runtime, access, found, 'aftersales.complete', (tx) => ({
    status,
    completedAt: tx.now,
  }));
}

/**
 * 撤销「设为已完成」（S15 ①「撤销」）：只在刚设为已完成的时限内，由能设为已完成的人（登记人或负责人）撤销，
 * 回到进行中、清掉完成时间。负责人在这期间被停用了（不再是在职的售后负责人）：回到进行中的同时标为待分配，进改派队列
 * （停用后不留无人负责的进行中单；先给负责人的成员行加共享锁再看，与停用串行，协调者 2026-10-14 决定 R2）
 */
export async function undoComplete(
  runtime: Runtime,
  access: Access,
  number: string,
  input: VersionInput,
): Promise<AftersalesRow | null> {
  const found = await loadForChange(runtime, access, number, input.version);
  if (!found) return null;
  // 先看是不是这张单的登记人或负责人（与状态无关），再问迁移表
  if (!ownsRegistration(access.member, found)) throw new AccessDeniedError(m.editDenied);
  const status = targetOf(runtime, found, 'undo_complete');
  return changeStatus(runtime, access, found, 'aftersales.undo_complete', async (tx) => {
    const ownerId = found.ownerId;
    if (!ownerId || found.reassignQueuedAt) return { status, completedAt: null };
    await lockMembersForShare(tx.db, [ownerId]);
    const active = (await listAftersalesOwners(tx.db)).some((owner) => owner.id === ownerId);
    return { status, completedAt: null, ...(active ? {} : { reassignQueuedAt: tx.now }) };
  });
}

/**
 * 取消售后单（S15 ②、AC-AS-16）：客服主管或售后负责人；原因必填（最多 200 字），keptFees 是确认保留的
 * 已产生费用（只能是已登记的项）。保留的照常计入售后成本，没保留的不计（R-AS-08），原登记额仍在费用列里。已取消不能恢复。
 */
export async function cancelAftersales(
  runtime: Runtime,
  access: Access,
  number: string,
  input: CancelInput,
): Promise<AftersalesRow | null> {
  const found = await loadForChange(runtime, access, number, input.version);
  if (!found) return null;
  const status = targetOf(runtime, found, 'cancel');
  if (!aftersalesActions(access.member, found).cancel) throw new AccessDeniedError(m.cancelDenied);

  const errors: FieldErrors = {};
  const reason = input.reason.trim();
  if (!reason) errors.reason = m.reasonMissing;
  else if (reason.length > CANCEL_REASON_MAX) errors.reason = m.reasonTooLong;
  const kept = new Set(input.keptFees);
  if (feeItems.some((item) => kept.has(item) && found[item] === null)) {
    errors.keptFees = m.keptNotRegistered;
  }
  if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);

  return changeStatus(runtime, access, found, 'aftersales.cancel', (tx) => ({
    status,
    cancelReason: reason,
    cancelledAt: tx.now,
    // 已登记的项记保留与否，没登记的项为空
    ...keptFeeColumns(
      (item) => found[item] !== null,
      (item) => kept.has(item),
    ),
  }));
}
