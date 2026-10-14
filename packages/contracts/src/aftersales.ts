import Big from 'big.js';
import { z } from 'zod';
import { storeScopeSchema } from './auth';
import { can } from './capabilities';
import { siteSchema, type FieldErrors, type Site } from './channel';
import { exchangeRateSchema } from './exchange-rate';
import { financeField } from './finance';
import { currencySchema } from './money';
import type { Role } from './roles';

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
  'claimTarget',
  'claimStatus',
  'responsibilityReason',
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

/**
 * 登记内容自上而下的各项（抽屉顺序；与 registrationFields 的区别：来源工单单列，「配件 × 数量」分成配件与数量两项，
 * 比例三组算一项，费用一项一个）。编辑登记比较这次改了哪些项、补登锁定已填的项，前后端都按它（edit.ts、registration-form.ts）。
 */
export const registrationItems = [
  'method',
  'storeId',
  'site',
  'orderNumber',
  'customerName',
  'sourceTicket',
  'feeDate',
  'ownerId',
  'responsibility',
  'factory',
  'claimTarget',
  'claimStatus',
  'responsibilityReason',
  'ratios',
  'partSku',
  'partQuantity',
  'shipper',
  'carrier',
  'shipDate',
  'trackingNumber',
  'fees.productCost',
  'fees.freight',
  'fees.compensation',
  'fees.otherCost',
] as const;
export type RegistrationItem = (typeof registrationItems)[number];

/**
 * 补登时还能改的已填项：按 R-AS-08 算缺、却已经有值的字段（例如「退款或部分补偿」的额外赔偿登记成 0）。
 * 「配件 × 数量」缺只会是配件或数量空着，空着的那一项本来就能填，已填的那一项不跟着解锁。
 */
export function refillableItems(missing: readonly RegistrationField[]): RegistrationItem[] {
  return missing.filter((field): field is Exclude<RegistrationField, 'part'> => field !== 'part');
}

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
  claimTarget: '索赔对象',
  claimStatus: '索赔状态',
  responsibilityReason: '责任理由',
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

// ---------------------------------------------------------------- R-AS-08 缺失字段（「适用字段是否齐全」）

/**
 * 判断缺失字段要看的已登记内容（一张售后单；没填为 null）。后端从售后单表读出，前端不自己算（坐席拿不到费用与比例），
 * 台账每行带着后端算好的结果（ledgerItemSchema 的 missing）。
 */
export interface RegistrationRecord {
  readonly method: HandlingMethod | null;
  readonly storeId: string | null;
  readonly site: Site | null;
  readonly orderNumber: string | null;
  readonly customerName: string | null;
  readonly feeDate: string | null;
  readonly ownerId: string | null;
  readonly responsibility: Responsibility | null;
  readonly responsibilityReason: string | null;
  readonly factory: string | null;
  readonly claimTarget: ClaimTarget | null;
  readonly claimStatus: ClaimStatus | null;
  /** 配件 × 数量（「配件 × 数量」算一项：配件或数量没填都算缺） */
  readonly part: { readonly sku: string; readonly quantity: number | null } | null;
  readonly shipper: Shipper | null;
  readonly carrier: string | null;
  readonly shipDate: string | null;
  readonly trackingNumber: string | null;
  /** 三组工厂比例；没登记（历史导入）为 null */
  readonly factoryRatios: FactoryRatios | null;
  /** 四个费用项的原币金额（两位小数）；没登记为 null，0 也算登记了 */
  readonly fees: Readonly<Record<FeeItem, string | null>>;
}

const filledText = (value: string | null) => value !== null && value.trim() !== '';

/** 一个适用字段在这张单上是否已填（R-AS-08：费用项填 0 视为已填；「退款或部分补偿」的额外赔偿须大于 0） */
function isFilled(record: RegistrationRecord, field: RegistrationField): boolean {
  switch (field) {
    case 'orderNumber':
    case 'customerName':
    case 'responsibilityReason':
    case 'carrier':
    case 'trackingNumber':
      return filledText(record[field]);
    case 'ratios':
      return record.factoryRatios !== null;
    case 'part':
      return record.part !== null && record.part.quantity !== null;
    case 'fees.productCost':
    case 'fees.freight':
    case 'fees.otherCost':
      return record.fees[feeItemOf(field)] !== null;
    case 'fees.compensation': {
      const amount = record.fees.compensation;
      if (amount === null) return false;
      return record.method !== 'refund_or_compensation' || Number(amount) > 0;
    }
    default:
      return record[field] !== null;
  }
}

