import { startOfBusinessDate } from '@forcome/calendar';
import { feeItemLabels, feeItems, missingFields, type RegistrationField } from '@forcome/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { listStoreOptions } from '../channel';
import {
  advisoryLock,
  nextBusinessNumber,
  recordAudit,
  storeScopeCondition,
  SYSTEM_STORE_SCOPE,
  systemActor,
  transaction,
  type DbExecutor,
  type Runtime,
  type Tx,
} from '../core';
import { listFactories } from '../factory';
import { listAftersalesOwners } from '../org';
import { auditSnapshot } from './audit';
import { convertFees, feeColumnValues, keptFeeColumns } from './fees';
import type { HistoryMapping } from './history-mapping';
import {
  bindHistoryMapping,
  parseHistoryRow,
  sourceValuesOf,
  type BoundHistoryMapping,
  type HistoryLookups,
  type HistoryRecord,
} from './history-row';
import type { HistorySheet, HistorySheetRow } from './history-sheet';
import { recordOf } from './ledger';
import { aftersales, historyImport } from './schema';

/*
 * 售后登记表一次性导入（PRD 第 14 节、R-AS-08，待办 27；命令行入口 src/import-aftersales.ts，不用模型）：
 * 按映射表把原表逐行转成创建路径「历史导入」的售后单。
 * - 编号 S-原登记日期-全局序号：按原登记日期先后发号（同一天按原表行序），序号接在已有的单后面；
 * - 金额按费用发生日（原表没有时取原登记日期）的汇率冻结美元值，当天没有取此前最近一个有汇率的日期（同新建登记）；
 * - 状态按原表直接写入（建档时的状态，不是迁移，ADR 0008 修订），已完成的单可以没有完成时间；
 * - 每张导入的单另记一条导入记录（行标识、来源行、两个标注与原值）与一条审计「历史导入」（操作人「系统」）；
 * - 试运行走同一条路径，最后整体回滚：报告的单号、错误与正式导入时一致，库里什么都不留；
 * - 一行一个保存点：坏行只回滚自己，其余照常导入；行标识已导入过的跳过（重跑幂等），同一次导入里重复的行标识报错。
 * 历史导入的单不计当月登记完整率（ledger.ts 的 completedIn），在台账照常标「待回填」「缺 N 项」，售后负责人可补登。
 */

/** 导入记录与报告里的标注 */
export type HistoryImportNote = 'usd_assumed' | 'fee_date_from_registered';

export type HistoryImportRowResult =
  | {
      /** 原表行号 */
      readonly row: number;
      readonly key: string;
      /** 导入了（试运行时为「将导入」） */
      readonly outcome: 'imported';
      readonly number: string;
      readonly notes: readonly HistoryImportNote[];
      /** 缺的适用字段（R-AS-08），导入后可补登 */
      readonly missing: readonly RegistrationField[];
      readonly warnings: readonly string[];
    }
  | {
      readonly row: number;
      readonly key: string;
      /** 行标识已导入过：跳过，number 与 notes 是当时导入的单号与标注（导入记录里存的） */
      readonly outcome: 'skipped';
      readonly number: string;
      readonly notes: readonly HistoryImportNote[];
    }
  | {
      readonly row: number;
      readonly key: string | null;
      readonly outcome: 'failed';
      readonly errors: readonly string[];
    };

export interface HistoryImportReport {
  /** 来源文件名 */
  readonly source: string;
  readonly dryRun: boolean;
  /** 按原表行序，每个非空行一条 */
  readonly rows: readonly HistoryImportRowResult[];
}

export interface ImportHistoryOptions {
  /** 试运行：只报告将导入的行与错误，不写库 */
  readonly dryRun?: boolean;
}

/** 同一时间只跑一次导入（行标识的唯一约束是第二道保险） */
const IMPORT_LOCK = 'aftersales.history_import';

/** 试运行在事务最后抛它来回滚，报告随它带出 */
class DryRunRollback extends Error {
  readonly report: HistoryImportReport;
  constructor(report: HistoryImportReport) {
    super('试运行：回滚');
    this.report = report;
  }
}

/**
 * 导入一张售后登记表。映射表里的列在表头里找不到时整体报错（HistoryImportError），不导入任何一行；
 * 行级的错误写进报告，不抛出。
 */
