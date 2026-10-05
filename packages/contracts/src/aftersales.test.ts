import { describe, expect, it } from 'vitest';
import {
  applicableFields,
  defaultOwnerId,
  emptyRegistrationInput,
  normalizeRegistration,
  ownerNote,
  ownersForStore,
  registrationErrors,
  registrationMessages,
  resolveRatios,
  type OwnerOption,
  type RegistrationInput,
} from './aftersales';

const STORE_A = '0199a000-0000-7000-8000-00000000000a';
const STORE_B = '0199a000-0000-7000-8000-00000000000b';
const WANG = '0199a000-0000-7000-8000-000000000001';
const ZHAO = '0199a000-0000-7000-8000-000000000002';
const SUN = '0199a000-0000-7000-8000-000000000003';

/** 一张填齐了必填项的寄配件登记（S14 的示例：forcome.com · Olivia Turner · 产品质量问题） */
function sendParts(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  return {
    ...emptyRegistrationInput(),
    method: 'send_parts',
    storeId: STORE_A,
    site: 'US',
    orderNumber: '#1063',
    customerName: 'Olivia Turner',
    feeDate: '2026-09-11',
    ownerId: WANG,
    responsibility: 'product_quality',
    factory: 'FQD',
    ratios: {
      product: { fsh: 0, factory: 100 },
      freight: { fsh: 0, factory: 100 },
      other: { fsh: 0, factory: 100 },
    },
    ...overrides,
  };
}

describe('承担比例（R-AS-02、AC-AS-11 的校验部分、S14）：0–100 的整数，FSH 与工厂两侧互补', () => {
  it('填了工厂一侧：另一侧自动补足 100（填 50 时 FSH 为 50）', () => {
    const resolved = resolveRatios({
      product: { fsh: null, factory: 50 },
      freight: { fsh: null, factory: 0 },
      other: { fsh: null, factory: 100 },
    });
    expect(resolved).toEqual({
      ratios: { product: 50, freight: 0, other: 100 },
      errors: {},
    });
  });

  it('填了 FSH 一侧：工厂为 100 减去它', () => {
    expect(
      resolveRatios({
        product: { fsh: 30, factory: null },
        freight: { fsh: 100, factory: 0 },
        other: { fsh: 0, factory: 100 },
      }).ratios,
    ).toEqual({ product: 70, freight: 0, other: 100 });
  });

  it('比例填 130：报错「比例为 0–100 的整数」写在填错的那一侧，三组的结果不可用', () => {
    const resolved = resolveRatios({
      product: { fsh: null, factory: 130 },
      freight: { fsh: 50, factory: 50 },
      other: { fsh: 50, factory: 50 },
    });
    expect(resolved.ratios).toBeNull();
    expect(resolved.errors).toEqual({ 'ratios.product.factory': '比例为 0–100 的整数' });
  });

  it('小数、负数、FSH 一侧超出范围都报错', () => {
    const resolved = resolveRatios({
      product: { fsh: null, factory: 12.5 },
      freight: { fsh: null, factory: -1 },
      other: { fsh: 101, factory: null },
    });
    expect(resolved.errors).toEqual({
      'ratios.product.factory': '比例为 0–100 的整数',
      'ratios.freight.factory': '比例为 0–100 的整数',
      'ratios.other.fsh': '比例为 0–100 的整数',
    });
  });

  it('两侧都没填：报在工厂一侧；两侧都填了但加起来不是 100：报在 FSH 一侧', () => {
    const resolved = resolveRatios({
      product: { fsh: null, factory: null },
      freight: { fsh: 40, factory: 50 },
      other: { fsh: 50, factory: 50 },
    });
    expect(resolved.errors).toEqual({
      'ratios.product.factory': '比例为 0–100 的整数',
      'ratios.freight.fsh': registrationMessages.ratioSum,
    });
  });
});