function feeItemOf(field: `fees.${FeeItem}`): FeeItem {
  return field.slice('fees.'.length) as FeeItem;
}

/**
 * 「适用字段是否齐全」（R-AS-08 必填矩阵，前后端共用）：这张单缺的适用字段，按抽屉顺序；齐全时为空。
 * 适用与否看处理方式、责任类型与工厂比例（applicableFields）：不适用的字段空着不算缺。
 * 台账「待回填」标黄与「缺 N 项」只对已完成的单生效，进行中的单缺字段显示「—」（AC-AS-22）；完整率按它判断齐全。
 */
export function missingFields(record: RegistrationRecord): RegistrationField[] {
  return applicableFields({
    method: record.method,
    responsibility: record.responsibility,
    factoryRatios: record.factoryRatios,
  }).filter((field) => !isFilled(record, field));
}

/** 「缺 N 项」里索赔两项合算一项（原型 data.ledger_missing 的「索赔对象与状态」） */
const CLAIM_ITEM = '索赔对象与状态';

/**
 * 「缺 N 项」的各项（悬停「缺：…」的字段名，项数即 N）：字段名同抽屉，「配件 × 数量」算一项，
 * 索赔对象与索赔状态合算一项「索赔对象与状态」（原型 data.ledger_missing）
 */
export function missingItemLabels(fields: readonly RegistrationField[]): string[] {
  const labels = fields.map((field) =>
    field === 'claimTarget' || field === 'claimStatus'
      ? CLAIM_ITEM
      : registrationFieldLabels[field],
  );
  return [...new Set(labels)];
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
 * 加上要查库的（负责人是否合格、来源工单、生产厂与配件是否存在、非美元金额有没有汇率）一次列全（同 K8：保存后定位到
 * 第一个错误）。不适用的字段由 normalizeRegistration 清空后再保存。金额按原币填，保存时按费用发生日取汇率冻结美元值。
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
  /** 非美元金额在费用发生日及之前都没有汇率（E-20 的极端情形：系统刚部署、首次同步还没完成） */
  noRate: '费用发生日及之前没有汇率，暂时不能折算美元',
} as const;

/** 责任理由最多 200 字（S14 计数「0 / 200」） */
export const RESPONSIBILITY_REASON_MAX = 200;
/** 数量 1–10（S14「件 · 1–10」） */
export const PART_QUANTITY_MIN = 1;
export const PART_QUANTITY_MAX = 10;

/** 比例的一侧是否填对：0–100 的整数（抽屉就地补足另一侧与接口校验共用） */
export function isPercent(value: number): boolean {
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
  return clearInapplicable(tidyRegistration(raw));
}

