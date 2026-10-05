import {
  feeItems,
  isValidRate,
  normalizeRate,
  rateChangeMessages,
  type FeeItem,
  type FieldErrors,
  type RateChangeInput,
} from '@forcome/contracts';
import {
  FieldValidationError,
  OptimisticLockError,
  recordAudit,
  transaction,
  updateWithVersion,
  type Runtime,
} from '../core';
import { listAftersalesOwners, type Access } from '../org';
import { convertedFee, feeColumnValues, feesOf, NO_FEE, type FeeValue } from './fees';
import { findAftersales, type AftersalesRow } from './ledger';
import { auditSnapshot } from './audit';
import { aftersales } from './schema';

/*
 * 修改汇率（PRD 10.1「补登与修改汇率」只有售后负责人，接口挂 aftersales.backfill；S14 编辑登记的「修改汇率」）：
 * 给某几个非美元费用项填新的汇率（1 USD = 汇率 原币），冻结美元值按新汇率重算、四舍五入到分，汇率日期为该单的
 * 费用发生日、来源「手工修改」；进行中与已完成的单可改，已取消的只读。先比版本号（G7），再把错误一次列全；记审计。
 */

export async function changeFeeRates(
  runtime: Runtime,
  access: Access,
  number: string,
  input: RateChangeInput,
): Promise<AftersalesRow | null> {
  // 越权在写事务之外判断：越权审计单独提交，不随业务事务回滚（E-24）
  const found = await access.findOwned(
    (scope) => findAftersales(runtime.db, scope, number),
    (row) => ({
      storeIds: [row.storeId],
      objectType: 'aftersales',
      objectId: row.id,
      objectLabel: row.number,
    }),
  );
  if (!found) return null;
  if (found.version !== input.version) throw new OptimisticLockError('aftersales', found.id);

  const m = rateChangeMessages;
  const errors: FieldErrors = {};
  const changes = feeItems.flatMap((item) => {
    const text = input.rates[item]?.trim();
    return text === undefined ? [] : [{ item, text }];
  });
  if (found.status === 'cancelled') errors.rates = m.cancelled;
  else if (changes.length === 0) errors.rates = m.nothing;

  const current = feesOf(found);
  const fees = Object.fromEntries(
    feeItems.map((item) => [item, current[item] ?? NO_FEE]),
  ) as Record<FeeItem, FeeValue>;
  for (const { item, text } of changes) {
    const fee = fees[item];
    const at = `rates.${item}`;
    if (fee.amount === null || fee.currency === null) errors[at] = m.feeMissing;
    else if (fee.currency === 'USD') errors[at] = m.usdNoRate;
    else if (!isValidRate(text)) errors[at] = m.rateFormat;
    else if (!found.feeDate) errors[at] = m.noFeeDate;
    else {
      fees[item] = convertedFee(fee.amount, fee.currency, {
        rate: normalizeRate(text),
        date: found.feeDate,
        source: 'manual',
      });
    }
  }
  if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);

  return transaction(runtime, async (tx) => {
    const updated = await updateWithVersion(
      tx,
      aftersales,
      { id: found.id, version: found.version },
      { ...feeColumnValues(fees), updatedAt: tx.now },
    );
    const owners = await listAftersalesOwners(tx.db);
    const ownerName = owners.find((o) => o.id === found.ownerId)?.name ?? null;
    await recordAudit(tx, access.actor, {
      action: 'aftersales.change_rate',
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
