import { missingItemLabels } from '@forcome/contracts';
import type { HistoryImportNote, HistoryImportReport } from './history-import';

/*
 * 导入报告的文字（命令行输出，待办 27）：逐行写导入结果——将导入（试运行）或已导入的单号与标注、缺的字段、警告；
 * 跳过的行写当时导入的单号与标注；未导入的行写全部错误。最后合计。
 */

/** 两个标注的写法 */
const historyImportNoteWords: Record<HistoryImportNote, string> = {
  usd_assumed: '原表没有币种，按美元导入',
  fee_date_from_registered: '原表没有费用发生日，取原登记日期',
};

export function formatHistoryImportReport(report: HistoryImportReport): string {
  const done = report.dryRun ? '将导入' : '已导入';
  const lines = [`售后登记表导入${report.dryRun ? '（试运行，不写库）' : ''}：${report.source}`];
  const counts = { imported: 0, skipped: 0, failed: 0 };
  for (const result of report.rows) {
    counts[result.outcome] += 1;
    const head = `第 ${result.row} 行${result.key === null ? '' : `（${result.key}）`}`;
    switch (result.outcome) {
      case 'imported': {
        const parts = [
          `${head}${done} ${result.number}`,
          ...result.notes.map((note) => historyImportNoteWords[note]),
        ];
        if (result.missing.length > 0) {
          parts.push(`缺：${missingItemLabels(result.missing).join('、')}`);
        }
        parts.push(...result.warnings.map((warning) => `注意：${warning}`));
        lines.push(parts.join(' · '));
        break;
      }
      case 'skipped':
        lines.push(
          [
            `${head}已导入过（${result.number}），跳过`,
            ...result.notes.map((note) => historyImportNoteWords[note]),
          ].join(' · '),
        );
        break;
      case 'failed':
        lines.push(`${head}未导入 · ${result.errors.join('；')}`);
        break;
    }
  }
  lines.push(
    `合计 ${report.rows.length} 行：${done} ${counts.imported} · 跳过 ${counts.skipped} · 未导入 ${counts.failed}`,
  );
  if (counts.failed > 0) {
    lines.push(
      '未导入的行：认不出的取值在映射表 values 里加别名，或改正原表后重跑（已导入的行会跳过）。',
    );
  }
  return lines.join('\n');
}
