import {
  aftersalesActions,
  clearInapplicable,
  feeItems,
  ledgerActionMessages,
  normalizeRegistration,
  registrationErrors,
  registrationItems,
  registrationMessages,
  refillableItems,
  resolveRatios,
  tidyRegistration,
  type Currency,
  type FeeItem,
  type FieldErrors,
  type RatiosInput,
  type RegistrationChanges,
  type RegistrationInput,
  type RegistrationItem,
  type RegistrationUpdate,
} from '@forcome/contracts';
import {
  AccessDeniedError,
  FieldValidationError,
  OptimisticLockError,
  recordAudit,
  transaction,
  updateWithVersion,
  type Runtime,
} from '../core';
import type { Access } from '../org';
import type { TicketReference } from '../ticket';
import { actorName, auditSnapshot, ownerNameOf } from './audit';
import { convertFees, feeColumnValues } from './fees';
import { factoryRatiosOfRow, findOwnedAftersales, missingOf, type AftersalesRow } from './ledger';
import { storeAccessTarget } from '../channel';
import { applyRateChanges, feeValuesOf } from './rates';
import {
  findSourceTicket,
  registrationColumns,
  registrationLookups,
  sourceTicketColumns,
} from './registration';
import { aftersales } from './schema';

/*
 * 编辑登记与补登（S14「编辑登记 · S-…」、S15 ③；6.5「第一阶段台账状态」、PRD 10.1）。一个接口，按单的状态分两种：
 * - 进行中：登记人或负责人改全部字段，规范化与校验同新建登记（不适用的字段清空，必填项不能空着）；
 *   原币金额、币种或费用发生日改了的费用项按费用发生日重新取汇率，没改的保留原来冻结的值（含手工改过的汇率）。
 * - 已完成：只有售后负责人补登原来空着的字段，已填的不能改（改了报「已完成的单只能补登缺失的字段」）；
 *   只校验这次填的字段，还空着的照旧算缺（R-AS-08）。
 * 「修改汇率」随「保存修改」一起提交（rates，只有售后负责人，进行中与已完成可改）。已取消只读。
 * 先比版本号（G7，409），越权（店铺范围外）记审计 403；字段与汇率的错误一次列全；改字段与改汇率各记一条审计。
 */

/** 售后单 → 登记内容（同新建登记的字段；没填的为空） */
export function registrationInputOf(row: AftersalesRow): RegistrationInput {
  const factory = factoryRatiosOfRow(row);
  const side = (value: number | undefined) =>
    value === undefined ? { fsh: null, factory: null } : { fsh: 100 - value, factory: value };
  const fee = (amount: string | null, currency: Currency | null) => ({
    amount,
    currency: currency ?? 'USD',
  });
  return {
    method: row.method,
    storeId: row.storeId,
    site: row.site,
    orderNumber: row.orderNumber ?? '',
    customerName: row.customerName ?? '',
    sourceTicket: row.sourceTicketNumber ?? '',
    feeDate: row.feeDate,
    ownerId: row.ownerId,
    responsibility: row.responsibility,
    responsibilityReason: row.responsibilityReason ?? '',
    factory: row.factoryCode,
    ratios: {
      product: side(factory?.product),
      freight: side(factory?.freight),
      other: side(factory?.other),
    },
    claimTarget: row.claimTarget,
    claimStatus: row.claimStatus,
    partSku: row.partSku,
    partQuantity: row.partQuantity,
    shipper: row.shipper,
    carrier: row.carrier ?? '',
    shipDate: row.shipDate,
    trackingNumber: row.trackingNumber ?? '',
    fees: {
      productCost: fee(row.productCost, row.productCostCurrency),
      freight: fee(row.freight, row.freightCurrency),
      compensation: fee(row.compensation, row.compensationCurrency),
      otherCost: fee(row.otherCost, row.otherCostCurrency),
    },
  };
}

/** 登记内容的一项（contracts 的 registrationItems：费用项一项一个，比例三组算一项） */
type ChangeKey = RegistrationItem;

function valueOf(input: RegistrationInput, key: ChangeKey): unknown {
  if (key.startsWith('fees.')) return input.fees[key.slice('fees.'.length) as FeeItem];
  return input[key as Exclude<keyof RegistrationInput, 'fees'>];
}

