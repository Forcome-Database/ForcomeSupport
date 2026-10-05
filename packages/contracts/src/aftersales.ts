import { z } from 'zod';
import { storeScopeSchema } from './auth';
import { siteSchema, type FieldErrors } from './channel';
import { financeField } from './finance';
import { currencySchema } from './money';

/*
 * 售后单与登记台账（PRD 11.1 AfterSales、6.5「第一阶段台账状态」、R-AS-01、R-AS-02、R-AS-08、P13「第一阶段」、S14）。
 * 第一期只有「手工登记」「历史导入」两条创建路径与 进行中 / 已完成 / 已取消 三种状态；第二期的流程字段随第二期补。
 * 这里放前后端共用的取值与叫法、R-AS-08 的适用字段、新建登记的输入与校验、承担比例与负责人的规则，以及 P13 的输出结构。
 */

/** 第一阶段台账状态（6.5）：进行中 · 已完成 · 已取消；已完成、已取消为终态，第二期原样保留 */
export const aftersalesStatuses = ['in_progress', 'completed', 'cancelled'] as const;
export const aftersalesStatusSchema = z.enum(aftersalesStatuses);
export type AftersalesStatus = z.infer<typeof aftersalesStatusSchema>;
export const aftersalesStatusLabels: Record<AftersalesStatus, string> = {
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

/** 创建路径（11.1）：第一期只有这两种，第二期补系统自动、转售后确认、手工新建、路径 B */
export const aftersalesOrigins = ['manual_registration', 'history_import'] as const;
export const aftersalesOriginSchema = z.enum(aftersalesOrigins);
export type AftersalesOrigin = z.infer<typeof aftersalesOriginSchema>;
export const aftersalesOriginLabels: Record<AftersalesOrigin, string> = {
  manual_registration: '手工登记',
  history_import: '历史导入',
};

/** 处理方式（R-AS-01）：寄配件含换新、整机补发；退款或部分补偿的款项记在额外赔偿（R-AS-08） */
export const handlingMethods = [
  'adjust_installation',
  'send_parts',
  'refund_or_compensation',
] as const;
export const handlingMethodSchema = z.enum(handlingMethods);
export type HandlingMethod = z.infer<typeof handlingMethodSchema>;
export const handlingMethodLabels: Record<HandlingMethod, string> = {
  adjust_installation: '调整安装方式',
  send_parts: '寄配件',
  refund_or_compensation: '退款或部分补偿',
};

/** 责任类型（R-AS-02） */
export const responsibilities = ['customer_use', 'product_quality', 'logistics', 'other'] as const;
export const responsibilitySchema = z.enum(responsibilities);
export type Responsibility = z.infer<typeof responsibilitySchema>;
export const responsibilityLabels: Record<Responsibility, string> = {
  customer_use: '客户使用问题',
  product_quality: '产品质量问题',
  logistics: '物流问题',
  other: '其他',
};

/** 发货方（寄配件） */
export const shippers = ['yicang', 'factory'] as const;
export const shipperSchema = z.enum(shippers);
export type Shipper = z.infer<typeof shipperSchema>;
export const shipperLabels: Record<Shipper, string> = { yicang: '易仓', factory: '生产厂' };

/** 索赔对象与索赔状态（责任为物流问题时，R-AS-08） */
export const claimTargets = ['carrier', 'yicang'] as const;
export const claimTargetSchema = z.enum(claimTargets);
export type ClaimTarget = z.infer<typeof claimTargetSchema>;
export const claimTargetLabels: Record<ClaimTarget, string> = { carrier: '承运商', yicang: '易仓' };

export const claimStatuses = ['not_started', 'in_progress', 'compensated', 'rejected'] as const;
export const claimStatusSchema = z.enum(claimStatuses);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;
export const claimStatusLabels: Record<ClaimStatus, string> = {
  not_started: '待发起',
  in_progress: '索赔中',
  compensated: '已赔付',
  rejected: '已拒赔',
};

/** 承担比例的三组（R-AS-02、D-19）：产品成本 / 快递物流 / 其他费用（额外赔偿 + 其他） */
export const ratioGroups = ['product', 'freight', 'other'] as const;
export type RatioGroup = (typeof ratioGroups)[number];
export const ratioGroupLabels: Record<RatioGroup, string> = {
  product: '产品成本',
  freight: '快递物流',
  other: '其他费用',
};

/** 费用项（R-AS-08，原币登记）与它所属的比例组 */
export const feeItems = ['productCost', 'freight', 'compensation', 'otherCost'] as const;
export type FeeItem = (typeof feeItems)[number];
export const feeItemLabels: Record<FeeItem, string> = {
  productCost: '产品成本',
  freight: '运费',
  compensation: '额外赔偿',
  otherCost: '其他',
};
export const feeItemGroup: Record<FeeItem, RatioGroup> = {
  productCost: 'product',
  freight: 'freight',
  compensation: 'other',
  otherCost: 'other',
};

/** 每组的工厂承担比例（0–100 的整数）；FSH 一侧 = 100 − 工厂 */
export type FactoryRatios = Record<RatioGroup, number>;
const percentSchema = z.int().min(0).max(100);
export const factoryRatiosSchema = z.object({
  product: percentSchema,
  freight: percentSchema,
  other: percentSchema,
});

/** 售后单号 S-创建日期-4 位全局序号（规格「数据约定」） */
export const aftersalesNumberSchema = z.string().regex(/^S-\d{8}-\d{4}$/);

// ---------------------------------------------------------------- R-AS-08 适用字段

/**
 * R-AS-08 必填矩阵里的字段（「配件 × 数量」算一项）。顺序即抽屉自上而下的顺序（S14），
 * 保存后定位到第一个错误、错误横幅写「第一个错误」都按它。
 */
export const registrationFields = [
  'method',
  'storeId',
  'site',
  'orderNumber',
  'customerName',
  'feeDate',
  'ownerId',
  'responsibility',
  'factory',
  'responsibilityReason',
  'claimTarget',
  'claimStatus',
  'ratios',
  'part',
  'shipper',
  'carrier',
  'shipDate',
  'trackingNumber',
  'fees.productCost',
  'fees.freight',
  'fees.compensation',
  'fees.otherCost',
] as const;
export type RegistrationField = (typeof registrationFields)[number];

/** 字段的叫法（S14 抽屉的字段名；台账「缺 N 项」的悬停说明也用它） */
export const registrationFieldLabels: Record<RegistrationField, string> = {
  method: '处理方式',
  storeId: '店铺',
  site: '站点',
  orderNumber: '订单号',
  customerName: '客户',
  feeDate: '费用发生日',
  ownerId: '负责人',
  responsibility: '责任类型',
  factory: '生产厂',
  responsibilityReason: '责任理由',
  claimTarget: '索赔对象',
  claimStatus: '索赔状态',
  ratios: '承担比例',
  part: '配件 × 数量',
  shipper: '发货方',
  carrier: '承运方式',
  shipDate: '寄出日期',
  trackingNumber: '快递单号',
  'fees.productCost': feeItemLabels.productCost,
  'fees.freight': feeItemLabels.freight,
  'fees.compensation': feeItemLabels.compensation,
  'fees.otherCost': feeItemLabels.otherCost,
};

/** 判断适用字段要看的三样：处理方式、责任类型、各组工厂比例（还没选、没填时为 null） */
export interface ApplicabilityInput {
  readonly method: HandlingMethod | null;
  readonly responsibility: Responsibility | null;
  readonly factoryRatios: Readonly<Partial<Record<RatioGroup, number | null>>> | null;
}

const SHIPPING_FIELDS = new Set<RegistrationField>([
  'part',
  'shipper',
  'carrier',
  'shipDate',
  'trackingNumber',
]);

/** 任一组工厂比例大于 0：生产厂适用（R-AS-08；6.5「生产厂」） */
export function involvesFactory(factoryRatios: ApplicabilityInput['factoryRatios']): boolean {
  return ratioGroups.some((group) => (factoryRatios?.[group] ?? 0) > 0);
}

/**
 * 按 R-AS-08 必填矩阵适用的字段（按抽屉顺序）：寄件一节只对寄配件适用；责任理由只在责任为「其他」时；
 * 索赔对象与状态只在物流问题时；生产厂只在任一组工厂比例大于 0 时。新建登记的抽屉只显示这些字段（S14），
 * 保存时不适用的字段清空（normalizeRegistration）。
 */
export function applicableFields(input: ApplicabilityInput): RegistrationField[] {
  return registrationFields.filter((field) => {
    if (SHIPPING_FIELDS.has(field)) return input.method === 'send_parts';
    if (field === 'responsibilityReason') return input.responsibility === 'other';
    if (field === 'claimTarget' || field === 'claimStatus') {
      return input.responsibility === 'logistics';
    }
    if (field === 'factory') return involvesFactory(input.factoryRatios);
    return true;
  });
}

// ---------------------------------------------------------------- 新建登记的输入与校验

/** 一侧的比例：抽屉里两侧都能填，改一侧另一侧自动补足 100；没填、或另一侧填错时为 null */
export const ratioSideInputSchema = z.object({
  fsh: z.number().nullable(),
  factory: z.number().nullable(),
});
export type RatioSideInput = z.infer<typeof ratioSideInputSchema>;
export const ratiosInputSchema = z.object({
  product: ratioSideInputSchema,
  freight: ratioSideInputSchema,
  other: ratioSideInputSchema,
});
export type RatiosInput = z.infer<typeof ratiosInputSchema>;

/** 一个费用项：原币金额（两位小数的字符串，没填为 null）与币种 */
export const feeInputSchema = z.object({
  amount: z.string().nullable(),
  currency: currencySchema,
});
export type FeeInput = z.infer<typeof feeInputSchema>;

/**
 * 新建登记提交的内容（S14 抽屉的字段）。形状宽松（下拉可以没选、文字可以空），是否填对由 registrationErrors 逐项判断，
 * 加上要查库的（负责人是否合格、来源工单、生产厂与配件是否存在）一次列全（同 K8：保存后定位到第一个错误）。
 * 不适用的字段由 normalizeRegistration 清空后再保存。金额先按原币保存，汇率与美元折算随待办 20。
 */
export const registrationInputSchema = z.object({
  method: handlingMethodSchema.nullable(),
  storeId: z.uuid().nullable(),
  site: siteSchema.nullable(),
  orderNumber: z.string(),
  customerName: z.string(),
  /** 来源工单号（可不填，空串）；填了则带入店铺、站点、订单号、客户 */
  sourceTicket: z.string(),
  /** 费用发生日 YYYY-MM-DD（北京时间的日期） */
  feeDate: z.iso.date().nullable(),
  ownerId: z.uuid().nullable(),
  responsibility: responsibilitySchema.nullable(),
  responsibilityReason: z.string(),
  /** 生产厂代码（FQD、FZJ） */
  factory: z.string().nullable(),
  ratios: ratiosInputSchema,
  claimTarget: claimTargetSchema.nullable(),
  claimStatus: claimStatusSchema.nullable(),
  partSku: z.string().nullable(),
  partQuantity: z.number().nullable(),
  shipper: shipperSchema.nullable(),
  carrier: z.string(),
  /** 寄出日期 YYYY-MM-DD */
  shipDate: z.iso.date().nullable(),
  trackingNumber: z.string(),
  fees: z.object({
    productCost: feeInputSchema,
    freight: feeInputSchema,
    compensation: feeInputSchema,
    otherCost: feeInputSchema,
  }),
});
export type RegistrationInput = z.infer<typeof registrationInputSchema>;

/** 空白的新建登记（抽屉打开时；默认值如费用发生日、数量由抽屉另填） */
export function emptyRegistrationInput(): RegistrationInput {
  const fee = (): FeeInput => ({ amount: null, currency: 'USD' });
  const side = (): RatioSideInput => ({ fsh: null, factory: null });
  return {
    method: null,
    storeId: null,
    site: null,
    orderNumber: '',
    customerName: '',
    sourceTicket: '',
    feeDate: null,
    ownerId: null,
    responsibility: null,
    responsibilityReason: '',
    factory: null,
    ratios: { product: side(), freight: side(), other: side() },
    claimTarget: null,
    claimStatus: null,
    partSku: null,
    partQuantity: null,
    shipper: null,
    carrier: '',
    shipDate: null,
    trackingNumber: '',
    fees: { productCost: fee(), freight: fee(), compensation: fee(), otherCost: fee() },
  };
}

/** 新建登记的报错文案（S14；原型没画的照 K8 的写法，经用户确认） */
export const registrationMessages = {
  methodMissing: '请选择处理方式',
  storeMissing: '请选择店铺',
  siteMissing: '请选择站点',
  orderNumberMissing: '请填写订单号',
  customerMissing: '请填写客户',
  feeDateMissing: '请选择费用发生日',
  ownerMissing: '请选择负责人',
  ownerNotEligible: '只能选有该店铺数据范围的售后负责人',
  responsibilityMissing: '请选择责任类型',
  factoryMissing: '请选择生产厂',
  reasonMissing: '责任为「其他」时须填写理由',
  /** 比例（S14、AC-AS-11） */
  ratio: '比例为 0–100 的整数',
  /** 两侧都填了但加起来不是 100（只有直接调用接口时会出现，抽屉总是自动补足） */
  ratioSum: 'FSH 与工厂两侧之和须为 100',
  /** 「退款或部分补偿」的额外赔偿（S14、AC-P1-17） */
  refundCompensation: '部分补偿、免退货退款的款项记在额外赔偿，须大于 0',
  amountFormat: '金额不能为负数，最多两位小数',
  quantity: '数量为 1–10 的整数',
  partMissing: '没有这个配件',
  sourceTicketNotFound: '没有这张工单，或不在你的店铺范围内',
  sourceTicketStore: (storeName: string) => `来源工单属于 ${storeName}，与所选店铺不一致`,
  reasonTooLong: '理由最多 200 字',
} as const;

/** 责任理由最多 200 字（S14 计数「0 / 200」） */
export const RESPONSIBILITY_REASON_MAX = 200;
/** 数量 1–10（S14「件 · 1–10」） */
export const PART_QUANTITY_MIN = 1;
export const PART_QUANTITY_MAX = 10;

function isPercent(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

/**
 * 三组承担比例（R-AS-02、AC-AS-11）：每组填了一侧就按它算另一侧（两侧互补，和为 100）；填错的一侧报「比例为 0–100 的整数」。
 * 全部填对时给出各组的工厂比例，否则 ratios 为 null。
 */
export function resolveRatios(input: RatiosInput): {
  ratios: FactoryRatios | null;
  errors: FieldErrors;
} {
  const errors: FieldErrors = {};
  const ratios: Partial<FactoryRatios> = {};
  for (const group of ratioGroups) {
    const { fsh, factory } = input[group];
    const at = (side: 'fsh' | 'factory') => `ratios.${group}.${side}`;
    if (factory !== null) {
      if (!isPercent(factory)) {
        errors[at('factory')] = registrationMessages.ratio;
      } else if (fsh !== null && !isPercent(fsh)) {
        errors[at('fsh')] = registrationMessages.ratio;
      } else if (fsh !== null && fsh + factory !== 100) {
        errors[at('fsh')] = registrationMessages.ratioSum;
      } else {
        ratios[group] = factory;
      }
    } else if (fsh !== null) {
      if (isPercent(fsh)) ratios[group] = 100 - fsh;
      else errors[at('fsh')] = registrationMessages.ratio;
    } else {
      errors[at('factory')] = registrationMessages.ratio;
    }
  }
  const complete = ratioGroups.every((group) => ratios[group] !== undefined);
  return { ratios: complete ? (ratios as FactoryRatios) : null, errors };
}

/** 各组已能确定的工厂比例（抽屉判断生产厂是否适用、预填用；填错的组为 null） */
export function factoryRatiosOf(input: RatiosInput): Record<RatioGroup, number | null> {
  const out = {} as Record<RatioGroup, number | null>;
  for (const group of ratioGroups) {
    const { fsh, factory } = input[group];
    out[group] =
      factory !== null
        ? isPercent(factory)
          ? factory
          : null
        : fsh !== null && isPercent(fsh)
          ? 100 - fsh
          : null;
  }
  return out;
}

const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** 金额字符串是否合法：不为负数、最多两位小数（numeric(12,2)） */
export function isValidAmount(amount: string): boolean {
  return AMOUNT_PATTERN.test(amount);
}

/** 金额大于 0（合法的金额字符串） */
function isPositiveAmount(amount: string | null): boolean {
  return amount !== null && isValidAmount(amount) && Number(amount) > 0;
}

/**
 * 规范化：去掉文字首尾空白，空金额为 null，金额写成两位小数；不适用的字段清空（R-AS-08：寄件一节只属于寄配件，
 * 理由只属于「其他」，索赔只属于物流问题，生产厂只在有工厂比例时）。不适用字段在抽屉里不显示，提交时也不保存。
 */
export function normalizeRegistration(raw: RegistrationInput): RegistrationInput {
  const input: RegistrationInput = {
    ...raw,
    orderNumber: raw.orderNumber.trim(),
    customerName: raw.customerName.trim(),
    sourceTicket: raw.sourceTicket.trim().toUpperCase(),
    responsibilityReason: raw.responsibilityReason.trim(),
    factory: raw.factory?.trim() || null,
    partSku: raw.partSku?.trim() || null,
    carrier: raw.carrier.trim(),
    trackingNumber: raw.trackingNumber.trim(),
    fees: {
      productCost: normalizeFee(raw.fees.productCost),
      freight: normalizeFee(raw.fees.freight),
      compensation: normalizeFee(raw.fees.compensation),
      otherCost: normalizeFee(raw.fees.otherCost),
    },
  };
  const applicable = new Set(
    applicableFields({
      method: input.method,
      responsibility: input.responsibility,
      factoryRatios: factoryRatiosOf(input.ratios),
    }),
  );
  return {
    ...input,
    responsibilityReason: applicable.has('responsibilityReason') ? input.responsibilityReason : '',
    claimTarget: applicable.has('claimTarget') ? input.claimTarget : null,
    claimStatus: applicable.has('claimStatus') ? input.claimStatus : null,
    factory: applicable.has('factory') ? input.factory : null,
    partSku: applicable.has('part') ? input.partSku : null,
    partQuantity: applicable.has('part') ? input.partQuantity : null,
    shipper: applicable.has('shipper') ? input.shipper : null,
    carrier: applicable.has('carrier') ? input.carrier : '',
    shipDate: applicable.has('shipDate') ? input.shipDate : null,
    trackingNumber: applicable.has('trackingNumber') ? input.trackingNumber : '',
  };
}

function normalizeFee(fee: FeeInput): FeeInput {
  const text = fee.amount?.trim() ?? '';
  if (!text) return { amount: null, currency: fee.currency };
  if (!isValidAmount(text)) return { amount: text, currency: fee.currency };
  return { amount: Number(text).toFixed(2), currency: fee.currency };
}

/**
 * 表单本身能判断的错误（S14「保存时校验全部」、R-AS-08）。必须填才能保存的：处理方式、店铺、站点、订单号、客户、
 * 费用发生日、负责人、责任类型、三组比例（选了责任类型后才校验，选它会预填比例）、责任为「其他」时的理由、
 * 任一组工厂比例大于 0 时的生产厂、「退款或部分补偿」的额外赔偿大于 0。寄件一节、四项费用金额、索赔对象与状态
 * 进行中可以先空着（设为已完成后缺了计入「缺 N 项」，待办 21）；填了就要填对（金额格式、数量范围）。
 * 负责人是否合格、来源工单、生产厂与配件是否存在要查库，由 aftersales 保存时补上，与这里的结果一起返回。
 */
export function registrationErrors(raw: RegistrationInput): FieldErrors {
  const input = normalizeRegistration(raw);
  const m = registrationMessages;
  const errors: FieldErrors = {};
  if (!input.method) errors.method = m.methodMissing;
  if (!input.storeId) errors.storeId = m.storeMissing;
  if (!input.site) errors.site = m.siteMissing;
  if (!input.orderNumber) errors.orderNumber = m.orderNumberMissing;
  if (!input.customerName) errors.customerName = m.customerMissing;
  if (!input.feeDate) errors.feeDate = m.feeDateMissing;
  if (!input.ownerId) errors.ownerId = m.ownerMissing;
  if (!input.responsibility) errors.responsibility = m.responsibilityMissing;

  const resolved = input.responsibility ? resolveRatios(input.ratios) : null;
  if (involvesFactory(factoryRatiosOf(input.ratios)) && !input.factory) {
    errors.factory = m.factoryMissing;
  }
  if (input.responsibility === 'other') {
    if (!input.responsibilityReason) errors.responsibilityReason = m.reasonMissing;
    else if (input.responsibilityReason.length > RESPONSIBILITY_REASON_MAX) {
      errors.responsibilityReason = m.reasonTooLong;
    }
  }
  Object.assign(errors, resolved?.errors ?? {});

  if (
    input.partQuantity !== null &&
    !(
      Number.isInteger(input.partQuantity) &&
      input.partQuantity >= PART_QUANTITY_MIN &&
      input.partQuantity <= PART_QUANTITY_MAX
    )
  ) {
    errors.partQuantity = m.quantity;
  }
  for (const item of feeItems) {
    const { amount } = input.fees[item];
    if (amount !== null && !isValidAmount(amount)) errors[`fees.${item}`] = m.amountFormat;
  }
  if (
    input.method === 'refund_or_compensation' &&
    !errors['fees.compensation'] &&
    !isPositiveAmount(input.fees.compensation.amount)
  ) {
    errors['fees.compensation'] = m.refundCompensation;
  }
  return errors;
}

// ---------------------------------------------------------------- 负责人

/** 可选的负责人：在职的售后负责人与他的店铺数据范围 */
export const ownerOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  stores: storeScopeSchema,
});
export type OwnerOption = z.infer<typeof ownerOptionSchema>;