/** 只整理写法（去首尾空白、空金额为 null、金额两位小数、来源工单大写），不清空不适用的字段 */
export function tidyRegistration(raw: RegistrationInput): RegistrationInput {
  return {
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
}

/** 清空不适用的字段（R-AS-08，按处理方式、责任类型与工厂比例） */
export function clearInapplicable(input: RegistrationInput): RegistrationInput {
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
    partQuantity: applicable.has('part') && input.partSku ? input.partQuantity : null,
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

/**
 * 改派负责人可选的接手人（P13「改派负责人」，待办 23）：有该店铺数据范围的在职售后负责人，去掉现负责人
 * （待分配的单现负责人已停用，本来就不在 owners 里）
 */
export function reassignCandidates(
  owners: readonly OwnerOption[],
  storeId: string,
  currentOwnerId: string | null,
): OwnerOption[] {
  return ownersForStore(owners, storeId).filter((owner) => owner.id !== currentOwnerId);
}

// ---------------------------------------------------------------- 状态与权限（6.5「第一阶段台账状态」、10.1）

/** 设为已完成后可撤销的秒数（S15 ①、G5 撤销浮层；服务端另留网络延迟的余量） */
export const COMPLETE_UNDO_SECONDS = 5;

/** 一张单上能做的事：编辑（进行中）· 设为已完成 · 取消 · 补登（已完成）· 修改汇率 · 改派负责人 */
export interface AftersalesActions {
  readonly edit: boolean;
  readonly complete: boolean;
  readonly cancel: boolean;
  readonly backfill: boolean;
  readonly changeRate: boolean;
  readonly reassign: boolean;
}

/** 判断权限要看的：单的状态、登记人与负责人 */
export interface AftersalesActionTarget {
  readonly status: AftersalesStatus;
  readonly registeredById: string | null;
  readonly ownerId: string | null;
}

/**
 * 这张单算不算查看者的（10.1「编辑进行中的手工登记单、设为已完成」的「○」）：客服主管是自己登记的，售后负责人是自己登记或负责的；
 * 多角色取并集。只看归属，不看状态（设为已完成的撤销也按它）
 */
export function ownsRegistration(
  viewer: { readonly id: string; readonly roles: readonly Role[] },
  target: Pick<AftersalesActionTarget, 'registeredById' | 'ownerId'>,
): boolean {
  if (!can(viewer.roles, 'aftersales.edit_open')) return false;
  const registered = target.registeredById === viewer.id;
  const owns = target.ownerId === viewer.id;
  return (
    (viewer.roles.includes('supervisor') && registered) ||
    (viewer.roles.includes('aftersales_owner') && (registered || owns))
  );
}

/**
 * 这张单上查看者能做的事（PRD 10.1、6.5「第一阶段台账状态」；前端据此显示入口，后端据此强制）：
 * 进行中——登记人或负责人可编辑、设为已完成；客服主管或售后负责人可取消。已完成——只有售后负责人补登缺失的字段。
 * 已完成、已取消为终态：不能再设为已完成或取消。修改汇率只有售后负责人，进行中与已完成可改，已取消只读。
 * 改派负责人：客服主管或售后负责人，店铺范围内任何单，进行中与已完成可改派，已取消只读（S15 补充小样，协调者 2026-10-14 决定 Q7）。
 */
export function aftersalesActions(
  viewer: { readonly id: string; readonly roles: readonly Role[] },
  target: AftersalesActionTarget,
): AftersalesActions {
  const open = target.status === 'in_progress';
  const editor = open && ownsRegistration(viewer, target);
  return {
    edit: editor,
    complete: editor,
    cancel: open && can(viewer.roles, 'aftersales.cancel'),
    backfill: target.status === 'completed' && can(viewer.roles, 'aftersales.backfill'),
    changeRate: target.status !== 'cancelled' && can(viewer.roles, 'aftersales.backfill'),
    reassign: target.status !== 'cancelled' && can(viewer.roles, 'aftersales.reassign_owner'),
  };
}

// ---------------------------------------------------------------- 登记完整率（R-AS-08）

/** 完整率的目标（PRD 3.2：上线后第一个完整自然月 ≥ 98%） */
export const COMPLETION_TARGET = 98;

/**
 * 当月登记完整率（R-AS-08）：当月（按完成时间，北京时间）已完成的单里适用字段齐全的单数 ÷ 已完成单数，历史导入不计；
 * 只随店铺数据范围与店铺筛选变化，不随日期筛选
 */
export const completionSchema = z.object({
  /** 当月 YYYY-MM（北京时间） */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** 当月已完成的单数（分母） */
  completed: z.int().min(0),
  /** 其中适用字段齐全的单数（分子） */
  complete: z.int().min(0),
});
export type Completion = z.infer<typeof completionSchema>;

/** 完整率的写法（原型「87.5%」：一位小数，整数不写「.0」）；当月没有已完成的单为 null（界面写「—」） */
export function completionLabel(completion: Completion): string | null {
  if (completion.completed === 0) return null;
  const percent = ((completion.complete * 100) / completion.completed).toFixed(1);
  return `${percent.replace(/\.0$/, '')}%`;
}

// ---------------------------------------------------------------- 接口输出

/**
 * 一个已登记的费用项（PRD 11.1「每项保存原币、汇率、汇率日期与来源、冻结美元值」、R-FL-06）：原币金额与币种、
 * 冻结的美元值（四舍五入到分；美元金额就是原值）、折算用的汇率（1 USD = rate 原币，带实际日期与来源；美元为 null）
 */
export const feeSchema = z.object({
  amount: z.string(),
  currency: currencySchema,
  usd: z.string(),
  rate: exchangeRateSchema.nullable(),
});
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

/** 一行的费用合计与两方承担（美元，两位小数）；比例没登记（历史导入）时承担为 null */
export interface CostShares {
  readonly total: string;
  readonly factory: string | null;
  readonly fsh: string | null;
}

/**
 * 承担金额（R-AS-08、D-24）：费用合计 = 四项美元值之和（没登记的不计）；工厂承担 = 各组费用 × 该组工厂比例之和，
 * 逐行四舍五入到分（不是逐组取整再相加）；FSH 承担 = 该行费用合计 − 工厂承担，所以两者之和总等于费用合计。
 * 台账每行、合计行（各行之和）、导出与登记抽屉的「FSH 合计 · 工厂合计」都按它算。十进制运算用 big.js，四舍五入。
 */
export function costShares(
  usd: Readonly<Record<FeeItem, string | null>>,
  ratios: FactoryRatios | null,
): CostShares {
  const amount = (item: FeeItem) => new Big(usd[item] ?? 0);
  const total = feeItems.reduce((sum, item) => sum.plus(amount(item)), new Big(0));
  if (!ratios) return { total: total.toFixed(2), factory: null, fsh: null };
  const factory = feeItems
    .reduce(
      (sum, item) => sum.plus(amount(item).times(ratios[feeItemGroup[item]]).div(100)),
      new Big(0),
    )
    .round(2, Big.roundHalfUp);
  return {
    total: total.toFixed(2),
    factory: factory.toFixed(2),
    fsh: total.minus(factory).toFixed(2),
  };
}

/** 一组比例的写法「FSH 0 / 工厂 100」 */
export function ratioPairWords(pair: RatioPair): string {
  return `FSH ${pair.fsh} / 工厂 ${pair.factory}`;
}

/** 三组比例相同时为这个比例，不同时为 null（台账悬停按它写一个值或「按费用项」，PRD R-AS-02 下的写法说明） */
export function uniformRatio(ratios: Ratios): RatioPair | null {
  const [first, ...rest] = ratioGroups.map((group) => ratios[group]);
  if (!first) return null;
  return rest.every((pair) => pair.factory === first.factory) ? first : null;
}

/** 三组比例不同时，紧凑写法与悬停的标题（PRD R-AS-02 下的写法说明：「按费用项」） */
export const RATIO_BY_ITEM = '按费用项';

/** 逐组的写法「产品成本 FSH 0 / 工厂 100」（按产品成本、快递物流、其他费用的顺序） */
export function ratioGroupWords(ratios: Ratios): string[] {
  return ratioGroups.map((group) => `${ratioGroupLabels[group]} ${ratioPairWords(ratios[group])}`);
}

/**
 * 比例的说明写法（原型 data.ratio_words）：三组相同写「三组均 FSH 0 / 工厂 100」，不同时逐组列出
 * 「产品成本 FSH 0 / 工厂 100 · 快递物流 FSH 100 / 工厂 0 · 其他费用 FSH 50 / 工厂 50」
 */
export function ratioWords(ratios: Ratios): string {
  const uniform = uniformRatio(ratios);
  return uniform ? `三组均 ${ratioPairWords(uniform)}` : ratioGroupWords(ratios).join(' · ');
}

/** 工厂比例写成两侧（FSH = 100 − 工厂） */
export function ratioPairsOf(factory: FactoryRatios): Ratios {
  const pair = (value: number): RatioPair => ({ fsh: 100 - value, factory: value });
  return {
    product: pair(factory.product),
    freight: pair(factory.freight),
    other: pair(factory.other),
  };
}

export const registrationFieldSchema = z.enum(registrationFields);

/**
 * 台账一行计入售后成本的部分（R-AS-08，售后成本视图 aftersales.aftersales_cost，P17 共用，AC-RP-01）：四个费用项计入的美元值
 * ——已取消的单只计取消时确认保留的部分，没保留的项为 "0.00"；没登记的项为 null——与费用合计、两方承担（costShares）
 */
export const ledgerCostSchema = z.object({
  productCost: z.string().nullable(),
  freight: z.string().nullable(),
  compensation: z.string().nullable(),
  otherCost: z.string().nullable(),
  total: z.string(),
  /** 比例没登记（历史导入）时为 null */
  fsh: z.string().nullable(),
  factory: z.string().nullable(),
});
export type LedgerCost = z.infer<typeof ledgerCostSchema>;

/**
 * P13 台账的一行（PRD P13「第一阶段」的 17 列：售后单号 · 客户 · 店铺与站点 · 处理方式 · 责任 · 状态 · 负责人 · 生产厂 ·
 * 配件 × 数量 · 快递单号 · 四个费用项 · 费用合计 · FSH 承担 · 工厂承担）。
 * 费用、承担比例与承担金额是财务字段，坐席看不到（PRD 10.1、P13「第一阶段」）；比例写在 FSH / 工厂承担的悬停说明里，
 * 历史导入缺比例时为 null。fees 是登记的原值，cost 是计入售后成本的部分（只有已取消的单两者会不同，原登记额在悬停中）。
 * missing 是后端按 R-AS-08 算好的缺失字段（坐席拿不到费用与比例，前端不自己算）：
 * 已完成的单据此标黄「待回填」、售后单号下标「缺 N 项」，进行中的单不标（AC-AS-22）。
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
  /** 生产厂代码（任一组工厂比例大于 0 时） */
  factory: z.string().nullable(),
  /** 配件 × 数量（寄配件；配件名取配件表，表里没有时为 null） */
  part: z
    .object({ sku: z.string(), name: z.string().nullable(), quantity: z.int().nullable() })
    .nullable(),
  /** 快递单号（寄配件寄出后填写；没有为 null） */
  trackingNumber: z.string().nullable(),
  /** 费用发生日（售后成本按它归期；取消时保留的费用同样按它计入） */
  feeDate: z.iso.date().nullable(),
  /** 登记人与负责人（行尾「更多」与编辑登记按它们判断权限，aftersalesActions） */
  registeredById: z.uuid().nullable(),
  ownerId: z.uuid().nullable(),
  /** 负责人姓名（「负责人」列；离职的也取得到）。待分配的单为原负责人 */
  ownerName: z.string().nullable(),
  /** 待分配：原负责人钉钉离职自动停用后进入改派队列（负责人列写「待分配」，悬停写原负责人；改派后清除，待办 23） */
  ownerPending: z.boolean(),
  /** 缺失的适用字段（R-AS-08，按抽屉顺序；齐全为空） */
  missing: z.array(registrationFieldSchema),
  /** 乐观锁版本（编辑登记、补登、设为已完成、取消、修改汇率时带上，G7） */
  version: z.int(),
  fees: financeField(feesSchema),
  ratios: financeField(ratiosSchema.nullable()),
  cost: financeField(ledgerCostSchema),
  /** 已取消的单取消时确认保留的费用项（其余状态为 null） */
  keptFees: financeField(z.array(z.enum(feeItems)).nullable()),
});
export type LedgerItem = z.infer<typeof ledgerItemSchema>;

