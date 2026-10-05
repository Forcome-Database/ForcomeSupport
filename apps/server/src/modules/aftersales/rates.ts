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
import type { Access } from '../org';
import { convertedFee, feeColumnValues, feesOf, NO_FEE, type FeeValue } from './fees';
import { findOwnedAftersales, type AftersalesRow } from './ledger';
import { actorName, auditSnapshot, ownerNameOf } from './audit';
import { aftersales } from './schema';

/*
 * 修改汇率（PRD 10.1「补登与修改汇率」只有售后负责人，接口挂 aftersales.backfill；S14 编辑登记的「修改汇率」）：
 * 给某几个非美元费用项填新的汇率（1 USD = 汇率 原币），冻结美元值按新汇率重算、四舍五入到分，汇率日期为该单的
 * 费用发生日、来源「手工修改」；进行中与已完成的单可改，已取消的只读。先比版本号（G7），再把错误一次列全；记审计。
 * 编辑登记抽屉里「修改汇率」随「保存修改」一起提交（edit.ts），用同一个 applyRateChanges。
 */

/** 一张单的四个费用项（没登记的为空） */
export function feeValuesOf(row: AftersalesRow): Record<FeeItem, FeeValue> {
  const current = feesOf(row);
  return Object.fromEntries(feeItems.map((item) => [item, current[item] ?? NO_FEE])) as Record<
    FeeItem,
    FeeValue
  >;
}

/**
 * 按新汇率重算几个费用项（rates：费用项 → 1 USD = 汇率 原币）：没登记的、美元的、汇率格式不对、没有费用发生日的
 * 在 `rates.<费用项>` 上报错；其余的冻结美元值按新汇率重算，汇率日期为费用发生日、来源「手工修改」
 */
export function applyRateChanges(
  fees: Readonly<Record<FeeItem, FeeValue>>,
  feeDate: string | null,
  rates: RateChangeInput['rates'],
): { fees: Record<FeeItem, FeeValue>; errors: FieldErrors } {
  const m = rateChangeMessages;
  const next = { ...fees };
  const errors: FieldErrors = {};
  for (const item of feeItems) {
    const text = rates[item]?.trim();
    if (text === undefined) continue;
    const fee = next[item];
    const at = `rates.${item}`;
    if (fee.amount === null || fee.currency === null) errors[at] = m.feeMissing;
    else if (fee.currency === 'USD') errors[at] = m.usdNoRate;
    else if (!isValidRate(text)) errors[at] = m.rateFormat;
    else if (!feeDate) errors[at] = m.noFeeDate;
    else {
      next[item] = convertedFee(fee.amount, fee.currency, {
        rate: normalizeRate(text),
        date: feeDate,
        source: 'manual',
      });
    }
  }
  return { fees: next, errors };
}

export async function changeFeeRates(
  runtime: Runtime,
  access: Access,
  number: string,
  input: RateChangeInput,
): Promise<AftersalesRow | null> {
  const found = await findOwnedAftersales(runtime.db, access, number);
  if (!found) return null;
  if (found.version !== input.version) throw new OptimisticLockError('aftersales', found.id);

  const m = rateChangeMessages;
  const errors: FieldErrors = {};
  const hasChanges = feeItems.some((item) => input.rates[item] !== undefined);
  if (found.status === 'cancelled') errors.rates = m.cancelled;
  else if (!hasChanges) errors.rates = m.nothing;
  const applied = applyRateChanges(feeValuesOf(found), found.feeDate, input.rates);
  Object.assign(errors, applied.errors);
  if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);

  return transaction(runtime, async (tx) => {
    const updated = await updateWithVersion(
      tx,
      aftersales,
      { id: found.id, version: found.version },
      { ...feeColumnValues(applied.fees), updatedAt: tx.now, updatedByName: actorName(access) },
    );
    const ownerName = await ownerNameOf(tx.db, found.ownerId);
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
