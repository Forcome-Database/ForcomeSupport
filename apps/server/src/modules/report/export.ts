import { businessDateTime } from '@forcome/calendar';
import {
  firstResponseDelta,
  firstResponseWords,
  isEmptyTicketReport,
  rateWords,
  REPORT_COST,
  REPORT_KPI,
  reportChannelGroupLabels,
  reportPeriodLabels,
  responsibilityLabels,
  slaDelta,
  slaSubWords,
  UNREGISTERED_RESPONSIBILITY,
  volumeDelta,
  type ReportCost,
  type ReportDateRange,
  type ReportPeriod,
  type ReportQuery,
  type TicketReport,
} from '@forcome/contracts';
import ExcelJS from 'exceljs';
import { storeNamesById } from '../channel';
import { recordAudit, transaction, type Runtime } from '../core';
import type { Access } from '../org';
import { costReport } from './cost';
import { ticketReport } from './tickets';

/*
 * P17 报表导出（PRD P17「第一阶段」v2.35、K5，待办 25）：按当前筛选（期间、店铺、站点）与字段权限，服务端用 exceljs 同步生成一个
 * xlsx 后直接下载，不留存文件；导出记审计（动作 report.export，对象类型「导出」，同台账导出）。三张表：
 * - 「指标」：条件（期间、店铺、站点、更新于、导出时间）与三个指标的本期 · 上一周期 · 对比 · 说明，写法与画面一致
 *   （contracts 的 report-words.ts，画面同一份）；无数据（K4）时本期写「—」、说明写「所选范围无数据」；
 * - 「每日工单量」：期间内每天两组渠道与合计，末行合计；
 * - 「售后成本按责任类型」：只在有财务权限时有（没有时文件里没有任何成本字段，AC-P1-09），本月、随店铺不随时间与站点，
 *   每个责任类型（含未登记责任）的金额与单数，末行合计 = 卡头 = P13 合计（AC-RP-01）。
 * 数字取自画面用的同一组查询（ticketReport、costReport），不另写口径。
 */

const MONEY_FORMAT = '"$"#,##0.00';
export const REPORT_EXPORT_SHEETS = {
  metrics: '指标',
  daily: '每日工单量',
  cost: '售后成本按责任类型',
} as const;
const OBJECT_LABEL = '报表';
const ALL = '全部';

/** 文件名（K5「报表_近7天_0905-0911.xlsx」）：本月「报表_本月_0901-0911」，自定义「报表_0901-0903」，单天写一个日期 */
export function reportExportFileName(range: ReportDateRange & { period: ReportPeriod }): string {
  const day = (date: string) => date.slice(5).replace('-', '');
  const span = range.from === range.to ? day(range.from) : `${day(range.from)}-${day(range.to)}`;
  if (range.period === '7d') return `报表_近7天_${span}.xlsx`;
  if (range.period === 'month') return `报表_本月_${span}.xlsx`;
  return `报表_${span}.xlsx`;
}

const rangeText = (range: ReportDateRange) =>
  range.from === range.to ? range.from : `${range.from} 至 ${range.to}`;

/** 一张表上方的条件：每行「名称 | 值」，名称加粗；之后空一行 */
function addConditions(sheet: ExcelJS.Worksheet, rows: readonly (readonly [string, string])[]) {
  for (const [name, value] of rows) sheet.addRow([name, value]).getCell(1).font = { bold: true };
  sheet.addRow([]);
}

function addHeader(sheet: ExcelJS.Worksheet, headers: readonly string[]) {
  sheet.addRow([...headers]).font = { bold: true };
}

type Cell = string | number | null;

/** 三个指标的四列：本期 · 上一周期 · 对比 · 说明（与画面同一套写法） */
function metricRows(report: TicketReport): Cell[][] {
  const { current, prior, range } = report;
  const empty = isEmptyTicketReport(report);
  const now = (value: Cell) => (empty ? REPORT_KPI.none : value);
  const delta = (words: { text: string } | null) => (empty ? null : (words?.text ?? null));
  const note = (text: string) => (empty ? REPORT_KPI.noData : text);
  return [
    [
      REPORT_KPI.volume,
      now(current.volume),
      prior.volume,
      delta(volumeDelta(current.volume, prior.volume, range)),
      note(REPORT_KPI.volumeWhat),
    ],
    [
      REPORT_KPI.firstResponse,
      now(firstResponseWords(current.firstResponseMs)),
      firstResponseWords(prior.firstResponseMs),
      delta(firstResponseDelta(current.firstResponseMs, prior.firstResponseMs, range)),
      note(REPORT_KPI.firstResponseSub),
    ],
    [
      REPORT_KPI.sla,
      now(rateWords(current.sla)),
      rateWords(prior.sla),
      delta(slaDelta(current.sla, prior.sla, range)),
      note(slaSubWords(current.sla, report.unassignedMissed)),
    ],
  ];
}

interface Scope {
  readonly store: string;
  readonly site: string;
}

