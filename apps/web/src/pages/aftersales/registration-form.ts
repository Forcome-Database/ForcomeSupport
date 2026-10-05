import {
  factoryRatiosOf,
  feeItemGroup,
  feeItemLabels,
  feeItems,
  formatMoney,
  isPercent,
  isValidAmount,
  ratioGroups,
  ratioPairsOf,
  registrationFields,
  usdOf,
  type ClaimStatus,
  type ClaimTarget,
  type Currency,
  type ExchangeRate,
  type ExchangeRatesOn,
  type FeeItem,
  type FieldErrors,
  type HandlingMethod,
  type RatioGroup,
  type RatiosInput,
  type RegistrationField,
  type RegistrationInput,
  type Responsibility,
  type Shipper,
  type Site,
} from '@forcome/contracts';
import type { FieldPath } from 'react-hook-form';
import { DRAWER } from './p13-copy';

/*
 * 新建登记抽屉的表单（S14）：表单值与接口输入的互换、两侧互补的比例、只收数字的输入、接口字段错误的落位与「第一个错误」、
 * 比例表里实时算出的两方金额。都是纯函数，单元测试见 registration-form.test.ts。
 */

/** 一侧的比例：输入框里的文字（只有数字）；另一侧填错时为空（显示「—」） */
export interface RatioSideForm {
  fsh: string;
  factory: string;
}

export interface FeeForm {
  amount: string;
  currency: Currency;
}

/** 表单值：下拉没选为空串，输入框是原样的文字 */
export interface RegistrationFormValues {
  method: HandlingMethod | '';
  storeId: string;
  site: Site | '';
  orderNumber: string;
  customerName: string;
  sourceTicket: string;
  feeDate: string;
  ownerId: string;
  responsibility: Responsibility | '';
  factory: string;
  claimTarget: ClaimTarget | '';
  claimStatus: ClaimStatus | '';
  responsibilityReason: string;
  ratios: Record<RatioGroup, RatioSideForm>;
  partSku: string;
  partQuantity: string;
  shipper: Shipper | '';
  carrier: string;
  shipDate: string;
  trackingNumber: string;
  fees: Record<FeeItem, FeeForm>;
}

export type RegistrationFormPath = FieldPath<RegistrationFormValues>;

/** 打开抽屉时的表单：费用发生日默认今天（北京时间）、寄配件的数量默认 1、币种默认美元 */
export function emptyRegistrationForm(today: string): RegistrationFormValues {
  const side = (): RatioSideForm => ({ fsh: '', factory: '' });
  const fee = (): FeeForm => ({ amount: '', currency: 'USD' });
  return {
    method: '',
    storeId: '',
    site: '',
    orderNumber: '',
    customerName: '',
    sourceTicket: '',
    feeDate: today,
    ownerId: '',
    responsibility: '',
    factory: '',
    claimTarget: '',
    claimStatus: '',
    responsibilityReason: '',
    ratios: { product: side(), freight: side(), other: side() },
    partSku: '',
    partQuantity: '1',
    shipper: '',
    carrier: '',
    shipDate: '',
    trackingNumber: '',
    fees: { productCost: fee(), freight: fee(), compensation: fee(), otherCost: fee() },
  };
}

const orNull = <T extends string>(value: T | ''): T | null => (value === '' ? null : value);
const numberOrNull = (text: string): number | null => (text.trim() === '' ? null : Number(text));

/** 三组比例的输入框文字 → 接口的比例输入（没填为 null） */
function ratiosInputOf(ratios: Readonly<Record<RatioGroup, RatioSideForm>>): RatiosInput {
  const side = (group: RatioGroup) => ({
    fsh: numberOrNull(ratios[group].fsh),
    factory: numberOrNull(ratios[group].factory),
  });
  return { product: side('product'), freight: side('freight'), other: side('other') };
}

