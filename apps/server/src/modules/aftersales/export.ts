import {
  aftersalesStatusLabels,
  feeItemLabels,
  feeItems,
  formatMoney,
  formatRate,
  handlingMethodLabels,
  ledgerColumnLabels,
  ledgerColumns,
  ledgerFinanceColumns,
  ledgerItemSchema,
  missingItemLabels,
  partLabel,
  ratioWords,
  responsibilityLabels,
  storeSiteLabel,
  stripFinanceFields,
  type FeeDateRange,
  type FeeItem,
  type LedgerColumn,
  type LedgerItem,
  type LedgerQuery,
  type LedgerTotals,
  type RegistrationField,
} from '@forcome/contracts';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { recordAudit, transaction, type Runtime } from '../core';
import type { Access } from '../org';
import { businessMonth, listLedger } from './ledger';

/*
 * 导出 Excel（PRD P13「第一阶段」、S11、K5、规格「导出」）：按当前筛选与字段权限，服务端用 exceljs 同步生成后直接下载，
 * 不留存文件；导出记审计（对象类型「导出」，P27 写「导出 · 登记台账 · 导出 Excel」）。
 * 列与台账相同（17 列，含默认隐藏的四列，不随列设置变化），坐席不含七个金额列（P13「第一阶段」）；
 * 悬停里的内容另列：缺失字段（「缺 N 项」），有财务权限时另有承担比例、原币与汇率、取消时没有保留的费用，末行合计。
 * 金额写计入售后成本的美元值（与台账一致：已取消的单只计保留的部分），数值格式便于在 Excel 里再求和。
 */

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 已完成的单缺这个字段时写的（同台账的「待回填」） */
const PENDING = '待回填';
const MONEY_FORMAT = '"$"#,##0.00';
const SHEET_NAME = '登记台账';

type Cell = string | number | null;

/** 一列：表头、列宽（字符数）、取值；金额列（total 为合计行取的合计项）按美元数值格式 */
interface ExportColumn {
  readonly header: string;
  readonly width: number;
  readonly total?: Exclude<keyof LedgerTotals, 'count'>;
  readonly value: (item: LedgerItem) => Cell;
}

/** 有值写值；已完成的单缺这个字段写「待回填」；其余留空 */
function valueOr(item: LedgerItem, field: RegistrationField, value: Cell): Cell {
  if (value !== null && value !== '') return value;
  return item.missing.includes(field) ? PENDING : null;
}

/** 金额（美元数值）：计入售后成本的值；没登记的同台账（已完成缺的写「待回填」，其余留空） */
function money(item: LedgerItem, field: RegistrationField | null, amount: string | null): Cell {
  if (amount !== null) return Number(amount);
  return field && item.missing.includes(field) ? PENDING : null;
}

const feeCell =
  (key: FeeItem) =>
  (item: LedgerItem): Cell =>
    money(item, `fees.${key}`, item.cost?.[key] ?? null);

/** 台账 17 列的取值（与 P13 的单元格同一套写法） */
const COLUMN_VALUES: Record<LedgerColumn, Omit<ExportColumn, 'header'>> = {
  number: { width: 18, value: (item) => item.number },
  customer: { width: 18, value: (item) => valueOr(item, 'customerName', item.customerName) },
  storeSite: {
    width: 22,
    value: (item) =>
      item.site === null && item.missing.includes('site')
        ? `${item.store.name} · ${PENDING}`
        : storeSiteLabel(item.store.name, item.site),
  },
  method: {
    width: 14,
    value: (item) => valueOr(item, 'method', item.method && handlingMethodLabels[item.method]),
  },
  responsibility: {
    width: 14,
    value: (item) =>
      valueOr(
        item,
        'responsibility',
        item.responsibility && responsibilityLabels[item.responsibility],
      ),
  },
  status: { width: 10, value: (item) => aftersalesStatusLabels[item.status] },
  owner: { width: 10, value: (item) => valueOr(item, 'ownerId', item.ownerName) },
  factory: { width: 10, value: (item) => valueOr(item, 'factory', item.factory) },
  part: { width: 30, value: (item) => valueOr(item, 'part', item.part && partLabel(item.part)) },
  trackingNumber: {
    width: 22,
    value: (item) => valueOr(item, 'trackingNumber', item.trackingNumber),
  },
  productCost: { width: 12, total: 'productCost', value: feeCell('productCost') },
  freight: { width: 12, total: 'freight', value: feeCell('freight') },
  compensation: { width: 12, total: 'compensation', value: feeCell('compensation') },
  otherCost: { width: 12, total: 'otherCost', value: feeCell('otherCost') },
  feeTotal: {
    width: 12,
    total: 'total',
    value: (item) => money(item, null, item.cost?.total ?? null),
  },
  fshShare: {
    width: 12,
    total: 'fsh',
    value: (item) => money(item, 'ratios', item.cost?.fsh ?? null),
  },
  factoryShare: {
    width: 12,
    total: 'factory',
    value: (item) => money(item, 'ratios', item.cost?.factory ?? null),
  },
};

