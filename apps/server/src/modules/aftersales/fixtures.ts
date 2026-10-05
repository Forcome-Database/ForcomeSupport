import {
  aftersalesOriginLabels,
  aftersalesStatusLabels,
  claimStatusLabels,
  claimTargetLabels,
  handlingMethodLabels,
  responsibilityLabels,
  shipperLabels,
} from '@forcome/contracts';
import type { FixtureFee, FixtureLedgerRow } from '@forcome/fixtures';
import { defineFixtureStep, reserveBusinessNumbers } from '../core';
import { aftersales } from './schema';

/** 示例数据里的中文取值换成枚举（夹具保留原型与 PRD 的写法，加载步骤自己映射） */
function byLabel<K extends string>(labels: Record<K, string>, label: string, what: string): K {
  const found = (Object.keys(labels) as K[]).find((key) => labels[key] === label);
  if (!found) throw new Error(`示例数据的${what}「${label}」不认识`);
  return found;
}

function feeColumns(fee: FixtureFee | null) {
  return fee ? { amount: fee.amount, currency: fee.currency } : { amount: null, currency: null };
}

/** 序号部分（S-日期-序号） */
function sequenceOf(number: string): number {
  return Number(number.slice(-4));
}

/**
 * 示例台账（原型 data.py 的 p1_ledger_rows()，待办 19；规格「什么是好测试」的夹具转换规则：丢弃待确认的单）：
 * 12 张售后单沿用原型的单号，已存在的跳过；之后新登记的单号接在示例最大序号之后（全局序号不重号）。
 * 店铺、负责人、登记人按示例数据的 key 换成 id；来源工单只留编号（示例工单在开发测试环境由来信回放重新编号，
 * 对不上 ID）。金额按原币写入；汇率与美元折算随待办 20 补进这个加载步骤。只在非生产环境运行。
 */
export const aftersalesLedgerFixtureStep = defineFixtureStep({
  name: 'aftersales.ledger',
  async load(tx, fixture) {
    const storeId = new Map(fixture.stores.map((s) => [s.key, s.id]));
    const member = new Map(fixture.members.map((m) => [m.key, m]));
    const idOf = <T>(map: Map<string, T>, key: string, what: string): T => {
      const found = map.get(key);
      if (!found) throw new Error(`示例台账引用了不存在的${what}「${key}」`);
      return found;
    };
    for (const [index, r] of fixture.ledger.entries()) {
      const at = new Date(tx.now.getTime() + index);
      const registrar = idOf(member, r.registeredByKey, '成员');
      await tx.db
        .insert(aftersales)
        .values({
          ...ledgerColumns(r),
          storeId: idOf(storeId, r.storeKey, '店铺'),
          ownerId: idOf(member, r.ownerKey, '成员').id,
          registeredById: registrar.id,
          registeredByName: registrar.name,
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoNothing({ target: aftersales.number });
    }
    const last = Math.max(0, ...fixture.ledger.map((r) => sequenceOf(r.no)));
    await reserveBusinessNumbers(tx, 'aftersales', last);
  },
});

function ledgerColumns(r: FixtureLedgerRow) {
  const product = feeColumns(r.fees.product);
  const freight = feeColumns(r.fees.freight);
  const compensation = feeColumns(r.fees.compensation);
  const other = feeColumns(r.fees.other);
  return {
    number: r.no,
    status: byLabel(aftersalesStatusLabels, r.status, '状态'),
    origin: byLabel(aftersalesOriginLabels, r.createdVia, '创建路径'),
    site: r.site,
    sourceTicketNumber: r.ticket,
    orderNumber: r.order,
    customerName: r.customer,
    feeDate: r.feeDate,
    completedAt: r.completedAt ? new Date(r.completedAt) : null,
    method: byLabel(handlingMethodLabels, r.method, '处理方式'),
    responsibility: byLabel(responsibilityLabels, r.responsibility, '责任类型'),
    responsibilityReason: r.responsibilityReason,
    factoryCode: r.factory,
    partSku: r.part?.sku ?? null,
    partQuantity: r.part?.qty ?? null,
    shipper: r.shipper ? byLabel(shipperLabels, r.shipper, '发货方') : null,
    carrier: r.carrier,
    shipDate: r.shipDate,
    trackingNumber: r.tracking,
    claimTarget: r.claim ? byLabel(claimTargetLabels, r.claim.target, '索赔对象') : null,
    claimStatus: r.claim ? byLabel(claimStatusLabels, r.claim.state, '索赔状态') : null,
    productCost: product.amount,
    productCostCurrency: product.currency,
    freight: freight.amount,
    freightCurrency: freight.currency,
    compensation: compensation.amount,
    compensationCurrency: compensation.currency,
    otherCost: other.amount,
    otherCostCurrency: other.currency,
    productFactoryPct: r.ratios.product.factory,
    freightFactoryPct: r.ratios.freight.factory,
    otherFactoryPct: r.ratios.other.factory,
  };
}
