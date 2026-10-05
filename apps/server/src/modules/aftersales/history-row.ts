import {
  feeItems,
  isValidAmount,
  ownersForStore,
  PART_QUANTITY_MAX,
  PART_QUANTITY_MIN,
  type AftersalesStatus,
  type ClaimStatus,
  type ClaimTarget,
  type Currency,
  type FactoryRatios,
  type FeeInput,
  type FeeItem,
  type HandlingMethod,
  type OwnerOption,
  type Responsibility,
  type Shipper,
  type Site,
} from '@forcome/contracts';
import Big from 'big.js';
import {
  enumByText,
  historyEnumLabels,
  HistoryImportError,
  normalizeHeader,
  normalizeText,
  type HistoryColumns,
  type HistoryEnumKind,
  type HistoryMapping,
} from './history-mapping';
import type { HistoryCell } from './history-sheet';

/*
 * 售后登记表的一行 → 一张历史导入的售后单的登记内容（PRD 第 14 节、R-AS-08，待办 27）。纯函数，不查库：
 * 店铺、负责人、生产厂由调用方先查好传进来；按费用发生日折算美元在写库时做（history-import.ts）。
 * - 原表没有的字段留空：导入后按 R-AS-08 算缺、可补登，不推断（站点、比例等都不按店铺或责任类型补）。
 * - 原表没有原币时按美元导入、原表没有费用发生日时取原登记日期，两者都记标注（导入记录与报告里写出）。
 * - 原表的退款金额、补偿金额都记在额外赔偿（R-AS-08），映射表把几列写给同一个费用项时相加。
 * - 写了却认不出的取值（店铺、处理方式、币种等）、写错的日期与金额整行报错，一次列全；负责人对不上只留空并写警告
 *   （协调者 2026-10-06 决定：补映射表别名或改表后重跑，已导入的行跳过）。
 */

type FeeField = FeeItem;
type SingleField = Exclude<keyof HistoryColumns, FeeField>;

const isFeeField = (field: keyof HistoryColumns): field is FeeField =>
  (feeItems as readonly string[]).includes(field);

/** 映射表绑到某张表的表头上：每个字段在第几列（下标从 0 起） */
export interface BoundHistoryMapping {
  readonly mapping: HistoryMapping;
  /** 表头的写法（连续空白合成一个空格），报错写「列名：…」 */
  readonly labels: readonly string[];
  readonly rowKey: readonly number[];
  readonly columns: Readonly<Partial<Record<SingleField, number>>>;
  /** 费用项可以由几列相加 */
  readonly fees: Readonly<Partial<Record<FeeField, readonly number[]>>>;
}

/**
 * 按列名在表头里找到映射表的各列（不看空白与大小写）。映射表里的列在表头里找不到、或表头里有同名的列时，
 * 整体报错（HistoryImportError），不导入任何一行。
 */
export function bindHistoryMapping(
  header: readonly string[],
  mapping: HistoryMapping,
): BoundHistoryMapping {
  const normalized = header.map(normalizeHeader);
  const duplicated = new Set(
    normalized.filter((name, index) => name !== '' && normalized.indexOf(name) !== index),
  );
  const missing = new Set<string>();
  const ambiguous = new Set<string>();
  const indexOf = (name: string): number => {
    const key = normalizeHeader(name);
    const index = normalized.indexOf(key);
    if (index < 0) missing.add(name);
    else if (duplicated.has(key)) ambiguous.add(name);
    return index;
  };
  const rowKey = mapping.rowKey.map(indexOf);
  const columns: Partial<Record<SingleField, number>> = {};
  const fees: Partial<Record<FeeField, number[]>> = {};
  for (const field of Object.keys(mapping.columns) as (keyof HistoryColumns)[]) {
    if (isFeeField(field)) {
      const names = mapping.columns[field];
      if (names !== undefined) fees[field] = (Array.isArray(names) ? names : [names]).map(indexOf);
    } else {
      const name = mapping.columns[field];
      if (name !== undefined) columns[field] = indexOf(name);
    }
  }
  if (missing.size > 0) {
    throw new HistoryImportError(`映射表里的列在表头里找不到：${[...missing].join('、')}`);
  }
  if (ambiguous.size > 0) {
    throw new HistoryImportError(`表头里有重名的列：${[...ambiguous].join('、')}`);
  }
  return {
    mapping,
    labels: header.map((name) => name.trim().replace(/\s+/g, ' ')),
    rowKey,
    columns,
    fees,
  };
}