/** 表单值 → 接口输入（不适用的字段由接口按 R-AS-08 清空，这里原样交上去） */
export function registrationInputOf(values: RegistrationFormValues): RegistrationInput {
  const fee = (item: FeeItem) => ({
    amount: values.fees[item].amount.trim() === '' ? null : values.fees[item].amount.trim(),
    currency: values.fees[item].currency,
  });
  return {
    method: orNull(values.method),
    storeId: orNull(values.storeId),
    site: orNull(values.site),
    orderNumber: values.orderNumber,
    customerName: values.customerName,
    sourceTicket: values.sourceTicket,
    feeDate: orNull(values.feeDate),
    ownerId: orNull(values.ownerId),
    responsibility: orNull(values.responsibility),
    responsibilityReason: values.responsibilityReason,
    factory: orNull(values.factory),
    ratios: ratiosInputOf(values.ratios),
    claimTarget: orNull(values.claimTarget),
    claimStatus: orNull(values.claimStatus),
    partSku: orNull(values.partSku),
    partQuantity: numberOrNull(values.partQuantity),
    shipper: orNull(values.shipper),
    carrier: values.carrier,
    shipDate: orNull(values.shipDate),
    trackingNumber: values.trackingNumber,
    fees: {
      productCost: fee('productCost'),
      freight: fee('freight'),
      compensation: fee('compensation'),
      otherCost: fee('otherCost'),
    },
  };
}

/** 比例输入框只收数字（最多 3 位，能输入 130 以便报错，S14） */
export function percentText(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 3);
}

/** 数量输入框只收数字（最多 2 位） */
export function quantityText(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 2);
}

/** 金额输入框只收数字与一个小数点、最多两位小数 */
export function amountText(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const [whole = '', ...rest] = cleaned.split('.');
  if (rest.length === 0) return whole.slice(0, 10);
  return `${whole.slice(0, 10)}.${rest.join('').slice(0, 2)}`;
}

/**
 * 改了一侧的比例（S14「改一侧另一侧自动补足 100」）：填的是 0–100 的整数时另一侧为 100 减去它，
 * 否则另一侧清空（显示「—」，保存时报错在填错的这一侧）
 */
export function withRatioSide(
  side: RatioSideForm,
  changed: 'fsh' | 'factory',
  raw: string,
): RatioSideForm {
  const text = percentText(raw);
  const other = changed === 'fsh' ? 'factory' : 'fsh';
  const value = Number(text);
  const valid = text !== '' && isPercent(value);
  const next: RatioSideForm = { ...side, [changed]: text };
  next[other] = valid ? String(100 - value) : '';
  return next;
}

/** 责任类型的默认比例（工厂一侧）写成两侧的输入框文字 */
export function ratioFormOf(
  factory: Readonly<Record<RatioGroup, number>>,
): Record<RatioGroup, RatioSideForm> {
  const pairs = ratioPairsOf(factory);
  const side = (group: RatioGroup): RatioSideForm => ({
    fsh: String(pairs[group].fsh),
    factory: String(pairs[group].factory),
  });
  return { product: side('product'), freight: side('freight'), other: side('other') };
}

/** 各组的工厂比例：填对的组为数字，没填或填错为 null（判断生产厂是否适用、算两方金额用；同 contracts 的 factoryRatiosOf） */
export function factoryPercents(
  ratios: Readonly<Record<RatioGroup, RatioSideForm>>,
): Record<RatioGroup, number | null> {
  return factoryRatiosOf(ratiosInputOf(ratios));
}

/** R-AS-08 的一个字段在表单里对应的输入（来源工单跟在客户后面；比例每组两侧；配件 × 数量是两个输入；费用写在金额框） */
function formPathsOf(field: RegistrationField): RegistrationFormPath[] {
  if (field === 'customerName') return ['customerName', 'sourceTicket'];
  if (field === 'ratios') {
    return ratioGroups.flatMap(
      (group) => [`ratios.${group}.fsh`, `ratios.${group}.factory`] as RegistrationFormPath[],
    );
  }
  if (field === 'part') return ['partSku', 'partQuantity'];
  if (field.startsWith('fees.')) return [`${field}.amount` as RegistrationFormPath];
  return [field];
}

/** 表单里自上而下的字段（S14 抽屉的顺序）：保存后定位到最靠上的错误、横幅写第一个错误都按它 */
export const FORM_ORDER: readonly RegistrationFormPath[] = registrationFields.flatMap(formPathsOf);

export interface FormError {
  readonly field: RegistrationFormPath;
  readonly message: string;
}

/** 接口的字段路径 → 表单字段（费用项的错误写在金额框下） */
function formPathOf(path: string): RegistrationFormPath | null {
  const fee = /^fees\.(\w+)$/.exec(path);
  const candidate = fee ? `fees.${fee[1]}.amount` : path;
  return (FORM_ORDER as readonly string[]).includes(candidate)
    ? (candidate as RegistrationFormPath)
    : null;
}