/**
 * P13 台账的 17 列（PRD P13「第一阶段」：完整版去掉报备、协商、结算），按表格顺序；导出 Excel 用同样的列与表头。
 * 原型只画了默认显示的列，默认隐藏的四列的叫法取自「已隐藏 4 列：配件 × 数量、负责人、其他、生产厂」。
 */
export const ledgerColumns = [
  'number',
  'customer',
  'storeSite',
  'method',
  'responsibility',
  'status',
  'owner',
  'factory',
  'part',
  'trackingNumber',
  'productCost',
  'freight',
  'compensation',
  'otherCost',
  'feeTotal',
  'fshShare',
  'factoryShare',
] as const;
export type LedgerColumn = (typeof ledgerColumns)[number];
export const ledgerColumnLabels: Record<LedgerColumn, string> = {
  number: '售后单号',
  customer: '客户',
  storeSite: '店铺与站点',
  method: '处理方式',
  responsibility: '责任',
  status: '状态',
  owner: '负责人',
  factory: '生产厂',
  part: '配件 × 数量',
  trackingNumber: '快递单号',
  productCost: feeItemLabels.productCost,
  freight: feeItemLabels.freight,
  compensation: feeItemLabels.compensation,
  otherCost: feeItemLabels.otherCost,
  feeTotal: '费用合计',
  fshShare: 'FSH 承担 $',
  factoryShare: '工厂承担 $',
};
/** 只给有财务权限的角色的七个金额列（P13「第一阶段」：坐席不显示，导出同样不含） */
export const ledgerFinanceColumns: ReadonlySet<LedgerColumn> = new Set([
  'productCost',
  'freight',
  'compensation',
  'otherCost',
  'feeTotal',
  'fshShare',
  'factoryShare',
]);
/** 合计行里各金额列写的合计项（P13 合计行与导出的末行共用） */
export const ledgerColumnTotals: Partial<
  Record<
    LedgerColumn,
    'productCost' | 'freight' | 'compensation' | 'otherCost' | 'total' | 'fsh' | 'factory'
  >