/** 逐行转换要用的已有数据（导入开始时查一次） */
export interface HistoryLookups {
  /** 全部店铺（按店铺名认） */
  readonly stores: readonly { readonly id: string; readonly name: string }[];
  /** 在职的售后负责人与各自的店铺范围（负责人只认有该店铺数据范围的，D-24） */
  readonly owners: readonly OwnerOption[];
  /** 生产厂代码 */
  readonly factories: readonly string[];
}

/** 两个标注：原表没有原币按美元导入；原表没有费用发生日取原登记日期 */
export interface HistoryRecordNotes {
  readonly usdAssumed: boolean;
  readonly feeDateFromRegistered: boolean;
}

/** 一行转成的登记内容（没登记的为 null；金额是原币，写库时按费用发生日折算美元） */
export interface HistoryRecord {
  /** 行标识（映射表 rowKey 各列的值，用「 / 」连接）：重跑时据此跳过已导入的行 */
  readonly key: string;
  /** 原登记日期：售后单号的日期取它（编号序号全局递增） */
  readonly registeredDate: string;
  /** 费用发生日：原表的，没有时为原登记日期 */
  readonly feeDate: string;
  readonly status: AftersalesStatus;
  readonly completedAt: Date | null;
  readonly cancelReason: string | null;
  readonly cancelledAt: Date | null;
  /** 取消时保留的费用项；原表没写为 null（已登记的全部保留） */
  readonly keptFees: readonly FeeItem[] | null;
  readonly storeId: string;
  readonly site: Site | null;
  readonly orderNumber: string | null;
  readonly customerName: string | null;
  readonly registeredByName: string | null;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly method: HandlingMethod | null;
  readonly responsibility: Responsibility | null;
  readonly responsibilityReason: string | null;
  readonly factoryCode: string | null;
  readonly partSku: string | null;
  readonly partQuantity: number | null;
  readonly shipper: Shipper | null;
  readonly carrier: string | null;
  readonly shipDate: string | null;
  readonly trackingNumber: string | null;
  readonly claimTarget: ClaimTarget | null;
  readonly claimStatus: ClaimStatus | null;
  readonly fees: Readonly<Record<FeeItem, FeeInput>>;
  readonly factoryRatios: FactoryRatios | null;
  readonly notes: HistoryRecordNotes;
  /** 导入了但要人留意的事（例如负责人对不上已留空） */
  readonly warnings: readonly string[];
}

export type ParsedHistoryRow =
  | { readonly ok: true; readonly record: HistoryRecord }
  | { readonly ok: false; readonly key: string | null; readonly errors: readonly string[] };

/** 映射表没写某列时报错用的字段叫法（只有「状态」会用到：没有状态列、也没有默认状态） */
const FIELD_LABELS: Partial<Record<SingleField, string>> = { status: '状态' };