/** 非美元的费用项：「额外赔偿 MX$889.00 · 汇率 2026-09-10（1 USD = 18.00 MXN）」，手工修改的注明 */
function foreignAmounts(item: LedgerItem): string | null {
  const lines = feeItems.flatMap((key) => {
    const fee = item.fees?.[key];
    if (!fee?.rate) return [];
    const manual = fee.rate.source === 'manual' ? '，手工修改' : '';
    return [
      `${feeItemLabels[key]} ${formatMoney(fee.amount, fee.currency)} · 汇率 ${fee.rate.date}（1 USD = ${formatRate(fee.rate.rate)} ${fee.currency}${manual}）`,
    ];
  });
  return lines.length > 0 ? lines.join('；') : null;
}

/** 已取消的单取消时没有保留的费用项与原登记额（不计入售后成本） */
function notKept(item: LedgerItem): string | null {
  if (!item.keptFees) return null;
  const lines = feeItems.flatMap((key) => {
    const fee = item.fees?.[key];
    if (!fee || item.keptFees?.includes(key)) return [];
    return [`${feeItemLabels[key]} ${formatMoney(fee.usd, 'USD')}`];
  });
  return lines.length > 0 ? lines.join('、') : null;
}

/** 台账之外另列的说明（悬停里的内容） */
const MISSING_COLUMN: ExportColumn = {
  header: '缺失字段',
  width: 24,
  value: (item) => missingItemLabels(item.missing).join('、') || null,
};
const FINANCE_EXTRA_COLUMNS: readonly ExportColumn[] = [
  {
    header: '承担比例',
    width: 30,
    value: (item) => (item.ratios ? ratioWords(item.ratios) : null),
  },
  { header: '原币与汇率', width: 48, value: foreignAmounts },
  { header: '取消时未保留', width: 24, value: notKept },
];

/** 文件名（S11 例「登记台账_20260901-20260911.xlsx」）：按这次的费用发生日起止；筛出缺字段时按完整率的月份 */
export function ledgerExportFileName(range: FeeDateRange | null, now: Date): string {
  const day = (date: string) => date.replaceAll('-', '');
  return range
    ? `登记台账_${day(range.from)}-${day(range.to)}.xlsx`
    : `登记台账_缺字段的已完成单_${businessMonth(now)}.xlsx`;
}

/** 生成工作簿：表头、各行、（有财务权限时）合计行；冻结表头与首列（同台账「首列与合计行固定」） */
async function workbookOf(
  items: readonly LedgerItem[],
  totals: LedgerTotals | null,
  finance: boolean,
): Promise<Uint8Array<ArrayBuffer>> {
  const columns: ExportColumn[] = [
    ...ledgerColumns
      .filter((column) => finance || !ledgerFinanceColumns.has(column))
      .map((column) => ({ header: ledgerColumnLabels[column], ...COLUMN_VALUES[column] })),
    MISSING_COLUMN,
    ...(finance ? FINANCE_EXTRA_COLUMNS : []),
  ];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Forcome Support';
  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
  });
  sheet.columns = columns.map((column) => ({
    header: column.header,
    width: column.width,
    style: column.total ? { numFmt: MONEY_FORMAT } : {},
  }));
  sheet.getRow(1).font = { bold: true };
  for (const item of items) sheet.addRow(columns.map((column) => column.value(item)));
  if (totals) {
    // 合计行（与 P13 合计行一致）：首列「合计 · N 单」，金额列为各行之和
    const total = sheet.addRow(
      columns.map((column, index) => {
        if (index === 0) return `合计 · ${totals.count} 单`;
        return column.total ? Number(totals[column.total]) : null;
      }),
    );
    total.font = { bold: true };
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** 一次导出：文件名、行数与文件内容 */
export interface LedgerExport {
  readonly fileName: string;
  readonly count: number;
  readonly body: Uint8Array<ArrayBuffer>;
}

/**
 * 导出 P13 台账（店铺范围内；店铺筛选的越权由接口先用 access.requireStores 把关）：取与列表相同的行与合计，按查看者的权限
 * 去掉财务字段后生成文件，记一条审计（筛选条件、行数、文件名、是否含财务字段）
 */
export async function exportLedger(
  runtime: Runtime,
  access: Access,
  query: LedgerQuery,
): Promise<LedgerExport> {
  const now = runtime.clock.now();
  const { items, totals, range } = await listLedger(runtime.db, access.stores, query, now);
  const finance = access.financeVisible;
  const visible = stripFinanceFields(z.array(ledgerItemSchema), items, finance);
  const body = await workbookOf(visible, finance ? totals : null, finance);
  const fileName = ledgerExportFileName(range, now);
  await transaction(runtime, (tx) =>
    recordAudit(tx, access.actor, {
      action: 'export.excel',
      objectType: 'export',
      objectId: 'aftersales.ledger',
      objectLabel: SHEET_NAME,
      storeId: query.store ?? null,
      after: {
        fileName,
        filters: { ...query, ...range },
        rows: items.length,
        financeFields: finance,
      },
    }),
  );
  return { fileName, count: items.length, body };
}