/** 有该店铺数据范围的售后负责人（D-24：负责人只能从这些人里选）；还没选店铺时为空 */
export function ownersForStore(
  owners: readonly OwnerOption[],
  storeId: string | null,
): OwnerOption[] {
  if (!storeId) return [];
  return owners.filter((owner) => owner.stores.all || owner.stores.storeIds.includes(storeId));
}

/**
 * 负责人旁的说明属于哪种情形：唯一一位（已默认）· 登记人本人（已默认）· 有几位要选 · 还没选店铺 · 没有可选的人
 */
export type OwnerNote = 'only' | 'self' | 'choose' | 'no_store' | 'none';

export function ownerNote(
  owners: readonly OwnerOption[],
  storeId: string | null,
  registrarId: string,
): OwnerNote {
  if (!storeId) return 'no_store';
  const candidates = ownersForStore(owners, storeId);
  if (candidates.length === 0) return 'none';
  if (candidates.length === 1) return 'only';
  if (candidates.some((owner) => owner.id === registrarId)) return 'self';
  return 'choose';
}

/**
 * 默认负责人（6.5「第一阶段台账状态」、AC-P1-18）：登记人是有该店铺范围的售后负责人时默认本人；
 * 该店铺只有一位售后负责人时默认此人；否则不默认，必须选。
 */
