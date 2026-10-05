import { businessDateTime } from '@forcome/calendar';
import { auditObjectTypeLabels, type AuditLogEntry, type AuditRange } from '@forcome/contracts';
import ExcelJS from 'exceljs';

/*
 * P27 的导出（PRD P27 v2.20、K5）：按当前筛选导出全部条数（不分页），查看范围与字段权限同列表（行已按查看者写好）；
 * exceljs 同步生成后直接下载，不留存文件。列同页面，另把两栏前后值各写成一列（每个字段一行「字段：值」，已隐藏写「已隐藏」）。
 */

/** 文件名（K5 的写法「报表_近7天_0905-0911.xlsx」）：今天「审计日志_今天_0911」，近 7 天、自定义写起止 */
export function auditExportFileName(range: AuditRange): string {
  const day = (date: string) => date.slice(5).replace('-', '');
  const span = range.from === range.to ? day(range.from) : `${day(range.from)}-${day(range.to)}`;
  if (range.period === 'today') return `审计日志_今天_${span}.xlsx`;
  if (range.period === 'week') return `审计日志_近7天_${span}.xlsx`;
  return `审计日志_${span}.xlsx`;
}

/** 前后值一栏：每个字段一行「字段：值」（已隐藏写「已隐藏」）；没有字段为空 */
function fieldLines(entry: AuditLogEntry, side: 'before' | 'after'): string | null {
  if (entry.fields.length === 0) return null;
  return entry.fields.map((field) => `${field.label}：${field[side] ?? '已隐藏'}`).join('\n');
}

interface ExportColumn {
  readonly header: string;
  readonly width: number;
  readonly value: (entry: AuditLogEntry) => string | null;
}

/** 导出的列：同页面的列（时间写到秒），另把两栏前后值各写成一列 */
const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { header: '时间', width: 20, value: (entry) => businessDateTime(new Date(entry.at)) },
  { header: '操作人', width: 12, value: (entry) => entry.actor.name },
  { header: '角色', width: 16, value: (entry) => entry.actor.roleText || null },
  { header: '对象类型', width: 10, value: (entry) => auditObjectTypeLabels[entry.objectType] },
  { header: '对象', width: 24, value: (entry) => entry.objectLabel },
  { header: '动作', width: 14, value: (entry) => entry.actionLabel },
  {
    header: '变更摘要',
    width: 48,
    value: (entry) => (entry.more > 0 ? `${entry.summary} 等 ${entry.more} 项` : entry.summary),
  },
  { header: '来源 IP', width: 14, value: (entry) => entry.ip },
  { header: '变更前', width: 40, value: (entry) => fieldLines(entry, 'before') },
  { header: '变更后', width: 40, value: (entry) => fieldLines(entry, 'after') },
];

/** 工作表名，也是导出记录的对象名（P27「导出 · 审计日志」） */
export const AUDIT_EXPORT_SHEET = '审计日志';
/** 越权访问被拒的动作写红字（页面上红色标出，E-24） */
const DENIED_FONT = { color: { argb: 'FFC8313B' }, bold: true };

/** 生成工作簿：表头、各行（前后值换行写），越权访问被拒的动作红字；冻结表头 */
export async function auditWorkbook(
  entries: readonly AuditLogEntry[],
): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Forcome Support';
  const sheet = workbook.addWorksheet(AUDIT_EXPORT_SHEET, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = EXPORT_COLUMNS.map((column) => ({
    header: column.header,
    width: column.width,
    style: { alignment: { vertical: 'top', wrapText: true } },
  }));
  sheet.getRow(1).font = { bold: true };
  const actionColumn = EXPORT_COLUMNS.findIndex((column) => column.header === '动作') + 1;
  for (const entry of entries) {
    const row = sheet.addRow(EXPORT_COLUMNS.map((column) => column.value(entry)));
    if (entry.denied) row.getCell(actionColumn).font = DENIED_FONT;
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
