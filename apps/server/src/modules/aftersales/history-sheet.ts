import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import Big from 'big.js';
import ExcelJS from 'exceljs';
import { HistoryImportError } from './history-mapping';

/*
 * 读售后登记表（待办 27）：.xlsx 或 UTF-8 的 .csv，用 exceljs 读成「表头 + 各行的单元格值」交给逐行转换（history-row.ts）。
 * 单元格值只留四种：文字、数值、日期（Excel 的日期单元格）、空；公式取计算结果，富文本与超链接取文字，
 * 百分比格式的数值写成「50%」（与原表看到的一致）。空行跳过。
 */

/** 一个单元格的值：Excel 的日期单元格是 Date（exceljs 按 UTC 给出，年月日时分即原表看到的值） */
export type HistoryCell = string | number | boolean | Date | null;

export interface HistorySheetRow {
  /** 原表的行号（从 1 起，表头那一行之后），报告按它写「第 N 行」 */
  readonly row: number;
  /** 按表头的列顺序 */
  readonly cells: readonly HistoryCell[];
}

export interface HistorySheet {
  /** 来源（文件名），记在导入记录里 */
  readonly name: string;
  readonly header: readonly string[];
  readonly rows: readonly HistorySheetRow[];
}

export interface ReadHistorySheetOptions {
  /** 工作表名（.xlsx）；不给取第一张 */
  readonly sheet?: string;
  /** 表头在第几行（从 1 起） */
  readonly headerRow: number;
}

/** 读 .xlsx 或 .csv；读不了、找不到工作表、CSV 不是 UTF-8 时抛 HistoryImportError */
export async function readHistorySheet(
  file: string,
  options: ReadHistorySheetOptions,
): Promise<HistorySheet> {
  const name = path.basename(file);
  const extension = path.extname(file).toLowerCase();
  const buffer = await readFile(file).catch((error: unknown) => {
    throw new HistoryImportError(`读不了表格 ${file}：${(error as Error).message}`);
  });
  const workbook = new ExcelJS.Workbook();
  let worksheet: ExcelJS.Worksheet | undefined;
  if (extension === '.xlsx') {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer).catch((error: unknown) => {
      throw new HistoryImportError(`${name} 不是有效的 .xlsx：${(error as Error).message}`);
    });
    worksheet = options.sheet ? workbook.getWorksheet(options.sheet) : workbook.worksheets[0];
    if (!worksheet) {
      throw new HistoryImportError(
        options.sheet ? `${name} 里没有工作表「${options.sheet}」` : `${name} 里没有工作表`,
      );
    }
  } else if (extension === '.csv') {
    worksheet = await workbook.csv.read(Readable.from([csvText(buffer, name)]), {
      // 不让 exceljs 猜数值与日期：一律按文字交给逐行转换，由它按字段解析
      map: (value: unknown) => value,
    });
  } else {
    throw new HistoryImportError(`只支持 .xlsx 与 .csv：${name}`);
  }
  return sheetOf(name, worksheet, options.headerRow);
}

/** CSV 只收 UTF-8（可带 BOM）；Excel 默认另存的 ANSI（GBK）CSV 中文会乱码，直接报错让人另存 */
function csvText(buffer: Buffer, name: string): string {
  try {
    // TextDecoder 默认去掉开头的 BOM
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new HistoryImportError(
      `${name} 不是 UTF-8 编码：请在 Excel 里另存为「CSV UTF-8」，或直接用 .xlsx`,
    );
  }
}

function sheetOf(name: string, worksheet: ExcelJS.Worksheet, headerRow: number): HistorySheet {
  const headerCells = worksheet.getRow(headerRow);
  const columns = Math.max(headerCells.cellCount, 0);
  const header: string[] = [];
  for (let column = 1; column <= columns; column += 1) {
    const value = cellValue(headerCells.getCell(column));
    header.push(value === null ? '' : textOfHeader(value));
  }
  const rows: HistorySheetRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const cells = header.map((_, index) => cellValue(row.getCell(index + 1)));
    if (cells.every((cell) => cell === null || (typeof cell === 'string' && cell.trim() === ''))) {
      return;
    }
    rows.push({ row: rowNumber, cells });
  });
  return { name, header, rows };
}

function textOfHeader(value: Exclude<HistoryCell, null>): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
}

const isPercentFormat = (format: string | undefined) => !!format && format.includes('%');

/** exceljs 的单元格值 → HistoryCell */
function cellValue(cell: ExcelJS.Cell): HistoryCell {
  return valueOf(cell.value, cell.numFmt);
}

function valueOf(value: ExcelJS.CellValue, format: string | undefined): HistoryCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    // 百分比格式的单元格存的是小数（0.5 显示为 50%），按原表看到的写法给出
    return isPercentFormat(format) ? `${new Big(value).times(100).toString()}%` : value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if ('richText' in value) return value.richText.map((part) => part.text).join('');
  // 公式与共享公式取计算结果（没算过的为空）
  if ('result' in value) return valueOf(value.result ?? null, format);
  if ('formula' in value || 'sharedFormula' in value) return null;
  if ('hyperlink' in value) {
    const text: unknown = value.text;
    return typeof text === 'string' ? text : valueOf(text as ExcelJS.CellValue, format);
  }
  if ('error' in value) return value.error;
  return null;
}
