import path from 'node:path';
import ExcelJS from 'exceljs';

/*
 * 售后登记表的合成样本（待办 27；客户的真实登记表还没到，2026-10-05 用户口径）：按规格、PRD 第 14 节与 R-AS-08 造的有代表性的
 * 一张表，作为导入命令的测试夹具，也用于开发测试环境试运行。register-sample.xlsx 由本文件生成
 * （pnpm --filter @forcome/server history:sample），test/history-import-sample.test.ts 核对两者一致。
 * 每行覆盖的情形写在行旁；店铺、负责人、生产厂、配件取示例数据（Forcome Direct 等四个店铺，售后负责人王磊）。
 * 测试用的映射表是同目录的 mapping.json（与随镜像打包的映射表分开：真实表到位后只改后者，不动测试）。
 */

export const SAMPLE_FILE = path.join(import.meta.dirname, 'register-sample.xlsx');
export const SAMPLE_MAPPING_FILE = path.join(import.meta.dirname, 'mapping.json');
export const SAMPLE_SHEET = '售后登记';

/** 单元格：文字、数值、日期（写成 Excel 日期）、公式（带计算结果）、百分比格式的数值（1 = 100%）、空 */
export type SampleCell =
  | string
  | number
  | Date
  | null
  | { readonly formula: string; readonly result: number }
  | { readonly percent: number };

export const SAMPLE_HEADER = [
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
] as const;
export type SampleColumn = (typeof SAMPLE_HEADER)[number];
export type SampleRow = Partial<Record<SampleColumn, SampleCell>>;

/** Excel 日期（年、月、日，按原表看到的日期） */
const day = (year: number, month: number, date: number) =>
  new Date(Date.UTC(year, month - 1, date));