describe('R-AS-08 适用字段：按处理方式、责任类型与工厂比例列出，不适用的不显示', () => {
  const noFactory = { product: 0, freight: 0, other: 0 };
  const withFactory = { product: 0, freight: 0, other: 50 };

  it('寄件一节（配件 × 数量、发货方、承运方式、寄出日期、快递单号）只对寄配件适用', () => {
    const shipping = ['part', 'shipper', 'carrier', 'shipDate', 'trackingNumber'];
    for (const method of ['adjust_installation', 'refund_or_compensation'] as const) {
      const fields = applicableFields({
        method,
        responsibility: 'customer_use',
        factoryRatios: noFactory,
      });
      for (const field of shipping) expect(fields).not.toContain(field);
    }
    const fields = applicableFields({
      method: 'send_parts',
      responsibility: 'customer_use',
      factoryRatios: noFactory,
    });
    for (const field of shipping) expect(fields).toContain(field);
  });

  it('店铺、站点、订单号、客户、处理方式、责任类型、负责人、费用发生日、四项费用、承担比例对三种处理方式都适用', () => {
    for (const method of ['adjust_installation', 'send_parts', 'refund_or_compensation'] as const) {
      expect(
        applicableFields({ method, responsibility: 'customer_use', factoryRatios: noFactory }),
      ).toEqual(
        expect.arrayContaining([
          'method',
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
        ]),
      );
    }
  });

  it('责任理由只在责任为「其他」时适用，索赔对象与状态只在物流问题时适用', () => {
    const of = (responsibility: 'other' | 'logistics' | 'product_quality') =>
      applicableFields({ method: 'send_parts', responsibility, factoryRatios: noFactory });
    expect(of('other')).toContain('responsibilityReason');
    expect(of('logistics')).not.toContain('responsibilityReason');
    expect(of('logistics')).toEqual(expect.arrayContaining(['claimTarget', 'claimStatus']));
    expect(of('other')).not.toContain('claimTarget');
    expect(of('product_quality')).not.toContain('claimStatus');
  });

  it('生产厂只在任一组工厂比例大于 0 时适用', () => {
    const of = (factoryRatios: typeof noFactory) =>
      applicableFields({ method: 'adjust_installation', responsibility: 'other', factoryRatios });
    expect(of(noFactory)).not.toContain('factory');
    expect(of(withFactory)).toContain('factory');
  });
});

describe('新建登记的校验（S14：保存时校验全部，错误写在字段下方）', () => {
  it('填齐必填项的寄配件登记没有错误；寄件一节与金额可以先空着（进行中可后填）', () => {
    expect(registrationErrors(sendParts())).toEqual({});
  });

  it('什么都没填：必填项一次列全', () => {
    expect(registrationErrors(emptyRegistrationInput())).toEqual({
      method: '请选择处理方式',
      storeId: '请选择店铺',
      site: '请选择站点',
      orderNumber: '请填写订单号',
      customerName: '请填写客户',
      feeDate: '请选择费用发生日',
      ownerId: '请选择负责人',
      responsibility: '请选择责任类型',
    });
  });

  it('只填空白的订单号、客户算没填', () => {
    const errors = registrationErrors(sendParts({ orderNumber: '  ', customerName: ' ' }));
    expect(errors).toEqual({ orderNumber: '请填写订单号', customerName: '请填写客户' });
  });

  it('AC-P1-17：「退款或部分补偿」的额外赔偿为 0 或没填 → 报错（款项记在额外赔偿，须大于 0）', () => {
    const refund = (amount: string | null) =>
      sendParts({
        method: 'refund_or_compensation',
        fees: { ...emptyRegistrationInput().fees, compensation: { amount, currency: 'MXN' } },
      });
    const message = '部分补偿、免退货退款的款项记在额外赔偿，须大于 0';
    expect(registrationErrors(refund('0'))).toEqual({ 'fees.compensation': message });
    expect(registrationErrors(refund('0.00'))).toEqual({ 'fees.compensation': message });
    expect(registrationErrors(refund(null))).toEqual({ 'fees.compensation': message });
    expect(registrationErrors(refund('889.00'))).toEqual({});
    expect(registrationErrors(refund('0.01'))).toEqual({});
  });

  it('其他处理方式的额外赔偿可以是 0', () => {
    const fees = {
      ...emptyRegistrationInput().fees,
      compensation: { amount: '0', currency: 'USD' as const },
    };
    expect(registrationErrors(sendParts({ fees }))).toEqual({});
  });

  it('责任为「其他」时理由必填（S14）', () => {
    const other = sendParts({
      responsibility: 'other',
      ratios: {
        product: { fsh: 50, factory: 50 },
        freight: { fsh: 50, factory: 50 },
        other: { fsh: 50, factory: 50 },
      },
    });
    expect(registrationErrors({ ...other, responsibilityReason: '  ' })).toEqual({
      responsibilityReason: '责任为「其他」时须填写理由',
    });
    expect(registrationErrors({ ...other, responsibilityReason: '双方分摊' })).toEqual({});
  });

  it('任一组工厂比例大于 0 时生产厂必填；工厂比例都为 0 时不要求', () => {
    expect(registrationErrors(sendParts({ factory: null }))).toEqual({ factory: '请选择生产厂' });
    const fshOnly = sendParts({
      responsibility: 'customer_use',
      factory: null,
      ratios: {
        product: { fsh: 100, factory: 0 },
        freight: { fsh: 100, factory: 0 },
        other: { fsh: 100, factory: 0 },
      },
    });
    expect(registrationErrors(fshOnly)).toEqual({});
  });

  it('金额：不能为负数，最多两位小数；数量为 1–10 的整数', () => {
    const fees = {
      ...emptyRegistrationInput().fees,
      productCost: { amount: '-1', currency: 'USD' as const },
      freight: { amount: '6.805', currency: 'USD' as const },
      otherCost: { amount: 'abc', currency: 'USD' as const },
    };
    expect(
      registrationErrors(sendParts({ fees, partSku: 'FC-V2-HF01', partQuantity: 11 })),
    ).toEqual({
      'fees.productCost': '金额不能为负数，最多两位小数',
      'fees.freight': '金额不能为负数，最多两位小数',
      'fees.otherCost': '金额不能为负数，最多两位小数',
      partQuantity: '数量为 1–10 的整数',
    });
    expect(registrationErrors(sendParts({ partSku: 'FC-V2-HF01', partQuantity: 0 }))).toEqual({
      partQuantity: '数量为 1–10 的整数',
    });
    // 「配件 × 数量」是一项：没选配件时数量不保存
    expect(
      normalizeRegistration(sendParts({ partSku: null, partQuantity: 1 })).partQuantity,
    ).toBeNull();
  });

  it('比例错误与其他错误一起列出', () => {
    const errors = registrationErrors(
      sendParts({
        method: 'refund_or_compensation',
        responsibility: 'other',
        ratios: {
          product: { fsh: null, factory: 130 },
          freight: { fsh: 50, factory: 50 },
          other: { fsh: 50, factory: 50 },
        },
      }),
    );
    // S14 的校验示例：有 3 项需要修改
    expect(errors).toEqual({
      responsibilityReason: '责任为「其他」时须填写理由',
      'ratios.product.factory': '比例为 0–100 的整数',
      'fees.compensation': '部分补偿、免退货退款的款项记在额外赔偿，须大于 0',
    });
  });

  it('不适用的字段在保存前清空：调整安装方式不留寄件字段，非「其他」不留理由，非物流问题不留索赔，工厂比例都为 0 不留生产厂', () => {
    const normalized = normalizeRegistration(
      sendParts({
        method: 'adjust_installation',
        responsibility: 'customer_use',
        responsibilityReason: '不该留下',
        claimTarget: 'carrier',
        claimStatus: 'not_started',
        partSku: 'FC-V2-HF01',
        partQuantity: 1,
        shipper: 'yicang',
        carrier: 'UPS Ground',
        shipDate: '2026-09-11',
        trackingNumber: '1Z',
        factory: 'FQD',
        ratios: {
          product: { fsh: 100, factory: 0 },
          freight: { fsh: 100, factory: 0 },
          other: { fsh: 100, factory: 0 },
        },
        orderNumber: ' #1063 ',
      }),
    );
    expect(normalized).toMatchObject({
      orderNumber: '#1063',
      responsibilityReason: '',
      claimTarget: null,
      claimStatus: null,
      partSku: null,
      partQuantity: null,
      shipper: null,
      carrier: '',
      shipDate: null,
      trackingNumber: '',
      factory: null,
    });
  });
});