/** 比例按算出的工厂比例比较（只填一侧与两侧都填算同一个意思）；有填错的按原样比较 */
function sameRatios(a: RatiosInput, b: RatiosInput): boolean {
  const ra = resolveRatios(a).ratios;
  const rb = resolveRatios(b).ratios;
  return ra && rb
    ? JSON.stringify(ra) === JSON.stringify(rb)
    : JSON.stringify(a) === JSON.stringify(b);
}

/** 两份登记内容不同的项（都已整理写法） */
function changedKeys(before: RegistrationInput, after: RegistrationInput): ChangeKey[] {
  return registrationItems.filter((key) =>
    key === 'ratios'
      ? !sameRatios(before.ratios, after.ratios)
      : JSON.stringify(valueOf(before, key)) !== JSON.stringify(valueOf(after, key)),
  );
}

/** 这一项原来有没有填 */
function isFilled(input: RegistrationInput, key: ChangeKey): boolean {
  if (key === 'ratios') return resolveRatios(input.ratios).ratios !== null;
  if (key.startsWith('fees.')) {
    return input.fees[key.slice('fees.'.length) as FeeItem].amount !== null;
  }
  const value = valueOf(input, key);
  return value !== null && value !== '';
}

/** 把这次要改的内容盖到原来的登记上（费用项可以只给几项） */
function withChanges(previous: RegistrationInput, changes: RegistrationChanges): RegistrationInput {
  const { fees, ...rest } = changes;
  const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  return { ...previous, ...defined, fees: { ...previous.fees, ...fees } };
}

/** 把一项的值从 source 抄到 target（补登时已填的保持原值） */
function copyKey(target: RegistrationInput, source: RegistrationInput, key: ChangeKey) {
  if (key.startsWith('fees.')) {
    const item = key.slice('fees.'.length) as FeeItem;
    return { ...target, fees: { ...target.fees, [item]: source.fees[item] } };
  }
  return { ...target, [key]: valueOf(source, key) };
}

/** 错误属于哪一项（比例的错误写在 ratios.<组>.<侧>，费用写在 fees.<项>） */
const errorBelongsTo = (errorKey: string, key: ChangeKey) =>
  errorKey === key || errorKey.startsWith(`${key}.`);