/** 第 2 行起逐行（空对象是一行空行，导入时跳过） */
export const SAMPLE_ROWS: readonly SampleRow[] = [
  // 第 2 行：登记齐全的寄配件（美元；产品成本是公式、比例是百分比格式）
  {
    登记编号: 'H-001',
    登记日期: day(2026, 3, 2),
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
    寄出日期: day(2026, 3, 3),
    快递单号: '1Z4R28830358220001',
    币种: '美元',
    产品成本: { formula: '1.6*2', result: 3.2 },
    运费: 6.8,
    补偿金额: 0,
    其他费用: 0,
    费用发生日: day(2026, 3, 2),
    工厂承担比例: { percent: 1 },
    负责人: '王磊',
    登记人: '李婷',
    状态: '完成',
    完成日期: day(2026, 3, 6),
  },
  // 第 3 行：比索的退款（退款金额 → 额外赔偿），按原表的费用发生日 03-03 取汇率（不是登记日 03-04）
  {
    登记编号: 'H-002',
    登记日期: day(2026, 3, 4),
    店铺: 'forcome.mx',
    站点: '墨西哥',
    订单号: '#M1201',
    客户: 'María López',
    处理方式: '退款',
    责任: '客户原因',
    币种: '比索',
    产品成本: 0,
    运费: 0,
    退款金额: 889,
    其他费用: 0,
    费用发生日: '2026/3/3',
    工厂承担比例: 0,
    负责人: '王磊',
    登记人: '李婷',
    状态: '已完成',
    完成日期: day(2026, 3, 5),
    备注: '客户要求退款，未退货',
  },
  // 第 4 行：加元，原表没有费用发生日 → 取原登记日期 03-10 作费用发生日并按它取汇率
  {
    登记编号: 'H-003',
    登记日期: day(2026, 3, 10),
    店铺: 'forcome.com',
    站点: '加拿大',
    订单号: '#1088',
    客户: 'Liam Chen',
    处理方式: '调整安装',
    责任: '客户原因',
    币种: '加元',
    产品成本: 0,
    运费: 12,
    补偿金额: 5,
    其他费用: 0,
    工厂承担比例: 0,
    负责人: '王磊',
    登记人: '陈晨',
    状态: '完成',
    完成日期: day(2026, 3, 12),
  },
  // 第 5 行：原表没有币种 → 按美元导入并标注；缺负责人、快递单号、其他费用（导入后算缺、可补登）
  {
    登记编号: 'H-004',
    登记日期: day(2026, 3, 16),
    店铺: 'Auto US',
    站点: 'US',
    订单号: '114-2345678-2345678',
    客户: 'Ava Johnson',
    处理方式: '寄配件',
    责任: '质量问题',
    生产厂: 'FZJ',
    '配件 SKU': 'FC-V2-CB01',
    数量: 2,
    发货方: '工厂',
    承运方式: 'USPS',
    寄出日期: day(2026, 3, 17),
    产品成本: 15,
    运费: 9.5,
    补偿金额: 0,
    费用发生日: day(2026, 3, 16),
    工厂承担比例: 100,
    登记人: '陈晨',
    状态: '完成',
    完成日期: day(2026, 3, 20),
  },
  // 第 6 行：物流问题的部分补偿，退款金额与补偿金额两列相加记在额外赔偿（CA$15.00）；索赔对象与状态
  {
    登记编号: 'H-005',
    登记日期: day(2026, 4, 1),
    店铺: 'Forcome Direct',
    站点: '加拿大',
    订单号: '702-3456789-3456789',
    客户: 'Noah Wilson',
    处理方式: '部分补偿',
    责任: '物流',
    币种: 'CAD',
    产品成本: 0,
    运费: 0,
    退款金额: 10,
    补偿金额: 5,
    其他费用: 0,
    费用发生日: day(2026, 4, 2),
    工厂承担比例: 0,
    索赔对象: '承运商',
    索赔状态: '索赔中',
    负责人: '王磊',
    登记人: '周敏',
    状态: '完成',
    完成日期: day(2026, 4, 3),
  },
  // 第 7 行：空行
  {},
  // 第 8 行：缺责任理由、承担比例；退款登记成 0（R-AS-08：退款须大于 0，算缺）；负责人对不上 → 留空并警告
  {
    登记编号: 'H-006',
    登记日期: day(2026, 4, 8),
    店铺: 'forcome.com',
    站点: 'US',
    订单号: '#1102',
    客户: 'Emma Davis',
    处理方式: '退款',
    责任: '其他',
    币种: 'USD',
    产品成本: 0,
    运费: 0,
    退款金额: 0,
    其他费用: 0,
    费用发生日: day(2026, 4, 8),
    负责人: '张伟',
    登记人: '周敏',
    状态: '完成',
    完成日期: '2026-04-09 16:20',
  },
  // 第 9 行：已取消（比索）：费用发生日 05-09 是周六，取此前最近的 05-08 的汇率；取消时只保留了运费
  {
    登记编号: 'H-007',
    登记日期: day(2026, 5, 12),
    店铺: 'Forcome Direct',
    站点: 'MX',
    订单号: '701-4567890-4567890',
    客户: 'Sofía Hernández',
    处理方式: '补发配件',
    责任: '质量问题',
    生产厂: 'FQD',
    '配件 SKU': 'FC-V2-HS02',
    数量: 1,
    发货方: '易仓',
    承运方式: 'DHL',
    寄出日期: day(2026, 5, 13),
    快递单号: 'MX-DHL-0001',
    币种: 'MXN',
    产品成本: 120,
    运费: 260,
    补偿金额: 0,
    其他费用: 0,
    费用发生日: '2026-05-09',
    工厂承担比例: { percent: 1 },
    负责人: '王磊',
    登记人: '李婷',
    状态: '取消',
    取消原因: '客户撤回，配件已寄出',
    取消日期: day(2026, 5, 14),
    取消时保留的费用: '运费',
  },
  // 第 10 行：进行中
  {
    登记编号: 'H-008',
    登记日期: day(2026, 6, 20),
    店铺: 'forcome.com',
    站点: 'US',
    订单号: '#1150',
    客户: 'Olivia Brown',
    处理方式: '调整安装',
    责任: '客户原因',
    币种: 'USD',
    产品成本: 0,
    运费: 0,
    补偿金额: 0,
    其他费用: 0,
    费用发生日: day(2026, 6, 19),
    工厂承担比例: 0,
    负责人: '王磊',
    状态: '处理中',
  },
  // 第 11 行：原表没写状态 → 按映射表的默认状态（已完成），没有完成日期
  {
    登记编号: 'H-009',
    登记日期: '2026.7.1',
    店铺: 'forcome.com',
    站点: 'US',
    订单号: '#1188',
    客户: 'Lucas Martin',
    处理方式: '调整安装',
    责任: '客户原因',
    币种: 'USD',
    产品成本: 0,
    运费: 0,
    补偿金额: 0,
    其他费用: 0,
    费用发生日: '2026.7.1',
    工厂承担比例: 0,
    负责人: '王磊',
  },
  // 第 12 行：9 月（演示时刻的当月）完成、登记齐全：不计入当月登记完整率
  {
    登记编号: 'H-010',
    登记日期: day(2026, 9, 5),
    店铺: 'Forcome Direct',
    站点: 'US',
    订单号: '113-5678901-5678901',
    客户: 'Mason Lee',
    处理方式: '寄配件',
    责任: '质量问题',
    生产厂: 'FQD',
    '配件 SKU': 'FC-V2-DC01',
    数量: 1,
    发货方: '易仓',
    承运方式: 'UPS Ground',
    寄出日期: day(2026, 9, 5),
    快递单号: '1Z4R28830358220010',
    币种: 'USD',
    产品成本: 4.5,
    运费: 6.8,
    补偿金额: 0,
    其他费用: 0,
    费用发生日: day(2026, 9, 5),
    工厂承担比例: { percent: 1 },
    负责人: '王磊',
    状态: '已完成',
    完成日期: day(2026, 9, 7),
  },
  // 第 13 行：9 月完成、缺负责人：不计入完整率，也不在「筛出缺字段」里，但台账照常标「缺 1 项」
  {
    登记编号: 'H-011',
    登记日期: day(2026, 9, 8),
    店铺: 'forcome.mx',
    站点: 'MX',
    订单号: '#M1300',
    客户: 'Diego Ramírez',
    处理方式: '退款',
    责任: '客户原因',
    币种: '比索',
    产品成本: 0,
    运费: 0,
    退款金额: 450,
    其他费用: 0,
    费用发生日: day(2026, 9, 8),
    工厂承担比例: 0,
    状态: '完成',
    完成日期: day(2026, 9, 9),
  },
  // 第 14 行：店铺认不出 → 整行报错
  {
    登记编号: 'H-012',
    登记日期: day(2026, 4, 15),
    店铺: 'Forcome EU',
    订单号: '#E0001',
    处理方式: '调整安装',
    状态: '完成',
  },
  // 第 15 行：没写登记日期 → 整行报错
  { 登记编号: 'H-013', 店铺: 'forcome.com', 订单号: '#1201', 处理方式: '调整安装' },
  // 第 16 行：金额写成文字、币种认不出 → 整行报错，两个错误一起列出
  {
    登记编号: 'H-014',
    登记日期: day(2026, 4, 20),
    店铺: 'forcome.com',
    处理方式: '调整安装',
    币种: '欧元',
    运费: '约 12 元',
  },
  // 第 17 行：行标识与第 6 行重复 → 报错
  {
    登记编号: 'H-005',
    登记日期: day(2026, 4, 21),
    店铺: 'Forcome Direct',
    处理方式: '部分补偿',
  },
  // 第 18 行：处理方式认不出（映射表没有「换货」的别名）→ 整行报错
  {
    登记编号: 'H-015',
    登记日期: day(2026, 4, 22),
    店铺: 'forcome.com',
    处理方式: '换货',
  },
];

/** 一张售后登记表的工作簿（表头 + 行）；测试里另造的小表也用它 */
export function sampleWorkbook(
  rows: readonly SampleRow[] = SAMPLE_ROWS,
  header: readonly string[] = SAMPLE_HEADER,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SAMPLE_SHEET);
  sheet.addRow([...header]);
  for (const sampleRow of rows) {
    const values = header.map((name) => (sampleRow as Record<string, SampleCell>)[name] ?? null);
    const row = sheet.addRow(values.map((value) => (isPercent(value) ? value.percent : value)));
    values.forEach((value, index) => {
      const cell = row.getCell(index + 1);
      if (value instanceof Date) cell.numFmt = 'yyyy-mm-dd';
      if (isPercent(value)) cell.numFmt = '0%';
    });
  }
  return workbook;
}

function isPercent(value: SampleCell): value is { readonly percent: number } {
  return typeof value === 'object' && value !== null && 'percent' in value;
}
