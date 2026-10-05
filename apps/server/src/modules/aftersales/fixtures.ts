import {
  aftersalesOriginLabels,
  aftersalesStatusLabels,
  claimStatusLabels,
  claimTargetLabels,
  feeItems,
  handlingMethodLabels,
  normalizeRate,
  responsibilityLabels,
  shipperLabels,
} from '@forcome/contracts';
import type { DemoFixture, FixtureFee, FixtureLedgerRow } from '@forcome/fixtures';
import { isNotNull, isNull, or, and } from 'drizzle-orm';
import { businessNumberSequence, defineFixtureStep, reserveBusinessNumbers } from '../core';
import { convertedFee, feeColumnValues, NO_FEE, usdFee, type FeeValue } from './fees';
import { aftersales } from './schema';

/** 示例数据里的中文取值换成枚举（夹具保留原型与 PRD 的写法，加载步骤自己映射） */
function byLabel<K extends string>(labels: Record<K, string>, label: string, what: string): K {
  const found = (Object.keys(labels) as K[]).find((key) => labels[key] === label);
  if (!found) throw new Error(`示例数据的${what}「${label}」不认识`);
  return found;
}

/**
 * 夹具的一个费用项：美元不折算；非美元按夹具的演示汇率（与 Fake 汇率相同，来源记欧洲央行）与汇率日期冻结美元值，
 * 并核对与夹具里原型算好的美元值一致（规格「什么是好测试」：$49.39 等按原型数据验收的数字要能复现）
 */
function feeValue(
  fee: FixtureFee | null,
  quotes: DemoFixture['exchangeRates']['quotes'],
  where: string,
): FeeValue {
  if (!fee) return NO_FEE;
  if (fee.currency === 'USD') return usdFee(fee.amount);
  if (!fee.rateDate) throw new Error(`示例台账${where}是 ${fee.currency}，缺汇率日期`);
  const value = convertedFee(fee.amount, fee.currency, {
    rate: normalizeRate(quotes[fee.currency]),
    date: fee.rateDate,
    source: 'ecb',
  });
  if (value.usd !== fee.usd) {
    throw new Error(`示例台账${where}按演示汇率折算为 ${value.usd}，夹具写的是 ${fee.usd}`);
  }
  return value;
}

/**
 * 示例台账（原型 data.py 的 p1_ledger_rows()，待办 19；规格「什么是好测试」的夹具转换规则：丢弃待确认的单）：
 * 12 张售后单沿用原型的单号，已存在的跳过；之后新登记的单号接在原型用过的最大序号之后（含丢弃的待确认单，全局序号不重号）。
 * 店铺、负责人、登记人按示例数据的 key 换成 id；来源工单只留编号（示例工单在开发测试环境由来信回放重新编号，
 * 对不上 ID）。金额按原币写入，非美元的按演示汇率与夹具的汇率日期冻结美元值（待办 20）。
 * 已存在的单若有金额缺美元值（加汇率列之前灌入的示例单，迁移 0014 只补得了美元金额），按夹具补齐汇率与美元值，
 * 别的列不动。只在非生产环境运行。
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
    const missingUsd = or(
      ...feeItems.map((item) => and(isNotNull(aftersales[item]), isNull(aftersales[`${item}Usd`]))),
    );
    for (const [index, r] of fixture.ledger.entries()) {
      const at = new Date(tx.now.getTime() + index);
      const registrar = idOf(member, r.registeredByKey, '成员');
      const fees = feeColumnValues({
        productCost: feeValue(r.fees.product, fixture.exchangeRates.quotes, `${r.no} 的产品成本`),
        freight: feeValue(r.fees.freight, fixture.exchangeRates.quotes, `${r.no} 的运费`),
        compensation: feeValue(
          r.fees.compensation,
          fixture.exchangeRates.quotes,
          `${r.no} 的额外赔偿`,
        ),
        otherCost: feeValue(r.fees.other, fixture.exchangeRates.quotes, `${r.no} 的其他`),
      });
      await tx.db
        .insert(aftersales)
        .values({
          ...ledgerColumns(r),
          ...fees,
          storeId: idOf(storeId, r.storeKey, '店铺'),
          ownerId: idOf(member, r.ownerKey, '成员').id,
          registeredById: registrar.id,
          registeredByName: registrar.name,
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoUpdate({ target: aftersales.number, set: fees, setWhere: missingUsd });
    }
    const last = Math.max(
      fixture.aftersalesLastSequence,
      ...fixture.ledger.map((r) => businessNumberSequence(r.no)),
    );
    await reserveBusinessNumbers(tx, 'aftersales', last);
  },
});

function ledgerColumns(r: FixtureLedgerRow) {
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
    productFactoryPct: r.ratios.product.factory,
    freightFactoryPct: r.ratios.freight.factory,
    otherFactoryPct: r.ratios.other.factory,
  };
}
