import {
  aftersalesActions,
  CANCEL_REASON_MAX,
  COMPLETE_UNDO_SECONDS,
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
import type { Access } from '../org';
import { auditSnapshot } from './audit';
import { findAftersales, type AftersalesRow } from './ledger';
import { ownerNameOf } from './rates';
import { actorName } from './registration';
import { aftersales } from './schema';

/*
 * 台账的状态（6.5「第一阶段台账状态」、S15、PRD 10.1）：进行中 → 已完成（登记人或负责人，不要求字段齐全，记完成时间，
 * 5 秒内可撤销）；进行中 → 已取消（客服主管或售后负责人，原因必填，确认保留的已产生费用，AC-AS-16）。
 * 已完成、已取消为终态。都先比版本号（G7，409），状态不对报在 status 上，没有权限 403；都记审计。
 */

/**
 * 撤销「设为已完成」的服务端时限：界面倒计时 COMPLETE_UNDO_SECONDS 秒，从界面收到完成结果才开始数，
 * 撤销请求到服务端还要一段网络时间，所以服务端多留 5 秒（2026-10-05 用户确认）
 */
const UNDO_GRACE_SECONDS = 5;

/** 按单号取一张（店铺范围外记越权审计 403，E-24）并比版本号 */
async function loadForChange(
  runtime: Runtime,
  access: Access,
  number: string,
  version: number,
): Promise<AftersalesRow | null> {
  const found = await access.findOwned(
    (scope) => findAftersales(runtime.db, scope, number),
    (row) => ({
      storeIds: [row.storeId],
      objectType: 'aftersales',
      objectId: row.id,
      objectLabel: row.number,
    }),
  );
  if (found && found.version !== version) throw new OptimisticLockError('aftersales', found.id);
  return found;
}

/** 改状态并记审计（前后值是完整的登记） */
async function changeStatus(
  tx: Tx,
  access: Access,
  found: AftersalesRow,
  action: string,
  values: Partial<typeof aftersales.$inferInsert>,
): Promise<AftersalesRow> {
  const updated = await updateWithVersion(
    tx,
    aftersales,
    { id: found.id, version: found.version },
    { ...values, updatedAt: tx.now, updatedByName: actorName(access) },
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
}

/** 只有进行中的单可以设为已完成、取消 */
function requireOpen(found: AftersalesRow) {
  if (found.status !== 'in_progress') {
    throw new FieldValidationError({ status: ledgerActionMessages.notOpen });
  }
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
  requireOpen(found);
  if (!aftersalesActions(access.member, found).complete) {
    throw new AccessDeniedError(ledgerActionMessages.editDenied);
  }
  return transaction(runtime, (tx) =>
    changeStatus(tx, access, found, 'aftersales.complete', {
      status: 'completed',
      completedAt: tx.now,
    }),
  );
}

/**
 * 撤销「设为已完成」（S15 ①「撤销」）：只在刚设为已完成的时限内，由能设为已完成的人（登记人或负责人）撤销，
 * 回到进行中、清掉完成时间；过了时限报「已超过撤销时限，这张单保持已完成」
 */
export async function undoComplete(
  runtime: Runtime,
  access: Access,
  number: string,
  input: VersionInput,
): Promise<AftersalesRow | null> {
  const found = await loadForChange(runtime, access, number, input.version);
  if (!found) return null;
  if (!aftersalesActions(access.member, { ...found, status: 'in_progress' }).complete) {
    throw new AccessDeniedError(ledgerActionMessages.editDenied);
  }
  if (found.status !== 'completed') {
    throw new FieldValidationError({ status: ledgerActionMessages.undoNotCompleted });
  }
  const limit = (COMPLETE_UNDO_SECONDS + UNDO_GRACE_SECONDS) * 1000;
  if (
    found.completedAt === null ||
    runtime.clock.now().getTime() - found.completedAt.getTime() > limit
  ) {
    throw new FieldValidationError({ status: ledgerActionMessages.undoExpired });
  }
  return transaction(runtime, (tx) =>
    changeStatus(tx, access, found, 'aftersales.undo_complete', {
      status: 'in_progress',
      completedAt: null,
    }),
  );
}

/**
 * 取消售后单（S15 ②、AC-AS-16）：客服主管或售后负责人；原因必填（最多 200 字），keptFees 是确认保留的已产生费用
 * （只能是已登记的项）。保留的照常计入售后成本，没保留的不计（R-AS-08），原登记额仍在费用列里。已取消不能恢复。
 */
export async function cancelAftersales(
  runtime: Runtime,
  access: Access,
  number: string,
  input: CancelInput,
): Promise<AftersalesRow | null> {
  const m = ledgerActionMessages;
  const found = await loadForChange(runtime, access, number, input.version);
  if (!found) return null;
  requireOpen(found);
  if (!aftersalesActions(access.member, found).cancel) {
    throw new AccessDeniedError('你的角色没有这项权限');
  }

  const errors: FieldErrors = {};
  const reason = input.reason.trim();
  if (!reason) errors.reason = m.reasonMissing;
  else if (reason.length > CANCEL_REASON_MAX) errors.reason = m.reasonTooLong;
  const kept = new Set(input.keptFees);
  if (feeItems.some((item) => kept.has(item) && found[item] === null)) {
    errors.keptFees = m.keptNotRegistered;
  }
  if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);

  // 已登记的项记保留与否，没登记的项为空
  const keptColumn = (item: (typeof feeItems)[number]) =>
    found[item] === null ? null : kept.has(item);
  return transaction(runtime, (tx) =>
    changeStatus(tx, access, found, 'aftersales.cancel', {
      status: 'cancelled',
      cancelReason: reason,
      cancelledAt: tx.now,
      productCostKept: keptColumn('productCost'),
      freightKept: keptColumn('freight'),
      compensationKept: keptColumn('compensation'),
      otherCostKept: keptColumn('otherCost'),
    }),
  );
}
