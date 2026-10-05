import { describe, expect, it } from 'vitest';
import { defaultHistoryMapping, HistoryImportError, parseHistoryMapping } from './history-mapping';
import {
  bindHistoryMapping,
  parseHistoryRow,
  type HistoryLookups,
  type HistoryRecord,
} from './history-row';
import type { HistoryCell } from './history-sheet';

/*
 * 售后登记表的一行 → 一张历史导入的售后单（PRD 第 14 节、R-AS-08，待办 27）：按映射表认列、认取值；
 * 缺的字段留空（导入后算缺、可补登），认不出的取值整行报错（协调者 2026-10-06 决定）。不查库：店铺、负责人、生产厂由调用方给。
 */

const mapping = defaultHistoryMapping();
const HEADER = [
  '登记编号',
  '登记日期',
  '店铺',
  '站点',
  '订单号',
  '客户',
  '处理方式',
  '责任',
  '责任说明',
  '生产厂',
  '配件 SKU',
  '数量',
  '发货方',
  '承运方式',
  '寄出日期',
  '快递单号',
  '币种',
  '产品成本',
  '运费',
  '退款金额',
  '补偿金额',
  '其他费用',
  '费用发生日',
  '工厂承担比例',
  '索赔对象',
  '索赔状态',
  '负责人',
  '登记人',
  '状态',
  '完成日期',
  '取消原因',
  '取消日期',
  '取消时保留的费用',
  '备注',
];
const bound = bindHistoryMapping(HEADER, mapping);

const STORE_DIRECT = '0199a000-0000-7000-8000-000000000001';
const STORE_MX = '0199a000-0000-7000-8000-000000000002';
const WANG = '0199a000-0000-7000-8000-0000000000aa';
const ZHAO = '0199a000-0000-7000-8000-0000000000bb';
const lookups: HistoryLookups = {
  stores: [
    { id: STORE_DIRECT, name: 'Forcome Direct' },
    { id: STORE_MX, name: 'forcome.mx' },
  ],
  owners: [
    { id: WANG, name: '王磊', stores: { all: true } },
    { id: ZHAO, name: '赵倩', stores: { all: false, storeIds: [STORE_DIRECT] } },
  ],
  factories: ['FQD', 'FZJ'],
};

/** 一行（按表头给值，没给的为空） */
function cells(values: Record<string, HistoryCell>): HistoryCell[] {
  for (const key of Object.keys(values)) {
    if (!HEADER.includes(key)) throw new Error(`表头里没有「${key}」`);
  }
  return HEADER.map((h) => values[h] ?? null);
}

/** 一行登记齐全的寄配件（美元） */
const SHIPPED: Record<string, HistoryCell> = {
  登记编号: 'H-001',
  登记日期: new Date(Date.UTC(2026, 2, 2)),
  店铺: '亚马逊 Forcome Direct',
  站点: '美国',
  订单号: '113-1234567-1234567',
  客户: 'James Miller',
  处理方式: '补发配件',
  责任: '质量问题',
  生产厂: 'FQD',
  '配件 SKU': 'FC-V2-HF01',
  数量: 1,
  发货方: '易仓',
  承运方式: 'UPS Ground',
  寄出日期: '2026/3/3',
  快递单号: '1Z4R28830358220001',
  币种: '美元',
  产品成本: 3.2,
  运费: '6.80',
  补偿金额: 0,
  其他费用: 0,
  费用发生日: '2026-03-02',
  工厂承担比例: '100%',
  负责人: '王磊',
  登记人: '李婷',
  状态: '完成',
  完成日期: new Date(Date.UTC(2026, 2, 6, 15, 30)),
  备注: '客户很满意',
};

function record(values: Record<string, HistoryCell>): HistoryRecord {
  const parsed = parseHistoryRow(bound, cells(values), lookups);
  if (!parsed.ok) throw new Error(`预期能导入，却报错：${parsed.errors.join('；')}`);
  return parsed.record;
}

function errorsOf(values: Record<string, HistoryCell>): readonly string[] {
  const parsed = parseHistoryRow(bound, cells(values), lookups);
  if (parsed.ok) throw new Error('预期报错，却能导入');
  return parsed.errors;
}

describe('映射表', () => {
  it('随镜像打包的映射表合格式', () => {
    expect(mapping.rowKey).toEqual(['登记编号']);
  });

  it('写错的字段名、指向认不出的取值、默认状态写错，导入前就报出来', () => {
    const json = structuredClone(mapping) as Record<string, unknown> & {
      columns: Record<string, unknown>;
      values: Record<string, Record<string, string>>;
      defaults: Record<string, string>;
    };
    json.columns.feedate = '费用日期';
    json.values.method = { 换货: '换新' };
    json.defaults.status = '完结';
    const parse = () => parseHistoryMapping(json, 'x.json');
    expect(parse).toThrow(HistoryImportError);
    expect(parse).toThrow(/feedate/);
    expect(parse).toThrow(/「换新」不是可用的取值/);
    expect(parse).toThrow(/「完结」不是售后单的状态/);
  });

  it('映射表里的列在表头里找不到，或表头里有两列同名：整体报错，不导入任何一行', () => {
    expect(() =>
      bindHistoryMapping(
        HEADER.filter((h) => h !== '运费'),
        mapping,
      ),
    ).toThrow(/映射表里的列在表头里找不到：运费/);
    expect(() => bindHistoryMapping([...HEADER, '店铺'], mapping)).toThrow(
      /表头里有重名的列：店铺/,
    );
  });

  it('表头比较不看空白与大小写（原表表头里常有换行）', () => {
    const header = HEADER.map((h) =>
      h === '配件 SKU' ? '配件\nsku' : h === '费用发生日' ? ' 费用 发生日 ' : h,
    );
    const rebound = bindHistoryMapping(header, mapping);
    const parsed = parseHistoryRow(rebound, cells(SHIPPED), lookups);
    expect(parsed.ok && parsed.record.partSku).toBe('FC-V2-HF01');
  });
});

