import { describe, expect, it } from 'vitest';
import {
  missingFields,
  missingItemLabels,
  type HandlingMethod,
  type RegistrationField,
  type RegistrationRecord,
} from './aftersales';

/*
 * R-AS-08 必填矩阵与「适用字段是否齐全」（待办 21）：输入一张售后单，输出缺失的适用字段（按抽屉顺序）。
 * 费用项填 0 视为已填；「退款或部分补偿」的额外赔偿须大于 0；不适用的字段空着不算缺。
 */

const STORE = '0199a000-0000-7000-8000-00000000000a';
const WANG = '0199a000-0000-7000-8000-000000000001';

/** 一张登记齐全的单（客户使用问题：三组工厂比例都为 0，生产厂不适用） */
function complete(method: HandlingMethod, overrides: Partial<RegistrationRecord> = {}) {
  const shipping =
    method === 'send_parts'
      ? {
          part: { sku: 'FC-V2-HF01', quantity: 1 },
          shipper: 'yicang' as const,
          carrier: 'UPS Ground',
          shipDate: '2026-09-09',
          trackingNumber: '1Z4R28830358229088',
        }
      : { part: null, shipper: null, carrier: null, shipDate: null, trackingNumber: null };
  return {
    method,
    storeId: STORE,
    site: 'US',
    orderNumber: '#1052',
    customerName: 'David Park',
    feeDate: '2026-09-09',
    ownerId: WANG,
    responsibility: 'customer_use',
    responsibilityReason: null,
    factory: null,
    claimTarget: null,
    claimStatus: null,
    ...shipping,
    factoryRatios: { product: 0, freight: 0, other: 0 },
    fees: {
      productCost: '2.60',
      freight: '6.80',
      compensation: method === 'refund_or_compensation' ? '12.00' : '0.00',
      otherCost: '0.00',
    },
    ...overrides,
  } satisfies RegistrationRecord;
}

const METHODS: readonly HandlingMethod[] = [
  'adjust_installation',
  'send_parts',
  'refund_or_compensation',
];

/** 把一个字段清空 */
function without(record: RegistrationRecord, field: RegistrationField): RegistrationRecord {
  if (field === 'ratios') return { ...record, factoryRatios: null };
  if (field === 'part') return { ...record, part: null };
  if (field.startsWith('fees.')) {
    const item = field.slice('fees.'.length) as keyof RegistrationRecord['fees'];
    return { ...record, fees: { ...record.fees, [item]: null } };
  }
  return { ...record, [field]: null };
}

