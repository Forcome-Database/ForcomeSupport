import {
  normalizeRegistration,
  ownersForStore,
  registrationErrors,
  registrationMessages,
  resolveRatios,
  responsibilities,
  type FactoryRatios,
  type FeeItem,
  type FieldErrors,
  type LedgerOptions,
  type OwnerOption,
  type RegistrationInput,
  type RegistrationOptions,
  type StoreOption,
} from '@forcome/contracts';
import { listStoreOptions } from '../channel';
import {
  FieldValidationError,
  isStoreInScope,
  nextBusinessNumber,
  recordAudit,
  transaction,
  type DbExecutor,
  type Runtime,
  type StoreScope,
} from '../core';
import { listFactories, listParts } from '../factory';
import { listAftersalesOwners, type Access } from '../org';
import { findTicketReference, type TicketReference } from '../ticket';
import { actorName, auditSnapshot } from './audit';
import { convertFees, feeColumnValues, type FeeValue } from './fees';
import { type AftersalesRow } from './ledger';
import { ledgerTransition } from './lifecycle';
import { aftersales, responsibilityRatio } from './schema';

/*
 * 新建登记（P13「第一阶段」、S14、R-AS-08；6.5「第一阶段台账状态」、D-24）：客服主管与售后负责人手工登记一张售后单，
 * 状态「进行中」、创建路径「手工登记」；每个金额按费用发生日取汇率，保存原币、汇率、汇率日期与来源、冻结美元值
 * （R-FL-06，待办 20）。表单本身的错误（contracts 的 registrationErrors）与要查库的错误（店铺、来源工单、负责人是否
 * 合格、生产厂与配件是否存在、非美元金额有没有汇率）一次列全；保存记审计（完整后值）。
 * 查库的校验与登记内容到表列的换算，编辑登记与补登（edit.ts）共用。
 */

/**
 * 售后负责人在查看者店铺范围内的那部分：查看者只能给自己范围内的店铺登记，候选人的范围只需要（也只该）露出这部分；
 * 与查看者的范围没有交集的售后负责人不列出
 */
function ownerWithinScope(owner: OwnerOption, scope: StoreScope): OwnerOption | null {
  if (scope.all) return owner;
  const storeIds = owner.stores.all
    ? [...scope.storeIds]
    : owner.stores.storeIds.filter((id) => isStoreInScope(scope, id));
  return storeIds.length > 0 ? { ...owner, stores: { all: false, storeIds } } : null;
}

/**
 * P13 筛选行的选项：负责人筛选列出查看者店铺范围内在职的售后负责人（与新建登记的可选负责人同一批人；「待分配」随待办 23）
 */
export async function ledgerOptions(db: DbExecutor, scope: StoreScope): Promise<LedgerOptions> {
  const owners = await listAftersalesOwners(db);
  return {
    owners: owners.flatMap((owner) =>
      ownerWithinScope(owner, scope) ? [{ id: owner.id, name: owner.name }] : [],
    ),
  };
}

/**
 * 新建登记抽屉的选项：可选负责人（只露出查看者店铺范围内的部分）、责任类型的默认比例、生产厂、配件与所属生产厂
 */
export async function registrationOptions(
  db: DbExecutor,
  scope: StoreScope,
): Promise<RegistrationOptions> {
  const [allOwners, ratios, factories, parts] = await Promise.all([
    listAftersalesOwners(db),
    db.select().from(responsibilityRatio),
    listFactories(db),
    listParts(db),
  ]);
  const byResponsibility = new Map(ratios.map((row) => [row.responsibility, row]));
  const owners = allOwners.flatMap((owner) => {
    const visible = ownerWithinScope(owner, scope);
    return visible ? [visible] : [];
  });
  return {
    owners,
    defaultRatios: responsibilities.flatMap((responsibility) => {
      const row = byResponsibility.get(responsibility);
      return row
        ? [
            {
              responsibility,
              ratios: {
                product: row.productFactoryPct,
                freight: row.freightFactoryPct,
                other: row.otherFactoryPct,
              },
            },
          ]
        : [];
    }),
    factories,
    parts,
  };
}

