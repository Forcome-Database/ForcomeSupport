// 入口：import-aftersales（一次性，开发测试与生产都用）。售后登记表导入（PRD 第 14 节，待办 27，不用模型）：
//   node dist/import-aftersales.mjs <登记表.xlsx|.csv> [--mapping <映射表.json>] [--dry-run]
// 按映射表（默认随镜像打包的 history-mapping.json）把原表逐行导入台账，创建路径「历史导入」；--dry-run 只报告将导入的行
// 与错误、不写库。先跑 migrate；金额按费用发生日的汇率折算（汇率表由 worker 同步，生产库第一次同步就装入全量历史）。
// 报告逐行写到标准输出；有错误的行时退出码为 1（其余行照常导入，改好后重跑，已导入的行会跳过）。
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
import { createLogger, loadConfig, startRuntime } from './modules/core';

const USAGE = '用法：import-aftersales <登记表.xlsx|.csv> [--mapping <映射表.json>] [--dry-run]';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'import-aftersales' });

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

async function main(): Promise<boolean> {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: { mapping: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
    });
  } catch (error) {
    throw new HistoryImportError(`${(error as Error).message}\n${USAGE}`);
  }
  const [file, ...rest] = args.positionals;
  if (!file || rest.length > 0) throw new HistoryImportError(USAGE);
  const mapping = await mappingFrom(args.values.mapping);
  const sheet = await readHistorySheet(file, {
    sheet: mapping.sheet,
    headerRow: mapping.headerRow,
  });

  const { runtime, stop } = await startRuntime(config.databaseUrl, {
    role: 'api',
    logger,
    poolMax: 1,
  });
  try {
    const report = await importAftersalesHistory(runtime, sheet, mapping, {
      dryRun: args.values['dry-run'],
    });
    process.stdout.write(`${formatHistoryImportReport(report)}\n`);
    return report.rows.every((row) => row.outcome !== 'failed');
  } finally {
    await stop({ graceful: false });
  }
}

try {
  process.exitCode = (await main()) ? 0 : 1;
} catch (error) {
  if (error instanceof HistoryImportError) {
    // 映射表、表头、文件的问题：直接写给操作的人看
    process.stderr.write(`${error.message}\n`);
  } else {
    logger.error({ err: error }, '售后登记表导入失败');
  }
  process.exitCode = 1;
}
