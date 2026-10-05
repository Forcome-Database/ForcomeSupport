import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  defaultHistoryMapping,
  formatHistoryImportReport,
  HistoryImportError,
  importAftersalesHistory,
  parseHistoryMapping,
  readHistorySheet,
  type HistoryMapping,
} from './modules/aftersales';
import type { Runtime } from './modules/core';

/*
 * 售后登记表导入命令（待办 27）：读参数、映射表与表格，连库导入，把报告写到标准输出。入口 import-aftersales.ts 只组装运行时，
 * 测试工具（t.runImportCommand）用测试库调用同一个函数，参数、退出码与默认映射表都经它核对（同 reset-inbound-data.ts）。
 */

export const IMPORT_AFTERSALES_USAGE =
  '用法：import-aftersales <登记表.xlsx|.csv> [--mapping <映射表.json>] [--dry-run]';

/** 命令的输出：报告写标准输出，映射表、表头、文件与用法的问题写标准错误 */
export interface ImportCommandOutput {
  stdout(text: string): void;
  stderr(text: string): void;
}

/** 连库：参数、映射表与表格都没问题之后才连 */
export type OpenRuntime = () => Promise<{ runtime: Runtime; stop: () => Promise<void> }>;

async function mappingFrom(file: string | undefined): Promise<HistoryMapping> {
  if (!file) return defaultHistoryMapping();
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new HistoryImportError(`读不了映射表 ${file}：${(error as Error).message}`);
  }
  return parseHistoryMapping(json, file);
}

/**
 * 执行一次导入命令，返回退出码：全部导入或跳过为 0；有未导入的行（其余行照常导入）、或参数、映射表、表头、文件有问题
 * （一行也不导入）为 1。别的错误（例如连不上库）照常抛出。
 */
export async function runImportAftersalesCommand(
  argv: readonly string[],
  open: OpenRuntime,
  output: ImportCommandOutput,
): Promise<number> {
  try {
    let args;
    try {
      args = parseArgs({
        args: [...argv],
        allowPositionals: true,
        options: { mapping: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
      });
    } catch (error) {
      throw new HistoryImportError(`${(error as Error).message}\n${IMPORT_AFTERSALES_USAGE}`);
    }
    const [file, ...rest] = args.positionals;
    if (!file || rest.length > 0) throw new HistoryImportError(IMPORT_AFTERSALES_USAGE);
    const mapping = await mappingFrom(args.values.mapping);
    const sheet = await readHistorySheet(file, {
      sheet: mapping.sheet,
      headerRow: mapping.headerRow,
    });

    const { runtime, stop } = await open();
    try {
      const report = await importAftersalesHistory(runtime, sheet, mapping, {
        dryRun: args.values['dry-run'],
      });
      output.stdout(`${formatHistoryImportReport(report)}\n`);
      return report.rows.every((row) => row.outcome !== 'failed') ? 0 : 1;
    } finally {
      await stop();
    }
  } catch (error) {
    if (!(error instanceof HistoryImportError)) throw error;
    output.stderr(`${error.message}\n`);
    return 1;
  }
}