/**
 * 来源工单（新建登记时按工单号查，带入店铺、站点、订单号、客户）：工单在别的店铺时记越权审计并拒绝（E-24），
 * 没有这张工单返回 null
 */
export function findSourceTicket(
  runtime: Runtime,
  access: Access,
  number: string,
): Promise<TicketReference | null> {
  return access.findOwned(
    (scope) => findTicketReference(runtime.db, scope, number),
    (found) => ({
      storeIds: [found.storeId],
      objectType: 'ticket',
      objectId: found.id,
      objectLabel: found.number,
    }),
  );
}

/** 要查库校验的字段 */
type LookedUpField = 'storeId' | 'sourceTicket' | 'ownerId' | 'factory' | 'partSku';

/** 查库校验的结果：错误、所选店铺、负责人姓名（审计用） */
export interface RegistrationLookups {
  readonly errors: FieldErrors;
  readonly store: StoreOption | undefined;
  readonly ownerName: string | null;
}

/**
 * 要查库的错误（S14：与表单本身的错误一次列全）：店铺在不在范围内、来源工单（有没有、店铺一致不一致）、负责人是否
 * 合格（有该店铺数据范围的售后负责人，D-24）、生产厂与配件是否存在。input 已规范化；ticket 是按来源工单号查到的工单
 * （没查或没有为 null）。changed 判断某个字段是否这次改了：编辑时没改的负责人、来源工单、生产厂、配件不再校验
 * （例如负责人后来失去了店铺范围，不妨碍改别的字段）；新建时都算改了。
 */
export async function registrationLookups(
  db: DbExecutor,
  access: Access,
  input: RegistrationInput,
  ticket: TicketReference | null,
  changed: (field: LookedUpField) => boolean = () => true,
): Promise<RegistrationLookups> {
  const m = registrationMessages;
  const errors: FieldErrors = {};
  const [stores, owners, factories, parts] = await Promise.all([
    listStoreOptions(db, access.stores),
    listAftersalesOwners(db),
    listFactories(db),
    listParts(db),
  ]);
  const store = stores.find((s) => s.id === input.storeId);
  if (input.storeId && !store) errors.storeId = m.storeMissing;
  const ticketChecked = input.sourceTicket && (changed('sourceTicket') || changed('storeId'));
  if (ticketChecked && !ticket) {
    errors.sourceTicket = m.sourceTicketNotFound;
  } else if (ticketChecked && ticket && store && ticket.storeId !== store.id) {
    const ticketStore = stores.find((s) => s.id === ticket.storeId);
    errors.sourceTicket = m.sourceTicketStore(ticketStore?.name ?? '');
  }
  if (
    input.ownerId &&
    store &&
    (changed('ownerId') || changed('storeId')) &&
    !ownersForStore(owners, store.id).some((o) => o.id === input.ownerId)
  ) {
    errors.ownerId = m.ownerNotEligible;
  }
  if (input.factory && changed('factory') && !factories.some((f) => f.code === input.factory)) {
    errors.factory = m.factoryMissing;
  }
  if (input.partSku && changed('partSku') && !parts.some((p) => p.sku === input.partSku)) {
    errors.partSku = m.partMissing;
  }
  const ownerName = owners.find((o) => o.id === input.ownerId)?.name ?? null;
  return { errors, store, ownerName };
}

/** 来源工单在表上的三列：工单 ID、编号快照、客户（工单的客户） */
export interface SourceTicketColumns {
  readonly sourceTicketId: string | null;
  readonly sourceTicketNumber: string | null;
  readonly customerId: string | null;
}

export function sourceTicketColumns(ticket: TicketReference | null): SourceTicketColumns {
  return {
    sourceTicketId: ticket?.id ?? null,
    sourceTicketNumber: ticket?.number ?? null,
    customerId: ticket?.customerId ?? null,
  };
}

/**
 * 登记内容换成售后单表的列（新建与编辑共用；编号、状态、创建路径、登记人与时间由调用方给）。input 已规范化、校验过；
 * ratios 是三组工厂比例（没登记为 null），fees 是折算好的四个费用项。
 */