/** 一行 → 登记内容或这一行的全部错误 */
export function parseHistoryRow(
  bound: BoundHistoryMapping,
  cells: readonly HistoryCell[],
  lookups: HistoryLookups,
): ParsedHistoryRow {
  const { mapping } = bound;
  const errors: string[] = [];
  const warnings: string[] = [];
  const cellAt = (index: number | undefined): HistoryCell =>
    index === undefined ? null : (cells[index] ?? null);
  const raw = (field: SingleField) => cellAt(bound.columns[field]);
  const labelOf = (field: SingleField) => {
    const index = bound.columns[field];
    return index === undefined ? (FIELD_LABELS[field] ?? field) : (bound.labels[index] ?? field);
  };
  const fail = (field: SingleField, message: string) =>
    errors.push(`${labelOf(field)}：${message}`);
  const text = (field: SingleField) => textOf(raw(field));

  const date = (field: SingleField, required = false): CalendarDateTime | null => {
    const cell = raw(field);
    if (isBlank(cell)) {
      if (required) fail(field, '没写');
      return null;
    }
    const parsed = dateTimeOf(cell);
    if (!parsed) fail(field, `「${display(cell)}」不是日期`);
    return parsed;
  };

  const lookup = <K extends HistoryEnumKind>(
    kind: K,
    written: string,
  ): EnumValue<K> | undefined => {
    const target = aliasOf(mapping.values[kind], written) ?? written;
    return enumByText(historyEnumLabels[kind] as Readonly<Record<EnumValue<K>, string>>, target);
  };
  const choice = <K extends HistoryEnumKind>(field: SingleField, kind: K): EnumValue<K> | null => {
    const written = text(field);
    if (written === null) return null;
    const found = lookup(kind, written);
    if (found === undefined) fail(field, `「${written}」认不出`);
    return found ?? null;
  };

  // 行标识与原登记日期
  const keyParts = bound.rowKey.map((index) => textOf(cellAt(index)));
  const key = keyParts.every((part) => part !== null) ? keyParts.join(' / ') : null;
  if (key === null) errors.push(`行标识（${mapping.rowKey.join('、')}）没写`);
  const registered = date('registeredDate', true);

  // 店铺（按店铺名，别名在 values.store）与站点
  let storeId: string | null = null;
  const storeWritten = text('store');
  if (storeWritten === null) {
    fail('store', '没写');
  } else {
    const name = normalizeText(aliasOf(mapping.values.store, storeWritten) ?? storeWritten);
    const store = lookups.stores.find((s) => normalizeText(s.name) === name);
    if (store) storeId = store.id;
    else fail('store', `「${storeWritten}」认不出`);
  }
  const site = choice('site', 'site');

  const orderNumber = text('orderNumber');
  const customerName = text('customerName');
  const registeredByName = text('registeredBy');
  const method = choice('method', 'method');
  const responsibility = choice('responsibility', 'responsibility');
  const responsibilityReason = text('responsibilityReason');

  // 生产厂（代码，别名在 values.factory）
  let factoryCode: string | null = null;
  const factoryWritten = text('factory');
  if (factoryWritten !== null) {
    const code = normalizeText(aliasOf(mapping.values.factory, factoryWritten) ?? factoryWritten);
    const found = lookups.factories.find((f) => normalizeText(f) === code);
    if (found) factoryCode = found;
    else fail('factory', `「${factoryWritten}」认不出`);
  }

  // 寄件一节
  const partSku = text('partSku');
  let partQuantity: number | null = null;
  const quantityCell = raw('partQuantity');
  if (!isBlank(quantityCell)) {
    const quantity = integerOf(quantityCell);
    if (quantity === null || quantity < PART_QUANTITY_MIN || quantity > PART_QUANTITY_MAX) {
      fail(
        'partQuantity',
        `「${display(quantityCell)}」不是 ${PART_QUANTITY_MIN}–${PART_QUANTITY_MAX} 的整数`,
      );
    } else {
      partQuantity = quantity;
    }
  }
  const shipper = choice('shipper', 'shipper');
  const carrier = text('carrier');
  const shipDate = date('shipDate')?.date ?? null;
  const trackingNumber = text('trackingNumber');
  const claimTarget = choice('claimTarget', 'claimTarget');
  const claimStatus = choice('claimStatus', 'claimStatus');

  // 原币与四个费用项（几列写给同一个费用项时相加）
  const currencyWritten = text('currency');
  const currency: Currency | null = choice('currency', 'currency');
  const amounts = {} as Record<FeeItem, string | null>;
  for (const item of feeItems) {
    let sum: Big | null = null;
    let invalid = false;
    for (const index of bound.fees[item] ?? []) {
      const cell = cellAt(index);
      if (isBlank(cell)) continue;
      const amount = amountOf(cell);
      if (amount === null) {
        errors.push(`${bound.labels[index] ?? item}：「${display(cell)}」不是金额`);
        invalid = true;
      } else {
        sum = (sum ?? new Big(0)).plus(amount);
      }
    }
    const total = invalid || sum === null ? null : sum.toFixed(2);
    if (total !== null && !isValidAmount(total)) {
      errors.push(`${item}：合计 ${total} 超出金额范围`);
      amounts[item] = null;
    } else {
      amounts[item] = total;
    }
  }
  const usdAssumed = currencyWritten === null && feeItems.some((item) => amounts[item] !== null);
  const feeCurrency: Currency = currency ?? 'USD';
  const fees = Object.fromEntries(
    feeItems.map((item) => [item, { amount: amounts[item], currency: feeCurrency }]),
  ) as Record<FeeItem, FeeInput>;

  // 费用发生日：原表没有时取原登记日期（汇率也按它取，PRD 第 14 节）
  const feeDateCell = raw('feeDate');
  const feeDateWritten = date('feeDate');
  const feeDateFromRegistered = isBlank(feeDateCell);

  // 承担比例（工厂一侧）：一列三组相同，或三组各一列
  let factoryRatios: FactoryRatios | null = null;
  const percent = (field: SingleField): number | null | 'invalid' => {
    const cell = raw(field);
    if (isBlank(cell)) return null;
    const value = percentOf(cell);
    if (value === null) {
      fail(field, `「${display(cell)}」不是 0–100 的整数`);
      return 'invalid';
    }
    return value;
  };
  if (bound.columns.factoryPct !== undefined) {
    const value = percent('factoryPct');
    if (typeof value === 'number') factoryRatios = { product: value, freight: value, other: value };
  } else if (bound.columns.productFactoryPct !== undefined) {
    const product = percent('productFactoryPct');
    const freight = percent('freightFactoryPct');
    const other = percent('otherFactoryPct');
    const values = [product, freight, other];
    if (values.every((value) => typeof value === 'number')) {
      factoryRatios = {
        product: product as number,
        freight: freight as number,
        other: other as number,
      };
    } else if (values.some((value) => typeof value === 'number') && !values.includes('invalid')) {
      fail('productFactoryPct', '三组工厂承担比例没写全');
    }
  }

  // 负责人：有该店铺数据范围的售后负责人（按姓名，别名在 values.owner）；对不上留空并写警告
  let ownerId: string | null = null;
  let ownerName: string | null = null;
  const ownerWritten = text('owner');
  if (ownerWritten !== null && storeId !== null) {
    const name = normalizeText(aliasOf(mapping.values.owner, ownerWritten) ?? ownerWritten);
    const owner = ownersForStore(lookups.owners, storeId).find(
      (o) => normalizeText(o.name) === name,
    );
    if (owner) {
      ownerId = owner.id;
      ownerName = owner.name;
    } else {
      warnings.push(`负责人「${ownerWritten}」不是该店铺的售后负责人，已留空（可补登）`);
    }
  }

  // 状态（没写时按映射表的默认状态）、完成与取消
  let status: AftersalesStatus | null;
  if (text('status') === null) {
    const fallback = mapping.defaults.status;
    status = fallback ? (lookup('status', fallback) ?? null) : null;
    if (status === null) fail('status', '没写，映射表也没有默认状态');
  } else {
    status = choice('status', 'status');
  }
  const completed = date('completedAt');
  let completedAt: Date | null = null;
  if (completed && status === 'completed') completedAt = instantOf(completed);
  else if (completed && status !== null) warnings.push('不是已完成的单，完成日期不导入');

  const reason = text('cancelReason');
  const cancelled = date('cancelledAt');
  const keptWritten = text('keptFees');
  let cancelReason: string | null = null;
  let cancelledAt: Date | null = null;
  let keptFees: FeeItem[] | null = null;
  if (status === 'cancelled') {
    cancelReason = reason;
    cancelledAt = cancelled ? instantOf(cancelled) : null;
    if (keptWritten !== null) {
      const kept = new Set<FeeItem>();
      for (const token of keptWritten.split(/[、,，;；/\s]+/).filter(Boolean)) {
        const item = lookup('feeItem', token);
        if (item === undefined) fail('keptFees', `「${token}」认不出`);
        else kept.add(item);
      }
      keptFees = feeItems.filter((item) => kept.has(item));
    }
  } else if (status !== null && (reason !== null || cancelled !== null || keptWritten !== null)) {
    warnings.push('不是已取消的单，取消原因与日期不导入');
  }

  if (errors.length > 0 || key === null || registered === null || storeId === null || !status) {
    return { ok: false, key, errors };
  }
  return {
    ok: true,
    record: {
      key,
      registeredDate: registered.date,
      feeDate: feeDateWritten?.date ?? registered.date,
      status,
      completedAt,
      cancelReason,
      cancelledAt,
      keptFees,
      storeId,
      site,
      orderNumber,
      customerName,
      registeredByName,
      ownerId,
      ownerName,
      method,
      responsibility,
      responsibilityReason,
      factoryCode,
      partSku,
      partQuantity,
      shipper,
      carrier,
      shipDate,
      trackingNumber,
      claimTarget,
      claimStatus,
      fees,
      factoryRatios,
      notes: { usdAssumed, feeDateFromRegistered },
      warnings,
    },
  };
}