describe('负责人（D-24、AC-P1-18）：只能选有该店铺数据范围的售后负责人', () => {
  const owners: OwnerOption[] = [
    { id: WANG, name: '王磊', stores: { all: true } },
    { id: ZHAO, name: '赵敏', stores: { all: false, storeIds: [STORE_B] } },
    { id: SUN, name: '孙杰', stores: { all: false, storeIds: [STORE_A, STORE_B] } },
  ];

  it('下拉只列有该店铺范围的售后负责人', () => {
    expect(ownersForStore(owners, STORE_A).map((o) => o.name)).toEqual(['王磊', '孙杰']);
    expect(ownersForStore(owners, STORE_B).map((o) => o.name)).toEqual(['王磊', '赵敏', '孙杰']);
    expect(ownersForStore(owners, null)).toEqual([]);
  });

  it('该店铺只有一位售后负责人时默认此人（AC-P1-18：forcome.mx 只有王磊）', () => {
    const only = owners.slice(0, 2);
    expect(defaultOwnerId(only, STORE_A, 'someone-else')).toBe(WANG);
    expect(ownerNote(only, STORE_A, 'someone-else')).toBe('only');
  });

  it('登记人是售后负责人时默认本人', () => {
    expect(defaultOwnerId(owners, STORE_A, SUN)).toBe(SUN);
    expect(ownerNote(owners, STORE_A, SUN)).toBe('self');
  });

  it('有几位可选、登记人不是其中之一：不默认，必须选', () => {
    expect(defaultOwnerId(owners, STORE_A, 'supervisor')).toBeNull();
    expect(ownerNote(owners, STORE_A, 'supervisor')).toBe('choose');
  });

  it('还没选店铺：没有默认', () => {
    expect(defaultOwnerId(owners, null, WANG)).toBeNull();
    expect(ownerNote(owners, null, WANG)).toBe('no_store');
  });
});