describe('一行 → 一张售后单', () => {
  it('按列名与别名取值：店铺、站点、处理方式、责任、发货方、币种、状态都换成标准取值', () => {
    expect(record(SHIPPED)).toEqual({
      key: 'H-001',
      registeredDate: '2026-03-02',
      feeDate: '2026-03-02',
      status: 'completed',
      completedAt: new Date('2026-03-06T15:30:00+08:00'),
      cancelReason: null,
      cancelledAt: null,
      keptFees: null,
      storeId: STORE_DIRECT,
      site: 'US',
      orderNumber: '113-1234567-1234567',
      customerName: 'James Miller',
      registeredByName: '李婷',
      ownerId: WANG,
      ownerName: '王磊',
      method: 'send_parts',
      responsibility: 'product_quality',
      responsibilityReason: null,
      factoryCode: 'FQD',
      partSku: 'FC-V2-HF01',
      partQuantity: 1,
      shipper: 'yicang',
      carrier: 'UPS Ground',
      shipDate: '2026-03-03',
      trackingNumber: '1Z4R28830358220001',
      claimTarget: null,
      claimStatus: null,
      fees: {
        productCost: { amount: '3.20', currency: 'USD' },
        freight: { amount: '6.80', currency: 'USD' },
        compensation: { amount: '0.00', currency: 'USD' },
        otherCost: { amount: '0.00', currency: 'USD' },
      },
      factoryRatios: { product: 100, freight: 100, other: 100 },
      notes: { usdAssumed: false, feeDateFromRegistered: false },
      warnings: [],
    });
  });

  it('原表没有原币：按美元导入并标注；没有金额的行不标', () => {
    const noCurrency = record({ ...SHIPPED, 币种: null });
    expect(noCurrency.fees.freight).toEqual({ amount: '6.80', currency: 'USD' });
    expect(noCurrency.notes.usdAssumed).toBe(true);
    const noFees = record({
      ...SHIPPED,
      币种: null,
      产品成本: null,
      运费: null,
      补偿金额: null,
      其他费用: null,
    });
    expect(noFees.notes.usdAssumed).toBe(false);
  });

  it('原表没有费用发生日：取原登记日期作费用发生日（汇率也按它取），并标注', () => {
    const fallback = record({ ...SHIPPED, 费用发生日: null });
    expect(fallback.feeDate).toBe('2026-03-02');
    expect(fallback.notes.feeDateFromRegistered).toBe(true);
  });

  it('原表的退款金额与补偿金额都记在额外赔偿（R-AS-08），两列相加；非美元按原币', () => {
    const refund = record({
      ...SHIPPED,
      店铺: 'forcome.mx',
      处理方式: '退款',
      币种: '比索',
      退款金额: '889.00',
      补偿金额: 50.5,
    });
    expect(refund.method).toBe('refund_or_compensation');
    expect(refund.fees.compensation).toEqual({ amount: '939.50', currency: 'MXN' });
    expect(refund.fees.freight).toEqual({ amount: '6.80', currency: 'MXN' });
    // 两列都空才算没登记
    expect(record({ ...SHIPPED, 补偿金额: null }).fees.compensation).toEqual({
      amount: null,
      currency: 'USD',
    });
  });

  it('缺的字段留空（导入后按 R-AS-08 算缺、可补登），不推断：站点、比例、快递单号、负责人', () => {
    const sparse = record({
      ...SHIPPED,
      站点: null,
      工厂承担比例: null,
      快递单号: null,
      负责人: null,
    });
    expect(sparse).toMatchObject({
      site: null,
      factoryRatios: null,
      trackingNumber: null,
      ownerId: null,
      ownerName: null,
      warnings: [],
    });
  });

  it('寄配件没写生产厂：不按配件 SKU 推出生产厂，留空（导入后算缺；协调者 2026-10-06 决定）', () => {
    expect(record({ ...SHIPPED, 生产厂: null }).factoryCode).toBeNull();
  });

  it('负责人对不上（不是该店铺的售后负责人、或不在系统）：留空并写警告', () => {
    const other = record({ ...SHIPPED, 店铺: 'forcome.mx', 负责人: '赵倩' });
    expect(other.ownerId).toBeNull();
    expect(other.warnings).toEqual(['负责人「赵倩」不是该店铺的售后负责人，已留空（可补登）']);
    expect(record({ ...SHIPPED, 负责人: '赵倩' }).ownerId).toBe(ZHAO);
    expect(record({ ...SHIPPED, 负责人: '张伟' }).warnings).toEqual([
      '负责人「张伟」不是该店铺的售后负责人，已留空（可补登）',
    ]);
  });

  it('状态没写时按映射表的默认状态；映射表也没有默认状态时报错', () => {
    expect(record({ ...SHIPPED, 状态: null }).status).toBe('completed');
    const strict = bindHistoryMapping(HEADER, { ...mapping, defaults: {} });
    const parsed = parseHistoryRow(strict, cells({ ...SHIPPED, 状态: null }), lookups);
    expect(parsed.ok ? [] : parsed.errors).toEqual(['状态：没写，映射表也没有默认状态']);
  });

  it('已取消的单：取消原因、取消日期、保留的费用项；保留项没写时为 null（按全部保留）', () => {
    const cancelled = record({
      ...SHIPPED,
      状态: '取消',
      完成日期: null,
      取消原因: '客户撤回',
      取消日期: '2026年3月4日',
      取消时保留的费用: '运费、额外赔偿',
    });
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      completedAt: null,
      cancelReason: '客户撤回',
      cancelledAt: new Date('2026-03-04T00:00:00+08:00'),
      keptFees: ['freight', 'compensation'],
    });
    expect(record({ ...SHIPPED, 状态: '取消', 完成日期: null }).keptFees).toBeNull();
  });

  it('状态对不上的完成日期、取消信息不导入，写警告', () => {
    const inProgress = record({ ...SHIPPED, 状态: '处理中', 取消原因: '误登' });
    expect(inProgress.completedAt).toBeNull();
    expect(inProgress.cancelReason).toBeNull();
    expect(inProgress.warnings).toEqual([
      '不是已完成的单，完成日期不导入',
      '不是已取消的单，取消原因与日期不导入',
    ]);
  });

  it('日期：Excel 日期、2026/3/2、2026.3.2、2026年3月2日都认；时间取北京时间', () => {
    for (const written of ['2026/3/2', '2026.3.2', '2026年3月2日', ' 2026-03-02 ']) {
      expect(record({ ...SHIPPED, 登记日期: written }).registeredDate).toBe('2026-03-02');
    }
    expect(record({ ...SHIPPED, 完成日期: '2026-03-06 09:05' }).completedAt).toEqual(
      new Date('2026-03-06T09:05:00+08:00'),
    );
  });

  it('金额：Excel 数值的浮点误差四舍五入到分，千分位可以写；比例写 100%、50 都认', () => {
    const r = record({ ...SHIPPED, 产品成本: 0.1 + 0.2, 运费: '1,234.50', 工厂承担比例: 50 });
    expect(r.fees.productCost?.amount).toBe('0.30');
    expect(r.fees.freight?.amount).toBe('1234.50');
    expect(r.factoryRatios).toEqual({ product: 50, freight: 50, other: 50 });
  });
});