> = {
  productCost: 'productCost',
  freight: 'freight',
  compensation: 'compensation',
  otherCost: 'otherCost',
  feeTotal: 'total',
  fshShare: 'fsh',
  factoryShare: 'factory',
};
/** 默认隐藏的列，按「已隐藏 4 列：配件 × 数量、负责人、其他、生产厂」的顺序（P13「第一阶段」） */
export const ledgerDefaultHidden: readonly LedgerColumn[] = [
  'part',
  'owner',
  'otherCost',
  'factory',
];

/** 店铺与站点的写法（原型 store_site()：「Forcome Direct · US」） */
export function storeSiteLabel(store: string, site: Site | null): string {
  return site ? `${store} · ${site}` : store;
}

/** 配件 × 数量的写法「HEPA 滤芯组件 FC-V2-HF01 × 1」（配件表里没有名字时只写 SKU，数量没填时不写「× N」） */
export function partLabel(part: {
  readonly sku: string;
  readonly name: string | null;
  readonly quantity: number | null;
}): string {
  const name = part.name ? `${part.name} ${part.sku}` : part.sku;
  return part.quantity === null ? name : `${name} × ${part.quantity}`;
}

/**
 * 合计行（R-AS-08、P13「第一阶段」）：列出的单数与各金额列之和（各行计入售后成本的部分；FSH / 工厂承担为各行之和）。
 * 「费用合计」与 P17「售后成本按责任类型」卡头总额来自同一个售后成本视图（AC-RP-01）。
 */