export function defaultOwnerId(
  owners: readonly OwnerOption[],
  storeId: string | null,
  registrarId: string,
): string | null {
  const candidates = ownersForStore(owners, storeId);
  if (candidates.some((owner) => owner.id === registrarId)) return registrarId;
  return candidates.length === 1 ? (candidates[0]?.id ?? null) : null;
}

// ---------------------------------------------------------------- 接口输出

/** 一个已登记的费用项：原币金额与币种（汇率、汇率日期与来源、冻结美元值随待办 20） */
export const feeSchema = z.object({ amount: z.string(), currency: currencySchema });
export type Fee = z.infer<typeof feeSchema>;
export const feesSchema = z.object({
  productCost: feeSchema.nullable(),
  freight: feeSchema.nullable(),
  compensation: feeSchema.nullable(),
  otherCost: feeSchema.nullable(),
});
export type Fees = z.infer<typeof feesSchema>;

/** 一组承担比例的两侧（FSH + 工厂 = 100） */
export const ratioPairSchema = z.object({ fsh: percentSchema, factory: percentSchema });
export type RatioPair = z.infer<typeof ratioPairSchema>;
export const ratiosSchema = z.object({
  product: ratioPairSchema,
  freight: ratioPairSchema,
  other: ratioPairSchema,
});
export type Ratios = z.infer<typeof ratiosSchema>;