export function registrationColumns(
  input: RegistrationInput,
  ratios: FactoryRatios | null,
  fees: Readonly<Record<FeeItem, FeeValue>>,
  ticket: SourceTicketColumns,
) {
  if (!input.storeId) throw new Error('登记缺店铺');
  return {
    storeId: input.storeId,
    site: input.site,
    ...ticket,
    orderNumber: input.orderNumber || null,
    customerName: input.customerName || null,
    ownerId: input.ownerId,
    feeDate: input.feeDate,
    method: input.method,
    responsibility: input.responsibility,
    responsibilityReason: input.responsibilityReason || null,
    factoryCode: input.factory,
    partSku: input.partSku,
    partQuantity: input.partQuantity,
    shipper: input.shipper,
    carrier: input.carrier || null,
    shipDate: input.shipDate,
    trackingNumber: input.trackingNumber || null,
    claimTarget: input.claimTarget,
    claimStatus: input.claimStatus,
    ...feeColumnValues(fees),
    productFactoryPct: ratios?.product ?? null,
    freightFactoryPct: ratios?.freight ?? null,
    otherFactoryPct: ratios?.other ?? null,
  };
}

/** 新建登记的状态：问迁移表（ADR 0008） */
const REGISTERED_STATUS = (() => {
  const result = ledgerTransition(null, 'register');
  if ('error' in result) throw new Error('迁移表里没有「新建登记」');
  return result.to;
})();

/** 新建的售后单与它的店铺名 */
export interface Registered {
  readonly row: AftersalesRow;
  readonly storeName: string;
}

/**
 * 新建登记。填错时抛 FieldValidationError（全部字段的错误一次列全），不写任何数据；
 * 选了范围外的店铺、或来源工单在范围外，记越权审计并抛 AccessDeniedError（403，E-24）。
 */
export async function createRegistration(
  runtime: Runtime,
  access: Access,
  raw: RegistrationInput,
): Promise<Registered> {
  const input = normalizeRegistration(raw);
  const errors: FieldErrors = registrationErrors(input);

  // 越权在写事务之外判断：越权审计单独提交，不随业务事务回滚
  if (input.storeId) {
    await access.requireStores({
      storeIds: [input.storeId],
      objectType: 'store',
      objectId: input.storeId,
    });
  }
  const ticket = input.sourceTicket
    ? await findSourceTicket(runtime, access, input.sourceTicket)
    : null;

  return transaction(runtime, async (tx) => {
    const lookups = await registrationLookups(tx.db, access, input, ticket);
    Object.assign(errors, lookups.errors);

    // 按费用发生日取汇率（R-FL-06）；没有汇率的金额与其他错误一起列出
    const converted = input.feeDate ? await convertFees(tx.db, input.fees, input.feeDate) : null;
    for (const [field, message] of Object.entries(converted?.errors ?? {})) {
      errors[field] ??= message;
    }

    const ratios = resolveRatios(input.ratios).ratios;
    const { store } = lookups;
    if (Object.keys(errors).length > 0 || !store || !ratios || !converted) {
      throw new FieldValidationError(errors);
    }

    const registrar = access.actor.kind === 'member' ? access.actor : null;

    const [row] = await tx.db
      .insert(aftersales)
      .values({
        number: await nextBusinessNumber(tx, 'aftersales', tx.now),
        status: REGISTERED_STATUS,
        origin: 'manual_registration',
        ...registrationColumns(input, ratios, converted.values, sourceTicketColumns(ticket)),
        registeredById: registrar?.memberId ?? null,
        registeredByName: registrar?.name ?? null,
        createdAt: tx.now,
        updatedAt: tx.now,
        updatedByName: actorName(access),
      })
      .returning();
    if (!row) throw new Error('售后单创建失败');
    await recordAudit(tx, access.actor, {
      action: 'aftersales.create',
      objectType: 'aftersales',
      objectId: row.id,
      objectLabel: row.number,
      storeId: row.storeId,
      after: auditSnapshot(row, lookups.ownerName),
    });
    return { row, storeName: store.name };
  });
}