describe('整行报错（认不出的取值、必填的没写；补映射表别名或改表后重跑）', () => {
  it('行标识、登记日期、店铺没写', () => {
    expect(errorsOf({ ...SHIPPED, 登记编号: null, 登记日期: null, 店铺: ' ' })).toEqual([
      '行标识（登记编号）没写',
      '登记日期：没写',
      '店铺：没写',
    ]);
  });

  it('认不出的店铺、处理方式、责任、币种、生产厂、站点、状态，一次列全', () => {
    expect(
      errorsOf({
        ...SHIPPED,
        店铺: 'Forcome EU',
        处理方式: '换货',
        责任: '天灾',
        币种: '欧元',
        生产厂: 'FXX',
        站点: '英国',
        状态: '完结',
      }),
    ).toEqual([
      '店铺：「Forcome EU」认不出',
      '站点：「英国」认不出',
      '处理方式：「换货」认不出',
      '责任：「天灾」认不出',
      '生产厂：「FXX」认不出',
      '币种：「欧元」认不出',
      '状态：「完结」认不出',
    ]);
  });

  it('日期、金额、比例、数量写得不对', () => {
    expect(
      errorsOf({
        ...SHIPPED,
        登记日期: '3月2日',
        寄出日期: 45000,
        运费: '约 12 元',
        退款金额: -5,
        工厂承担比例: '120%',
        数量: 2.5,
        取消时保留的费用: null,
      }),
    ).toEqual([
      '登记日期：「3月2日」不是日期',
      '数量：「2.5」不是 1–10 的整数',
      '寄出日期：「45000」不是日期',
      '运费：「约 12 元」不是金额',
      '退款金额：「-5」不是金额',
      '工厂承担比例：「120%」不是 0–100 的整数',
    ]);
  });

  it('取消时保留的费用写了认不出的费用项', () => {
    expect(
      errorsOf({ ...SHIPPED, 状态: '取消', 完成日期: null, 取消时保留的费用: '运费、关税' }),
    ).toEqual(['取消时保留的费用：「关税」认不出']);
  });
});
