import { PENDING_OWNER_WORDS } from '@forcome/contracts';
import type { DbExecutor } from '../core';
import { memberNamesById, type Access } from '../org';
import { feesOf } from './fees';
import { keptFeesOf, ratiosOf, type AftersalesRow } from './ledger';

/** 审计与「最近保存的人」里的操作人姓名（系统写入为空） */
export function actorName(access: Access): string | null {
  return access.actor.kind === 'member' ? access.actor.name : null;
}

/** 负责人姓名（审计快照用；离职的也取得到） */
export async function ownerNameOf(db: DbExecutor, ownerId: string | null): Promise<string | null> {
  if (!ownerId) return null;
  return (await memberNamesById(db, [ownerId])).get(ownerId) ?? null;
}

/**
 * 审计里的完整前后值：抽屉能填的全部字段（金额含汇率与冻结美元值）与系统定下的编号、状态、创建路径、登记人，
 * 以及完成时间与取消（原因、确认保留的费用项，AC-AS-16）。待分配的单（改派队列，待办 23）负责人写「待分配」
 * （P27 摘要「负责人：李婷 → 待分配」），负责人 ID 仍是原负责人
 */
export function auditSnapshot(row: AftersalesRow, ownerName: string | null) {
  return {
    number: row.number,
    status: row.status,
    origin: row.origin,
    storeId: row.storeId,
    site: row.site,
    sourceTicket: row.sourceTicketNumber,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    registeredBy: row.registeredByName,
    ownerId: row.ownerId,
    ownerName: row.reassignQueuedAt ? PENDING_OWNER_WORDS : ownerName,
    feeDate: row.feeDate,
    method: row.method,
    responsibility: row.responsibility,
    responsibilityReason: row.responsibilityReason,
    factory: row.factoryCode,
    part: row.partSku ? { sku: row.partSku, quantity: row.partQuantity } : null,
    shipper: row.shipper,
    carrier: row.carrier,
    shipDate: row.shipDate,
    trackingNumber: row.trackingNumber,
    claimTarget: row.claimTarget,
    claimStatus: row.claimStatus,
    fees: feesOf(row),
    ratios: ratiosOf(row),
    completedAt: row.completedAt?.toISOString() ?? null,
    cancellation:
      row.status === 'cancelled'
        ? {
            reason: row.cancelReason,
            at: row.cancelledAt?.toISOString() ?? null,
            keptFees: keptFeesOf(row),
          }
        : null,
  };
}