/** 原表这一行的原值（表头 → 单元格文字，空的不留），存进导入记录供追溯 */
export function sourceValuesOf(
  bound: BoundHistoryMapping,
  cells: readonly HistoryCell[],
): Record<string, string> {
  const values: Record<string, string> = {};
  bound.labels.forEach((label, index) => {
    const value = textOf(cells[index] ?? null);
    if (value !== null && label !== '') values[label] = value;
  });
  return values;
}

type EnumValue<K extends HistoryEnumKind> = keyof (typeof historyEnumLabels)[K] & string;

/** 别名表里的标准取值（不分大小写、不看多余空白）；没配别名为 undefined */
function aliasOf(
  aliases: Readonly<Record<string, string>> | undefined,
  written: string,
): string | undefined {
  if (!aliases) return undefined;
  const wanted = normalizeText(written);
  return Object.entries(aliases).find(([alias]) => normalizeText(alias) === wanted)?.[1];
}

const isBlank = (cell: HistoryCell) =>
  cell === null || (typeof cell === 'string' && cell.trim() === '');

/** 单元格写成文字（日期写 YYYY-MM-DD，有时刻的接上时刻）；空为 null */
function textOf(cell: HistoryCell): string | null {
  if (isBlank(cell)) return null;
  return display(cell);
}