export const ledgerTotalsSchema = z.object({
  count: z.int().min(0),
  productCost: z.string(),
  freight: z.string(),
  compensation: z.string(),
  otherCost: z.string(),
  total: z.string(),
  fsh: z.string(),
  factory: z.string(),
});
export type LedgerTotals = z.infer<typeof ledgerTotalsSchema>;

/** 费用发生日起止（含两端，YYYY-MM-DD） */
export const feeDateRangeSchema = z.object({ from: z.iso.date(), to: z.iso.date() });
export type FeeDateRange = z.infer<typeof feeDateRangeSchema>;

/**
 * 默认的费用发生日：本月（北京时间当月 1 日至今天，S13 补充小样，用户确认）。today 是北京时间的今天；
 * 按服务端的时钟取（演示与测试的「当前时间」可注入），所以默认值由接口补上，前端不自己算
 */
export function defaultFeeDateRange(today: string): FeeDateRange {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/**
 * P13 台账：列表、合计行与页头的当月登记完整率（完整率不随日期筛选与「缺字段」筛选变化）。合计行是财务字段（坐席没有，
 * P13「第一阶段」）。
 */
export const ledgerSchema = z.object({
  items: z.array(ledgerItemSchema),
  totals: financeField(ledgerTotalsSchema),
  /** 这次按的费用发生日起止（没给的一端取本月的那一端）；筛出缺字段时不按日期，为 null */
  range: feeDateRangeSchema.nullable(),
  /** 默认的费用发生日（本月，按服务端时钟）：界面据它判断条件是否就是默认（不出「清除筛选」） */
  defaultRange: feeDateRangeSchema,
  completion: completionSchema,
});
export type Ledger = z.infer<typeof ledgerSchema>;

/**
 * P13 台账的查询条件（放在地址栏；导出用同一组条件）。筛选行：费用发生日起止 · 店铺 · 处理方式 · 责任 · 状态 · 负责人
 * （PRD P13「第一阶段」）；费用发生日没给的一端取本月的那一端（defaultFeeDateRange），其余不填是全部。missing 是点页头完整率
 * 「筛出缺字段的 N 单」：只列当月（按完成时间）已完成、缺适用字段的单（与完整率同口径：只随店铺，不叠其余条件；历史导入不列）。
 */
export const ledgerQuerySchema = z.object({
  /** 店铺（完整率随它变化） */
  store: z.uuid().optional(),
  /** 费用发生日起止（含两端；完整率不随它变化） */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  method: handlingMethodSchema.optional(),
  responsibility: responsibilitySchema.optional(),
  status: aftersalesStatusSchema.optional(),
  /** 负责人：成员 ID，或 PENDING_OWNER「待分配」（钉钉离职进入改派队列的单；没给日期时从最早的待分配单起，待办 23） */
  owner: z.union([z.uuid(), z.literal('pending')]).optional(),
  missing: z.literal('1').optional(),
});
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

/** 负责人筛选「待分配」在地址栏与接口里的值 */
export const PENDING_OWNER = 'pending';

/** 一个人（登记人、负责人）：成员 ID 与姓名 */
const personSchema = z.object({ id: z.uuid(), name: z.string() });

/** P13 筛选行的选项：负责人（查看者店铺范围内在职的售后负责人；「待分配」是界面固定的一项）。店铺取 channel 的店铺选项 */
export const ledgerOptionsSchema = z.object({ owners: z.array(personSchema) });
export type LedgerOptions = z.infer<typeof ledgerOptionsSchema>;

/** 导出 Excel 的响应头：导出的行数（浮层「· 12 单」）；文件名在 Content-Disposition 的 filename* */
export const EXPORT_ROWS_HEADER = 'X-Export-Rows';
/** 导出 Excel 的文件类型 */
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 一张售后单的完整登记（编辑登记抽屉 S14：进行中可改、已完成补登、已取消只读；「查看最新」也取它）。
 * 费用、比例与取消时保留的费用项是财务字段。
 */
export const aftersalesDetailSchema = z.object({
  id: z.uuid(),
  number: aftersalesNumberSchema,
  status: aftersalesStatusSchema,
  origin: aftersalesOriginSchema,
  version: z.int(),
  store: z.object({ id: z.uuid(), name: z.string() }),
  site: siteSchema.nullable(),
  /** 来源工单号（没填为 null） */
  sourceTicket: z.string().nullable(),
  orderNumber: z.string().nullable(),
  customerName: z.string().nullable(),
  registeredBy: personSchema.nullable(),
  owner: personSchema.nullable(),
  feeDate: z.iso.date().nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  method: handlingMethodSchema.nullable(),
  responsibility: responsibilitySchema.nullable(),
  responsibilityReason: z.string().nullable(),
  /** 生产厂代码 */
  factory: z.string().nullable(),
  /** 配件 × 数量（配件名取配件表，表里没有时为 null） */
  part: z
    .object({ sku: z.string(), name: z.string().nullable(), quantity: z.int().nullable() })
    .nullable(),
  shipper: shipperSchema.nullable(),
  carrier: z.string().nullable(),
  shipDate: z.iso.date().nullable(),
  trackingNumber: z.string().nullable(),
  claimTarget: claimTargetSchema.nullable(),
  claimStatus: claimStatusSchema.nullable(),
  fees: financeField(feesSchema),
  ratios: financeField(ratiosSchema.nullable()),
  missing: z.array(registrationFieldSchema),
  /** 取消（已取消的单）：原因、时刻与确认保留的已产生费用项（AC-AS-16） */
  cancellation: z
    .object({
      reason: z.string(),
      at: z.iso.datetime({ offset: true }),
      keptFees: financeField(z.array(z.enum(feeItems))),
    })
    .nullable(),
  /** 最近一次保存的人与时刻（G7「这条记录刚被某人修改」；系统写入为 null） */
  updatedBy: z.string().nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type AftersalesDetail = z.infer<typeof aftersalesDetailSchema>;

// ---------------------------------------------------------------- 修改汇率

/**
 * 修改汇率（PRD 10.1「补登与修改汇率」，只有售后负责人；S14 编辑登记的「修改汇率」）：给某几个非美元费用项填新的汇率
 * （1 USD = 汇率 原币），冻结美元值按它重算，汇率日期为费用发生日、来源「手工修改」，记审计。version 是读到的版本（G7）。
 */
export const rateChangeInputSchema = z.object({
  version: z.int(),
  /** 要改的费用项 → 新汇率（1 USD = 汇率 原币） */
  rates: z.partialRecord(z.enum(feeItems), z.string()),
});
export type RateChangeInput = z.infer<typeof rateChangeInputSchema>;

/** 修改汇率的报错（写在该金额的汇率下方；字段路径 `rates.<费用项>`） */
export const rateChangeMessages = {
  rateFormat: '汇率须大于 0，最多 6 位整数与 6 位小数',
  usdNoRate: '美元金额不用汇率',
  feeMissing: '这项费用还没登记，没有汇率可改',
  nothing: '没有要修改的汇率',
  cancelled: '已取消的单只读，不能修改汇率',
  noFeeDate: '这张单还没有费用发生日，先补费用发生日再改汇率',
} as const;

// ---------------------------------------------------------------- 编辑登记、补登、设为已完成、取消

/** 要保存的登记内容：同新建登记的字段，只交要改的部分（费用项也可以只交几项） */
export const registrationChangesSchema = registrationInputSchema
  .extend({ fees: registrationInputSchema.shape.fees.partial() })
  .partial();
export type RegistrationChanges = z.infer<typeof registrationChangesSchema>;

/**
 * 编辑登记与补登（S14「编辑登记 · S-…」、S15 ③）：changes 是要保存的登记内容（抽屉交整张表单，行内补登只交快递单号），
 * rates 是同时修改的汇率（「修改汇率」随「保存修改」一起提交，只有售后负责人；同 rateChangeInputSchema 的 rates）。
 * 进行中：登记人或负责人可改全部字段，按新建登记的规则校验；已完成：只有售后负责人补登原来空着的字段，已填的不能改；
 * 已取消只读。version 是读到的版本（G7）。
 */
export const registrationUpdateSchema = z.object({
  version: z.int(),
  changes: registrationChangesSchema.optional(),
  rates: rateChangeInputSchema.shape.rates.optional(),
});
export type RegistrationUpdate = z.infer<typeof registrationUpdateSchema>;

/** 设为已完成与撤销（S15 ①）：读到的版本 */
export const versionInputSchema = z.object({ version: z.int() });
export type VersionInput = z.infer<typeof versionInputSchema>;

/** 取消原因最多 200 字（S15 ②「0 / 200」） */
export const CANCEL_REASON_MAX = 200;

/**
 * 取消售后单（S15 ②、AC-AS-16）：原因必填；keptFees 是勾选的「取消后保留的已产生部分」（已登记的费用项，默认全部保留），
 * 保留的费用照常计入售后成本（R-AS-08），没勾的不计
 */
export const cancelInputSchema = z.object({
  version: z.int(),
  reason: z.string(),
  keptFees: z.array(z.enum(feeItems)),
});
export type CancelInput = z.infer<typeof cancelInputSchema>;

/** 编辑、补登、设为已完成、撤销、取消的报错（字段错误写在字段下方；status 是整张单的状态不对） */
export const ledgerActionMessages = {
  /** 已完成的单补登时改了已填的字段 */
  backfillFilled: '已完成的单只能补登缺失的字段',
  cancelled: '已取消的单只读',
  notOpen: '只有进行中的单可以这样操作',
  /** 撤销设为已完成：这张单不是刚设为已完成的 */
  undoExpired: '已超过撤销时限，这张单保持已完成',
  /** 撤销设为已完成：这张单现在不是已完成（只有直接调接口时会出现） */
  undoNotCompleted: '这张单不是已完成的，没有可撤销的',
  reasonMissing: '请填写取消原因',
  reasonTooLong: '原因最多 200 字',
  /** 勾选保留的费用项没有登记 */
  keptNotRegistered: '只能保留已登记的费用',
  /** 没有编辑权限（403） */
  editDenied: '只有登记人或负责人可以修改进行中的单',
  cancelDenied: '只有客服主管或售后负责人可以取消售后单',
  backfillDenied: '只有售后负责人可以补登已完成的单',
  rateDenied: '只有售后负责人可以修改汇率',
} as const;

// ---------------------------------------------------------------- 改派负责人（待办 23）

/** 改派负责人（S15 补充小样）：接手人与读到的版本（G7）；没选为 null */
export const reassignInputSchema = z.object({
  version: z.int(),
  ownerId: z.uuid().nullable(),
});
export type ReassignInput = z.infer<typeof reassignInputSchema>;

/** 改派负责人的报错（字段 ownerId；status 是整张单的状态不对）与不能改派的原因 */
export const reassignMessages = {
  ownerMissing: '请选择接手人',
  /** 这张单的店铺没有别的售后负责人可接手（下拉置灰，「改派」置灰） */
  noCandidate: '没有其他有该店铺范围的售后负责人可接手',
  ownerNotEligible: registrationMessages.ownerNotEligible,
  /** 选的就是现负责人（只有直接调接口时会出现，界面不列现负责人） */
  sameOwner: '接手人就是现在的负责人',
  cancelled: '这张单已取消',
  denied: '只有客服主管或售后负责人可以改派负责人',
} as const;

/** 改派队列的站内通知（11.4，协调者 2026-10-14 决定 Q9）：按店铺各发一条，对象是停用的成员 */
export const reassignQueueNotificationCopy = {
  title: '售后单待改派',
  body: (name: string, store: string, count: number) =>
    `${name}已停用（钉钉离职），${store} 有 ${count} 张进行中的售后单待分配负责人`,
  label: 'P13 · 待分配',
} as const;

/** 审计与负责人列里「待分配」的写法 */
export const PENDING_OWNER_WORDS = '待分配';

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
