import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HistoryImportError, readHistorySheet, type HistoryCell } from '../src/modules/aftersales';
import {
  SAMPLE_FILE,
  SAMPLE_HEADER,
  SAMPLE_ROWS,
  SAMPLE_SHEET,
  type SampleCell,
} from './fixtures/history-import/sample';

/*
 * 读售后登记表（待办 27）：提交的合成样本 register-sample.xlsx 与它的定义 sample.ts 一致（改了定义要重新生成：
 * pnpm --filter @forcome/server history:sample）；Excel 的日期、公式、百分比格式按原表看到的值读出；
 * CSV 只收 UTF-8，Excel 默认另存的 ANSI（GBK）CSV 直接报错。
 */

/** 定义里的单元格读回来应是什么：公式取结果，百分比格式写成「100%」 */
function expectedCell(value: SampleCell | undefined): HistoryCell {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && 'formula' in value) return value.result;
  if (typeof value === 'object' && 'percent' in value) return `${value.percent * 100}%`;
  return value;
}

describe('合成样本 register-sample.xlsx', () => {
  it('与 sample.ts 的定义一致：表头、行号（空行跳过）、每个单元格', async () => {
    const sheet = await readHistorySheet(SAMPLE_FILE, { sheet: SAMPLE_SHEET, headerRow: 1 });
    expect(sheet.name).toBe('register-sample.xlsx');
    expect(sheet.header).toEqual(SAMPLE_HEADER);
    const expected = SAMPLE_ROWS.map((row, index) => ({
      row: index + 2,
      cells: SAMPLE_HEADER.map((name) => expectedCell(row[name])),
    })).filter((row) => row.cells.some((cell) => cell !== null));
    expect(sheet.rows).toEqual(expected);
    // 第 7 行是空行
    expect(sheet.rows.map((row) => row.row)).not.toContain(7);
  });

  it('工作表名写错时报错', async () => {
    await expect(readHistorySheet(SAMPLE_FILE, { sheet: '台账', headerRow: 1 })).rejects.toThrow(
      new HistoryImportError('register-sample.xlsx 里没有工作表「台账」'),
    );
  });
});

describe('CSV', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'history-import-'));

  it('UTF-8（可带 BOM）的 CSV 一律按文字读出，交给逐行转换按字段解析', async () => {
    const file = path.join(dir, '登记表.csv');
    writeFileSync(
      file,
      '\uFEFF登记编号,登记日期,运费\r\nH-1,2026-03-02,"1,234.50"\r\n,,\r\n',
      'utf8',
    );
    const sheet = await readHistorySheet(file, { headerRow: 1 });
    expect(sheet).toEqual({
      name: '登记表.csv',
      header: ['登记编号', '登记日期', '运费'],
      rows: [{ row: 2, cells: ['H-1', '2026-03-02', '1,234.50'] }],
    });
  });

  it('不是 UTF-8 的 CSV（Excel 默认另存的 GBK）报错，提示另存为「CSV UTF-8」或用 .xlsx', async () => {
    const file = path.join(dir, 'gbk.csv');
    // 「登记」的 GBK 编码
    writeFileSync(file, Buffer.from([0xb5, 0xc7, 0xbc, 0xc7, 0x0d, 0x0a]));
    await expect(readHistorySheet(file, { headerRow: 1 })).rejects.toThrow(/不是 UTF-8 编码/);
  });

  it('只支持 .xlsx 与 .csv', async () => {
    const file = path.join(dir, '登记表.xls');
    writeFileSync(file, 'x');
    await expect(readHistorySheet(file, { headerRow: 1 })).rejects.toThrow(/只支持 .xlsx 与 .csv/);
  });
});
