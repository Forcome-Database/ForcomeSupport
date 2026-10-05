import { describe, expect, it } from 'vitest';
import { formatHistoryImportReport } from './history-report';

/* 导入报告的文字（待办 27）：命令行逐行输出导入结果与合计 */

describe('导入报告', () => {
  const rows = [
    {
      row: 2,
      key: 'H-001',
      outcome: 'imported',
      number: 'S-20260302-0023',
      notes: [],
      missing: [],
      warnings: [],
    },
    {
      row: 5,
      key: 'H-004',
      outcome: 'imported',
      number: 'S-20260316-0026',
      notes: ['usd_assumed', 'fee_date_from_registered'],
      missing: ['ownerId', 'claimTarget', 'claimStatus', 'trackingNumber'],
      warnings: ['负责人「张伟」不是该店铺的售后负责人，已留空（可补登）'],
    },
    { row: 6, key: 'H-005', outcome: 'skipped', number: 'S-20260401-0027', notes: ['usd_assumed'] },
    { row: 7, key: null, outcome: 'failed', errors: ['行标识（登记编号）没写', '店铺：没写'] },
  ] as const;

  it('试运行：「将导入」、标注、缺的字段（索赔对象与状态合算一项）、警告；跳过与错误；合计与重跑说明', () => {
    expect(
      formatHistoryImportReport({ source: '登记表.xlsx', dryRun: true, rows }).split('\n'),
    ).toEqual([
      '售后登记表导入（试运行，不写库）：登记表.xlsx',
      '第 2 行（H-001）将导入 S-20260302-0023',
      '第 5 行（H-004）将导入 S-20260316-0026 · 原表没有币种，按美元导入 · 原表没有费用发生日，取原登记日期 · 缺：负责人、索赔对象与状态、快递单号 · 注意：负责人「张伟」不是该店铺的售后负责人，已留空（可补登）',
      '第 6 行（H-005）已导入过（S-20260401-0027），跳过 · 原表没有币种，按美元导入',
      '第 7 行未导入 · 行标识（登记编号）没写；店铺：没写',
      '合计 4 行：将导入 2 · 跳过 1 · 未导入 1',
      '未导入的行：认不出的取值在映射表 values 里加别名，或改正原表后重跑（已导入的行会跳过）。',
    ]);
  });

  it('正式导入写「已导入」；都导入了时不写重跑说明', () => {
    const text = formatHistoryImportReport({
      source: 'x.csv',
      dryRun: false,
      rows: rows.slice(0, 1),
    });
    expect(text).toBe(
      [
        '售后登记表导入：x.csv',
        '第 2 行（H-001）已导入 S-20260302-0023',
        '合计 1 行：已导入 1 · 跳过 0 · 未导入 0',
      ].join('\n'),
    );
  });
});
