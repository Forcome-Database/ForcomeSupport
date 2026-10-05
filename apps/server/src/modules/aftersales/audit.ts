import { feesOf } from './fees';
import { ratiosOf, type AftersalesRow } from './ledger';

/** 审计里的完整前后值：抽屉能填的全部字段（金额含汇率与冻结美元值）与系统定下的编号、状态、创建路径、登记人 */
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
    ownerName,
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
  };
}