/** 接口返回的字段错误（400 fields）放到表单字段上，按表单顺序；认不出的字段丢掉（不会出现） */
export function formErrorsOf(fields: FieldErrors): FormError[] {
  const errors: FormError[] = [];
  for (const [path, message] of Object.entries(fields)) {
    const field = formPathOf(path);
    if (field) errors.push({ field, message });
  }
  return errors.sort((a, b) => FORM_ORDER.indexOf(a.field) - FORM_ORDER.indexOf(b.field));
}

/** 字段的叫法（错误横幅「已滚动到第一个错误「…」」）：与抽屉上的字段名一致 */
export function fieldLabel(field: RegistrationFormPath): string {
  if (field === 'method') return DRAWER.sections.method;
  if (field.startsWith('ratios.')) return DRAWER.labels.ratios;
  const fee = /^fees\.(\w+)\.amount$/.exec(field);
  if (fee) return feeItemLabels[fee[1] as FeeItem];
  return DRAWER.labels[field as keyof typeof DRAWER.labels];
}

// ---------------------------------------------------------------- 比例表与费用合计

/** 金额文字 → 分；没填为 0，不是合法金额（contracts 的 isValidAmount）为 null */
function centsOf(amount: string): number | null {
  const text = amount.trim();
  if (text === '') return 0;
  if (!isValidAmount(text)) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** 分 → 金额字符串（两位小数） */
export function amountOfCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** 分 → 美元写法（「$10.00」）：比例表与费用合计用 */
export function formatUsdCents(cents: number): string {
  return formatMoney(amountOfCents(cents), 'USD');
}

/** 费用发生日可用的各币种汇率（接口 exchange-rates 的 rates）；还没取到为 undefined */
export type RatesOn = ExchangeRatesOn['rates'] | undefined;

/** 一个费用项折算成美元（分）：没填按 0，美元原样，非美元按汇率折算（四舍五入到分，同保存时冻结的值）；不能算为 null */
function usdCentsOf(fee: FeeForm, rates: RatesOn): number | null {
  const cents = centsOf(fee.amount);
  // 没填的不登记、不用汇率；填了的非美元金额（0 也是）同保存时一样要有汇率，没有就算不出（保存时报错）
  if (cents === null || fee.amount.trim() === '' || fee.currency === 'USD') return cents;
  const conversion = conversionOf(fee, rates);
  return conversion?.kind === 'converted' ? centsOf(conversion.usd) : null;
}

/**
 * 各组的金额（分，美元）：产品成本、快递物流、其他费用（额外赔偿 + 其他）。没填按 0；非美元按费用发生日的汇率折算
 * （R-FL-06）；组里有金额填错、或非美元的汇率还没取到 / 没有时为 null（写「—」）。
 */
export function groupCents(
  fees: Readonly<Record<FeeItem, FeeForm>>,
  rates: RatesOn,
): Record<RatioGroup, number | null> {
  const out: Record<RatioGroup, number | null> = { product: 0, freight: 0, other: 0 };
  for (const item of feeItems) {
    const group = feeItemGroup[item];
    const cents = usdCentsOf(fees[item], rates);
    const current = out[group];
    out[group] = current === null || cents === null ? null : current + cents;
  }
  return out;
}

/** 四项费用的合计（分，美元）；有不能算的费用时为 null */
export function feeTotalCents(
  fees: Readonly<Record<FeeItem, FeeForm>>,
  rates: RatesOn,
): number | null {
  const groups = groupCents(fees, rates);
  return ratioGroups.reduce<number | null>(
    (sum, group) => (sum === null || groups[group] === null ? null : sum + groups[group]),
    0,
  );
}

/** 金额框下的折算（S14「非美元时下方即时显示折算美元与汇率日期」） */
export type Conversion =
  | { readonly kind: 'converted'; readonly usd: string; readonly rate: ExchangeRate }
  | { readonly kind: 'no_rate' };

/** 非美元且填了合法金额时的折算；汇率还在取、美元、没填或填错时不显示（null） */
export function conversionOf(fee: FeeForm, rates: RatesOn): Conversion | null {
  const amount = fee.amount.trim();
  if (fee.currency === 'USD' || amount === '' || !isValidAmount(amount) || !rates) return null;
  const rate = rates[fee.currency];
  return rate ? { kind: 'converted', usd: usdOf(amount, rate.rate), rate } : { kind: 'no_rate' };
}

/** 一组的两方承担（分）：工厂 = 金额 × 工厂比例（四舍五入到分），FSH = 金额 − 工厂（R-AS-08） */
export function shareCents(
  amount: number,
  factoryPercent: number,
): { fsh: number; factory: number } {
  const factory = Math.round((amount * factoryPercent) / 100);
  return { fsh: amount - factory, factory };
}