export async function importAftersalesHistory(
  runtime: Runtime,
  sheet: HistorySheet,
  mapping: HistoryMapping,
  options: ImportHistoryOptions = {},
): Promise<HistoryImportReport> {
  const bound = bindHistoryMapping(sheet.header, mapping);
  const dryRun = options.dryRun ?? false;
  try {
    return await transaction(runtime, async (tx) => {
      await advisoryLock(tx, IMPORT_LOCK);
      const report = { source: sheet.name, dryRun, rows: await importRows(tx, sheet, bound) };
      if (dryRun) throw new DryRunRollback(report);
      return report;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.report;
    throw error;
  }
}

async function importRows(
  tx: Tx,
  sheet: HistorySheet,
  bound: BoundHistoryMapping,
): Promise<HistoryImportRowResult[]> {
  const lookups = await historyLookups(tx.db);
  const parsed = sheet.rows.map((row) => ({
    row,
    result: parseHistoryRow(bound, row.cells, lookups),
  }));
  const imported = await importedRows(
    tx.db,
    parsed.flatMap(({ result }) => (result.ok ? [result.record.key] : [])),
  );

  const results = new Map<number, HistoryImportRowResult>();
  const firstRowOf = new Map<string, number>();
  const pending: { row: HistorySheetRow; record: HistoryRecord }[] = [];
  for (const { row, result } of parsed) {
    const key = result.ok ? result.record.key : result.key;
    const first = key === null ? undefined : firstRowOf.get(key);
    if (key !== null && first !== undefined) {
      const errors = [`行标识「${key}」与第 ${first} 行重复`, ...(result.ok ? [] : result.errors)];
      results.set(row.row, { row: row.row, key, outcome: 'failed', errors });
      continue;
    }
    if (key !== null) firstRowOf.set(key, row.row);
    if (!result.ok) {
      results.set(row.row, { row: row.row, key, outcome: 'failed', errors: result.errors });
      continue;
    }
    const done = imported.get(result.record.key);
    if (done !== undefined) {
      results.set(row.row, { row: row.row, key: result.record.key, outcome: 'skipped', ...done });
      continue;
    }
    pending.push({ row, record: result.record });
  }

  // 按原登记日期先后发号，同一天按原表行序
  pending.sort(
    (a, b) =>
      a.record.registeredDate.localeCompare(b.record.registeredDate) || a.row.row - b.row.row,
  );
  for (const { row, record } of pending) {
    results.set(row.row, await importRow(tx, sheet, bound, row, record));
  }
  return sheet.rows.map((row) => {
    const result = results.get(row.row);
    if (!result) throw new Error(`第 ${row.row} 行没有导入结果`);
    return result;
  });
}

/** 逐行转换要用的已有数据：全部店铺、在职的售后负责人、生产厂（同一个事务连接上依次查） */
async function historyLookups(db: DbExecutor): Promise<HistoryLookups> {
  const stores = await listStoreOptions(db, SYSTEM_STORE_SCOPE);
  const owners = await listAftersalesOwners(db);
  const factories = await listFactories(db);
  return {
    stores: stores.map((store) => ({ id: store.id, name: store.name })),
    owners,
    factories: factories.map((factory) => factory.code),
  };
}

/** 两个标注 → 报告里的写法 */
function notesOf(flags: {
  usdAssumed: boolean;
  feeDateFromRegistered: boolean;
}): HistoryImportNote[] {
  return [
    ...(flags.usdAssumed ? (['usd_assumed'] as const) : []),
    ...(flags.feeDateFromRegistered ? (['fee_date_from_registered'] as const) : []),
  ];
}

/** 已导入过的行标识 → 当时导入的单号与标注 */
async function importedRows(
  db: DbExecutor,
  keys: readonly string[],
): Promise<Map<string, { number: string; notes: HistoryImportNote[] }>> {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({
      key: historyImport.sourceKey,
      number: aftersales.number,
      usdAssumed: historyImport.usdAssumed,
      feeDateFromRegistered: historyImport.feeDateFromRegistered,
    })
    .from(historyImport)
    .innerJoin(aftersales, eq(aftersales.id, historyImport.aftersalesId))
    .where(
      and(
        inArray(historyImport.sourceKey, [...new Set(keys)]),
        // 导入是系统操作（命令行，操作人「系统」），不受店铺范围限制（ADR 0010 修订）
        storeScopeCondition(SYSTEM_STORE_SCOPE, aftersales.storeId),
      ),
    );
  return new Map(rows.map((row) => [row.key, { number: row.number, notes: notesOf(row) }]));
}

async function importRow(
  tx: Tx,
  sheet: HistorySheet,
  bound: BoundHistoryMapping,
  row: HistorySheetRow,
  record: HistoryRecord,
): Promise<HistoryImportRowResult> {
  const failed = (errors: string[]): HistoryImportRowResult => ({
    row: row.row,
    key: record.key,
    outcome: 'failed',
    errors,
  });
  // 按费用发生日（原表没有时已取原登记日期）折算；当天及之前都没有汇率的金额报错，整行不导入
  const converted = await convertFees(tx.db, record.fees, record.feeDate);
  const rateErrors = feeItems.flatMap((item) => {
    const message = converted.errors[`fees.${item}`];
    return message ? [`${feeItemLabels[item]}：${message}`] : [];
  });
  if (rateErrors.length > 0) return failed(rateErrors);

  const notes = notesOf(record.notes);
  try {
    // 一行一个保存点：这一行写库出错只回滚它自己（编号也不占用）
    return await tx.db.transaction(async (db): Promise<HistoryImportRowResult> => {
      const rowTx: Tx = { ...tx, db };
      const [inserted] = await db
        .insert(aftersales)
        .values({
          number: await nextBusinessNumber(
            rowTx,
            'aftersales',
            startOfBusinessDate(record.registeredDate),
          ),
          status: record.status,
          origin: 'history_import',
          storeId: record.storeId,
          site: record.site,
          orderNumber: record.orderNumber,
          customerName: record.customerName,
          registeredByName: record.registeredByName,
          ownerId: record.ownerId,
          feeDate: record.feeDate,
          completedAt: record.completedAt,
          cancelReason: record.cancelReason,
          cancelledAt: record.cancelledAt,
          method: record.method,
          responsibility: record.responsibility,
          responsibilityReason: record.responsibilityReason,
          factoryCode: record.factoryCode,
          partSku: record.partSku,
          partQuantity: record.partQuantity,
          shipper: record.shipper,
          carrier: record.carrier,
          shipDate: record.shipDate,
          trackingNumber: record.trackingNumber,
          claimTarget: record.claimTarget,
          claimStatus: record.claimStatus,
          ...feeColumnValues(converted.values),
          productFactoryPct: record.factoryRatios?.product ?? null,
          freightFactoryPct: record.factoryRatios?.freight ?? null,
          otherFactoryPct: record.factoryRatios?.other ?? null,
          // 只有已取消的单有保留项：已登记的项按原表（原表没写时全部保留），没登记的为空
          ...keptFeeColumns(
            (item) => record.status === 'cancelled' && converted.values[item].amount !== null,
            (item) => record.keptFees === null || record.keptFees.includes(item),
          ),
          createdAt: tx.now,
          updatedAt: tx.now,
        })
        .returning();
      if (!inserted) throw new Error('售后单写入失败');
      await db.insert(historyImport).values({
        aftersalesId: inserted.id,
        sourceKey: record.key,
        sourceFile: sheet.name,
        sourceRow: row.row,
        usdAssumed: record.notes.usdAssumed,
        feeDateFromRegistered: record.notes.feeDateFromRegistered,
        source: sourceValuesOf(bound, row.cells),
        importedAt: tx.now,
      });
      await recordAudit(rowTx, systemActor, {
        action: 'aftersales.import',
        objectType: 'aftersales',
        objectId: inserted.id,
        objectLabel: inserted.number,
        storeId: inserted.storeId,
        after: auditSnapshot(inserted, record.ownerName),
      });
      return {
        row: row.row,
        key: record.key,
        outcome: 'imported',
        number: inserted.number,
        notes,
        missing: missingFields(recordOf(inserted)),
        warnings: record.warnings,
      };
    });
  } catch (error) {
    return failed([`写入失败：${error instanceof Error ? error.message : String(error)}`]);
  }
}