describe('R-AS-08 必填矩阵：缺失的适用字段（待办 21）', () => {
  it('登记齐全的单三种处理方式都不缺字段', () => {
    for (const method of METHODS) expect(missingFields(complete(method))).toEqual([]);
  });

  it('店铺、站点、订单号、客户、处理方式、责任类型、负责人、费用发生日、四项费用、承担比例：三种处理方式都适用，空着就缺', () => {
    const always: RegistrationField[] = [
      'storeId',
      'site',
      'orderNumber',
      'customerName',
      'feeDate',
      'ownerId',
      'responsibility',
      'ratios',
      'fees.productCost',
      'fees.freight',
      'fees.compensation',
      'fees.otherCost',
    ];
    for (const method of METHODS) {
      for (const field of always) {
        expect(missingFields(without(complete(method), field)), `${method} · ${field}`).toEqual([
          field,
        ]);
      }
    }
  });

  it('处理方式没填：缺处理方式（寄件一节没法判断，按不适用）', () => {
    const record = complete('adjust_installation', { method: null });
    expect(missingFields(record)).toEqual(['method']);
  });

  it('订单号、客户只有空白也算缺', () => {
    expect(missingFields(complete('send_parts', { orderNumber: '  ', customerName: '' }))).toEqual([
      'orderNumber',
      'customerName',
    ]);
  });

  it('寄件一节（配件 × 数量、发货方、承运方式、寄出日期、快递单号）：只对寄配件适用', () => {
    const shipping: RegistrationField[] = [
      'part',
      'shipper',
      'carrier',
      'shipDate',
      'trackingNumber',
    ];
    for (const field of shipping) {
      expect(missingFields(without(complete('send_parts'), field)), field).toEqual([field]);
    }
    // 配件选了、数量没填，「配件 × 数量」照样缺
    expect(
      missingFields(complete('send_parts', { part: { sku: 'FC-V2-HF01', quantity: null } })),
    ).toEqual(['part']);
    // 调整安装方式、退款或部分补偿没有寄件：空着不算缺（AC-P1-06：调整安装方式没有快递单号不算缺失）
    for (const method of ['adjust_installation', 'refund_or_compensation'] as const) {
      expect(missingFields(complete(method))).toEqual([]);
    }
  });

  it('费用项填 0 视为已填，没登记（null）才算缺', () => {
    const zero = complete('send_parts', {
      fees: { productCost: '0.00', freight: '0.00', compensation: '0.00', otherCost: '0.00' },
    });
    expect(missingFields(zero)).toEqual([]);
    const unregistered = complete('send_parts', {
      fees: { productCost: null, freight: null, compensation: '0.00', otherCost: '0.00' },
    });
    expect(missingFields(unregistered)).toEqual(['fees.productCost', 'fees.freight']);
  });

  it('退款或部分补偿的额外赔偿须大于 0：填 0 也算缺；其他处理方式的额外赔偿可以是 0', () => {
    const refundZero = complete('refund_or_compensation', {
      fees: { productCost: '0.00', freight: '0.00', compensation: '0.00', otherCost: '0.00' },
    });
    expect(missingFields(refundZero)).toEqual(['fees.compensation']);
    expect(
      missingFields(
        complete('refund_or_compensation', {
          fees: { productCost: '0.00', freight: '0.00', compensation: '0.01', otherCost: '0.00' },
        }),
      ),
    ).toEqual([]);
    for (const method of ['adjust_installation', 'send_parts'] as const) {
      expect(missingFields(complete(method))).toEqual([]);
    }
  });

  it('责任为「其他」时责任理由适用：空着就缺；其他责任类型没有理由不算缺', () => {
    for (const method of METHODS) {
      expect(missingFields(complete(method, { responsibility: 'other' }))).toEqual([
        'responsibilityReason',
      ]);
      expect(
        missingFields(
          complete(method, { responsibility: 'other', responsibilityReason: '双方分摊' }),
        ),
      ).toEqual([]);
    }
  });

  it('责任为物流问题时索赔对象与索赔状态适用：分别判断；其他责任类型不要求', () => {
    for (const method of METHODS) {
      expect(missingFields(complete(method, { responsibility: 'logistics' }))).toEqual([
        'claimTarget',
        'claimStatus',
      ]);
      expect(
        missingFields(complete(method, { responsibility: 'logistics', claimTarget: 'carrier' })),
      ).toEqual(['claimStatus']);
      expect(
        missingFields(
          complete(method, {
            responsibility: 'logistics',
            claimTarget: 'yicang',
            claimStatus: 'not_started',
          }),
        ),
      ).toEqual([]);
    }
  });

  it('任一组工厂比例大于 0 时生产厂适用：空着就缺；三组都为 0 时不要求', () => {
    for (const method of METHODS) {
      const withFactoryShare = complete(method, {
        responsibility: 'product_quality',
        factoryRatios: { product: 100, freight: 0, other: 0 },
      });
      expect(missingFields(withFactoryShare)).toEqual(['factory']);
      expect(missingFields({ ...withFactoryShare, factory: 'FQD' })).toEqual([]);
    }
    // 承担比例没登记（历史导入）：比例缺，生产厂没法判断，不算缺
    expect(missingFields(without(complete('send_parts'), 'ratios'))).toEqual(['ratios']);
  });

  it('缺的字段按抽屉的顺序列出', () => {
    const record = complete('send_parts', {
      responsibility: 'logistics',
      site: null,
      shipDate: null,
      trackingNumber: null,
      fees: { productCost: null, freight: '6.80', compensation: '0.00', otherCost: '0.00' },
    });
    expect(missingFields(record)).toEqual([
      'site',
      'claimTarget',
      'claimStatus',
      'shipDate',
      'trackingNumber',
      'fees.productCost',
    ]);
  });
});

describe('「缺 N 项」的计数与悬停里的字段名（原型 data.ledger_missing）', () => {
  it('字段名同抽屉；「配件 × 数量」算一项，「索赔对象与状态」两项合算一项', () => {
    expect(missingItemLabels(['shipDate', 'trackingNumber'])).toEqual(['寄出日期', '快递单号']);
    expect(missingItemLabels(['claimTarget', 'claimStatus', 'part', 'fees.otherCost'])).toEqual([
      '索赔对象与状态',
      '配件 × 数量',
      '其他',
    ]);
    expect(missingItemLabels(['claimStatus'])).toEqual(['索赔对象与状态']);
  });
});