export async function updateRegistration(
  runtime: Runtime,
  access: Access,
  number: string,
  update: RegistrationUpdate,
): Promise<AftersalesRow | null> {
  const m = ledgerActionMessages;
  // 越权在写事务之外判断：越权审计单独提交，不随业务事务回滚（E-24）
  const found = await findOwnedAftersales(runtime.db, access, number);
  if (!found) return null;
  if (found.version !== update.version) throw new OptimisticLockError('aftersales', found.id);

  const actions = aftersalesActions(access.member, found);
  const previous = tidyRegistration(registrationInputOf(found));
  const merged = tidyRegistration(withChanges(previous, update.changes ?? {}));
  const attempted = changedKeys(previous, merged);
  const rates = update.rates ?? {};
  const changesRates = feeItems.some((item) => rates[item] !== undefined);

  // 改字段的权限按状态：进行中要登记人或负责人，已完成要售后负责人（补登），已取消只读
  const fieldDenied =
    found.status === 'cancelled'
      ? m.cancelled
      : found.status === 'completed'
        ? m.backfillDenied
        : m.editDenied;
  if (!actions.edit && !actions.backfill && !actions.changeRate) {
    throw new AccessDeniedError(fieldDenied);
  }
  if (attempted.length > 0 && !actions.edit && !actions.backfill) {
    throw new AccessDeniedError(fieldDenied);
  }
  if (changesRates && !actions.changeRate) {
    throw new AccessDeniedError(found.status === 'cancelled' ? m.cancelled : m.rateDenied);
  }
  if (attempted.length === 0 && !changesRates) return found;

  const backfill = found.status === 'completed';
  const errors: FieldErrors = {};
  let input: RegistrationInput;
  if (backfill) {
    // 补登：只能填原来空着的、或按 R-AS-08 算缺的项（例如退款的额外赔偿登记成 0）；其余已填的不能改，
    // 只清空这次新填、却不适用的字段，原来的值一律不动
    const refillable = new Set(refillableItems(missingOf(found)));
    const locked = (key: ChangeKey) => isFilled(previous, key) && !refillable.has(key);
    for (const key of attempted) if (locked(key)) errors[key] = m.backfillFilled;
    input = clearInapplicable(merged);
    for (const key of registrationItems) if (locked(key)) input = copyKey(input, previous, key);
  } else {
    input = normalizeRegistration(merged);
  }
  const changed = (key: ChangeKey) => attempted.includes(key);

  // 换店铺、换来源工单：越权与工单查询在事务之外（同新建登记）
  if (changed('storeId') && input.storeId) {
    await access.requireStores(storeAccessTarget(runtime.db, input.storeId));
  }
  const lookUpTicket = input.sourceTicket && (changed('sourceTicket') || changed('storeId'));
  const ticket: TicketReference | null = lookUpTicket
    ? await findSourceTicket(runtime, access, input.sourceTicket)
    : null;

  return transaction(runtime, async (tx) => {
    // 表单本身的错误（进行中全部校验；补登只看这次填的项，还空着的照旧算缺）
    for (const [key, message] of Object.entries(registrationErrors(input))) {
      if (!backfill || attempted.some((k) => errorBelongsTo(key, k))) errors[key] ??= message;
    }
    const lookups = await registrationLookups(tx.db, access, input, ticket, changed);
    for (const [key, message] of Object.entries(lookups.errors)) errors[key] ??= message;

    // 费用：改了金额或币种、或改了费用发生日的项按费用发生日重新取汇率；没改的保留原来冻结的值
    const fees = feeValuesOf(found);
    const reconvert = feeItems.filter(
      (item) => changed(`fees.${item}`) || (!backfill && changed('feeDate')),
    );
    if (reconvert.length > 0 && !input.feeDate)
      errors.feeDate ??= registrationMessages.feeDateMissing;
    if (reconvert.length > 0 && input.feeDate) {
      const converted = await convertFees(tx.db, input.fees, input.feeDate);
      for (const item of reconvert) {
        fees[item] = converted.values[item];
        const error = converted.errors[`fees.${item}`];
        if (error) errors[`fees.${item}`] ??= error;
      }
    }
    // 修改汇率（随「保存修改」一起提交）：按改完的费用与费用发生日算
    const applied = applyRateChanges(fees, input.feeDate, rates);
    Object.assign(errors, applied.errors);

    const ratios = changed('ratios')
      ? resolveRatios(input.ratios).ratios
      : factoryRatiosOfRow(found);
    if (Object.keys(errors).length > 0) throw new FieldValidationError(errors);

    const ticketColumns = lookUpTicket
      ? sourceTicketColumns(ticket)
      : input.sourceTicket
        ? {
            sourceTicketId: found.sourceTicketId,
            sourceTicketNumber: found.sourceTicketNumber,
            customerId: found.customerId,
          }
        : sourceTicketColumns(null);
    // 改了负责人的待分配单出了改派队列（待办 23）
    const fieldValues = {
      ...registrationColumns(input, ratios, fees, ticketColumns),
      ...(input.ownerId !== found.ownerId ? { reassignQueuedAt: null } : {}),
    };
    const updated = await updateWithVersion(
      tx,
      aftersales,
      { id: found.id, version: found.version },
      {
        ...fieldValues,
        ...feeColumnValues(applied.fees),
        updatedAt: tx.now,
        updatedByName: actorName(access),
      },
    );

    // 审计：改字段（编辑或补登）与改汇率各一条；改字段那条的后值不含这次改的汇率
    const ownerName = await ownerNameOf(tx.db, updated.ownerId);
    const before = auditSnapshot(found, await ownerNameOf(tx.db, found.ownerId));
    const target = {
      objectType: 'aftersales' as const,
      objectId: found.id,
      objectLabel: found.number,
      storeId: updated.storeId,
    };
    const afterFields = { ...found, ...fieldValues } as AftersalesRow;
    if (attempted.length > 0) {
      await recordAudit(tx, access.actor, {
        action: backfill ? 'aftersales.backfill' : 'aftersales.update',
        ...target,
        before,
        after: auditSnapshot(afterFields, ownerName),
      });
    }
    if (changesRates) {
      await recordAudit(tx, access.actor, {
        action: 'aftersales.change_rate',
        ...target,
        before: attempted.length > 0 ? auditSnapshot(afterFields, ownerName) : before,
        after: auditSnapshot(updated, ownerName),
      });
    }
    return updated;
  });
}