/** 生成工作簿：指标、每日工单量、（有财务权限时）售后成本按责任类型 */
async function workbookOf(
  report: TicketReport,
  cost: ReportCost | null,
  scope: Scope,
  now: Date,
): Promise<{ body: Uint8Array<ArrayBuffer>; rows: number }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Forcome Support';
  let rows = 0;

  const metrics = workbook.addWorksheet(REPORT_EXPORT_SHEETS.metrics);
  metrics.columns = [{ width: 22 }, { width: 28 }, { width: 14 }, { width: 28 }, { width: 40 }];
  addConditions(metrics, [
    ['期间', `${rangeText(report.range)}（${reportPeriodLabels[report.range.period]}）`],
    ['店铺', scope.store],
    ['站点', scope.site],
    ['更新于', report.updatedAt ? businessDateTime(new Date(report.updatedAt)) : REPORT_KPI.none],
    ['导出时间', businessDateTime(now)],
  ]);
  addHeader(metrics, ['指标', '本期', '上一周期', '对比', '说明']);
  const metricLines = metricRows(report);
  for (const row of metricLines) metrics.addRow(row);
  rows += metricLines.length;

  const daily = workbook.addWorksheet(REPORT_EXPORT_SHEETS.daily, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  daily.columns = [{ width: 14 }, { width: 10 }, { width: 16 }, { width: 10 }];
  const { amazon, shopify_email: others } = reportChannelGroupLabels;
  addHeader(daily, ['日期', amazon, others, '合计']);
  for (const day of report.daily) {
    daily.addRow([day.date, day.amazon, day.shopify_email, day.amazon + day.shopify_email]);
  }
  const sum = (pick: (day: TicketReport['daily'][number]) => number) =>
    report.daily.reduce((n, day) => n + pick(day), 0);
  daily.addRow([
    '合计',
    sum((d) => d.amazon),
    sum((d) => d.shopify_email),
    sum((d) => d.amazon + d.shopify_email),
  ]).font = { bold: true };
  rows += report.daily.length;

  if (cost) {
    const sheet = workbook.addWorksheet(REPORT_EXPORT_SHEETS.cost);
    sheet.columns = [{ width: 22 }, { width: 40 }, { width: 10 }];
    // 「本月 2026-09-01 至 2026-09-11 · 不随时间筛选 · 产品成本 + 运费 + 额外赔偿 + 其他」与店铺（PRD v2.35，协调者 Q5）
    addConditions(sheet, [
      ['期间', `本月 ${rangeText(cost.range)} · ${REPORT_COST.notFiltered} · ${REPORT_COST.sub}`],
      ['店铺', scope.store],
    ]);
    addHeader(sheet, ['责任类型', '售后成本（USD）', '单数']);
    for (const bar of cost.bars) {
      const name = bar.responsibility
        ? responsibilityLabels[bar.responsibility]
        : UNREGISTERED_RESPONSIBILITY;
      sheet.addRow([name, Number(bar.totalUsd), bar.count]).getCell(2).numFmt = MONEY_FORMAT;
    }
    const total = sheet.addRow(['合计', Number(cost.totalUsd), cost.count]);
    total.font = { bold: true };
    total.getCell(2).numFmt = MONEY_FORMAT;
    rows += cost.bars.length;
  }

  return { body: new Uint8Array(await workbook.xlsx.writeBuffer()), rows };
}

/** 一次导出：文件名、各表数据行数之和与文件内容 */
export interface ReportExport {
  readonly fileName: string;
  readonly rows: number;
  readonly body: Uint8Array<ArrayBuffer>;
}

/**
 * 导出 P17（店铺范围内；店铺筛选的越权由接口先用 access.requireStores 把关）：取与画面相同的工单部分与（有财务权限时）售后成本，
 * 生成文件，记一条审计（筛选条件、行数、文件名、是否含财务字段；按选的店铺归属）
 */
export async function exportReport(
  runtime: Runtime,
  access: Access,
  query: ReportQuery,
): Promise<ReportExport> {
  const now = runtime.clock.now();
  const report = await ticketReport(runtime.db, access.stores, query, now);
  const finance = access.financeVisible;
  const cost = finance ? await costReport(runtime.db, access.stores, query, now) : null;
  const storeName = query.store
    ? ((await storeNamesById(runtime.db, [query.store])).get(query.store) ?? query.store)
    : ALL;
  const { body, rows } = await workbookOf(
    report,
    cost,
    { store: storeName, site: query.site ?? ALL },
    now,
  );
  const fileName = reportExportFileName(report.range);
  await transaction(runtime, (tx) =>
    recordAudit(tx, access.actor, {
      action: 'report.export',
      objectType: 'export',
      objectId: 'report.reports',
      objectLabel: OBJECT_LABEL,
      storeId: query.store ?? null,
      after: {
        fileName,
        filters: {
          period: report.range.period,
          from: report.range.from,
          to: report.range.to,
          ...(query.store ? { store: query.store } : {}),
          ...(query.site ? { site: query.site } : {}),
        },
        rows,
        financeFields: finance,
      },
    }),
  );
  return { fileName, rows, body };
}