/** 工厂比例写成两侧（FSH = 100 − 工厂） */
export function ratioPairsOf(factory: FactoryRatios): Ratios {
  const pair = (value: number): RatioPair => ({ fsh: 100 - value, factory: value });
  return {
    product: pair(factory.product),
    freight: pair(factory.freight),
    other: pair(factory.other),
  };
}

/**
 * P13 台账的一行（第一期最简列表：售后单号、客户、店铺与站点、处理方式、责任、状态、费用列；
 * 完整的列、合计与列设置随待办 22）。费用与承担比例是财务字段，坐席看不到（PRD 10.1、P13「第一阶段」）；
 * 比例在台账里写在 FSH / 工厂承担的悬停说明（22），历史导入缺比例时为 null。
 */
export const ledgerItemSchema = z.object({
  id: z.uuid(),
  number: aftersalesNumberSchema,
  status: aftersalesStatusSchema,
  origin: aftersalesOriginSchema,
  customerName: z.string().nullable(),
  store: z.object({ id: z.uuid(), name: z.string() }),
  site: siteSchema.nullable(),
  method: handlingMethodSchema.nullable(),
  responsibility: responsibilitySchema.nullable(),
  fees: financeField(feesSchema),
  ratios: financeField(ratiosSchema.nullable()),
});
export type LedgerItem = z.infer<typeof ledgerItemSchema>;
export const ledgerSchema = z.object({ items: z.array(ledgerItemSchema) });
export type Ledger = z.infer<typeof ledgerSchema>;

/** 新建登记抽屉要用的选项：可选的负责人、责任类型的默认比例（种子数据）、生产厂、配件与所属生产厂 */
export const registrationOptionsSchema = z.object({
  owners: z.array(ownerOptionSchema),
  defaultRatios: z.array(
    z.object({ responsibility: responsibilitySchema, ratios: factoryRatiosSchema }),
  ),
  factories: z.array(z.object({ code: z.string() })),
  parts: z.array(z.object({ sku: z.string(), name: z.string(), factory: z.string() })),
});
export type RegistrationOptions = z.infer<typeof registrationOptionsSchema>;

/** 来源工单（新建登记时按工单号查，带入店铺、站点、订单号、客户） */
export const sourceTicketSchema = z.object({
  number: z.string(),
  store: z.object({ id: z.uuid(), name: z.string() }),
  site: siteSchema,
  orderNumber: z.string().nullable(),
  customerName: z.string(),
});
export type SourceTicket = z.infer<typeof sourceTicketSchema>;
