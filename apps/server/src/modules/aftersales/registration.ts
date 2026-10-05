import {
  normalizeRegistration,
  ownersForStore,
  registrationErrors,
  registrationMessages,
  resolveRatios,
  responsibilities,
  type FieldErrors,
  type OwnerOption,
  type RegistrationInput,
  type RegistrationOptions,
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
import { feeColumnValues, feesOf } from './fees';
import { ratiosOf, type AftersalesRow } from './ledger';
import { aftersales, responsibilityRatio } from './schema';

/*
 * 新建登记（P13「第一阶段」、S14、R-AS-08；6.5「第一阶段台账状态」、D-24）：客服主管与售后负责人手工登记一张售后单，
 * 状态「进行中」、创建路径「手工登记」，金额先以原币保存（汇率随待办 20）。表单本身的错误（contracts 的
 * registrationErrors）与要查库的错误（店铺、来源工单、负责人是否合格、生产厂与配件是否存在）一次列全；
 * 保存记审计（完整后值）。
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

/** 新建的售后单与它的店铺名 */
export interface Registered {
  readonly row: AftersalesRow;
  readonly storeName: string;
}

/** 审计里的完整后值：抽屉能填的全部字段与系统定下的编号、状态、创建路径、登记人 */
function snapshot(row: AftersalesRow, ownerName: string | null) {
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
  const m = registrationMessages;

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
    const [stores, owners, factories, parts] = await Promise.all([
      listStoreOptions(tx.db, access.stores),
      listAftersalesOwners(tx.db),
      listFactories(tx.db),
      listParts(tx.db),
    ]);
    const store = stores.find((s) => s.id === input.storeId);
    if (input.storeId && !store) errors.storeId = m.storeMissing;
    if (input.sourceTicket && !ticket) {
      errors.sourceTicket = m.sourceTicketNotFound;
    } else if (ticket && store && ticket.storeId !== store.id) {
      const ticketStore = stores.find((s) => s.id === ticket.storeId);
      errors.sourceTicket = m.sourceTicketStore(ticketStore?.name ?? '');
    }
    const owner = owners.find((o) => o.id === input.ownerId);
    if (
      input.ownerId &&
      store &&
      !ownersForStore(owners, store.id).some((o) => o.id === input.ownerId)
    ) {
      errors.ownerId = m.ownerNotEligible;
    }
    if (input.factory && !factories.some((f) => f.code === input.factory)) {
      errors.factory = m.factoryMissing;
    }
    if (input.partSku && !parts.some((p) => p.sku === input.partSku)) {
      errors.partSku = m.partMissing;
    }

    const ratios = resolveRatios(input.ratios).ratios;
    if (Object.keys(errors).length > 0 || !store || !ratios) {
      throw new FieldValidationError(errors);
    }

    const registrar = access.actor.kind === 'member' ? access.actor : null;

    const [row] = await tx.db
      .insert(aftersales)
      .values({
        number: await nextBusinessNumber(tx, 'aftersales', tx.now),
        status: 'in_progress',
        origin: 'manual_registration',
        storeId: store.id,
        site: input.site,
        sourceTicketId: ticket?.id ?? null,
        sourceTicketNumber: ticket?.number ?? null,
        orderNumber: input.orderNumber,
        customerId: ticket?.customerId ?? null,
        customerName: input.customerName,
        registeredById: registrar?.memberId ?? null,
        registeredByName: registrar?.name ?? null,
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
        ...feeColumnValues(input.fees),
        productFactoryPct: ratios.product,
        freightFactoryPct: ratios.freight,
        otherFactoryPct: ratios.other,
        createdAt: tx.now,
        updatedAt: tx.now,
      })
      .returning();
    if (!row) throw new Error('售后单创建失败');
    await recordAudit(tx, access.actor, {
      action: 'aftersales.create',
      objectType: 'aftersales',
      objectId: row.id,
      objectLabel: row.number,
      storeId: row.storeId,
      after: snapshot(row, owner?.name ?? null),
    });
    return { row, storeName: store.name };
  });
}