/** 报错里引用原表的写法 */
function display(cell: HistoryCell): string {
  if (cell instanceof Date) {
    const value = dateTimeOf(cell);
    if (!value) return String(cell);
    return value.time ? `${value.date} ${value.time.slice(0, 5)}` : value.date;
  }
  return typeof cell === 'string' ? cell.trim() : String(cell);
}

/** 日历日期与可选的时刻（原表写的，按北京时间理解） */
interface CalendarDateTime {
  readonly date: string;
  readonly time: string | null;
}

const DATE_PATTERN =
  /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

function isCalendarDate(date: string): boolean {
  const instant = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === date;
}

/**
 * 日期单元格（exceljs 按 UTC 给出，年月日时分就是原表看到的值）或「2026-03-02」「2026/3/2」「2026.3.2」「2026年3月2日」，
 * 可接「 09:05」；Excel 的日期序号（纯数值）不认
 */
function dateTimeOf(cell: HistoryCell): CalendarDateTime | null {
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return null;
    const iso = cell.toISOString();
    const time = iso.slice(11, 19);
    return { date: iso.slice(0, 10), time: time === '00:00:00' ? null : time };
  }
  if (typeof cell !== 'string') return null;
  const match = DATE_PATTERN.exec(cell.trim());
  if (!match) return null;
  const [, year, month = '', day = '', hour, minute, second] = match;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (!isCalendarDate(date)) return null;
  if (hour === undefined) return { date, time: null };
  const [h, m, s] = [Number(hour), Number(minute), Number(second ?? 0)];
  if (h > 23 || m > 59 || s > 59) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return { date, time: `${pad(h)}:${pad(m)}:${pad(s)}` };
}

/** 原表的日期与时刻按北京时间换成时刻（只有日期的取当天 0 点） */
function instantOf(value: CalendarDateTime): Date {
  return new Date(`${value.date}T${value.time ?? '00:00:00'}+08:00`);
}

/**
 * 金额（原币，不为负）：Excel 数值四舍五入到分（消掉浮点误差）；文字可带千分位，最多两位小数。
 * 带币种符号的写法不认（墨西哥比索也写 $，猜不准）
 */
function amountOf(cell: HistoryCell): string | null {
  let amount: string;
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell) || cell < 0) return null;
    amount = new Big(cell).round(2, Big.roundHalfUp).toFixed(2);
  } else if (typeof cell === 'string') {
    const written = cell.trim();
    if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(written)) return null;
    amount = new Big(written.replaceAll(',', '')).toFixed(2);
  } else {
    return null;
  }
  return isValidAmount(amount) ? amount : null;
}

function integerOf(cell: HistoryCell): number | null {
  if (typeof cell === 'number') return Number.isInteger(cell) ? cell : null;
  if (typeof cell === 'string' && /^\d+$/.test(cell.trim())) return Number(cell.trim());
  return null;
}

/** 0–100 的整数，可带 %（百分比格式的单元格读表时已写成「50%」） */
function percentOf(cell: HistoryCell): number | null {
  const written = typeof cell === 'number' ? String(cell) : typeof cell === 'string' ? cell : '';
  const match = /^(\d{1,3})\s*%?$/.exec(written.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return value <= 100 ? value : null;
}
