import { describe, expect, it } from 'vitest';
import { defaultVisibility, hiddenColumns, hideableColumns } from './ledger-columns';

/*
 * P13 的列设置（PRD P13「第一阶段」、S13 补充小样）：默认隐藏 配件 × 数量、负责人、其他、生产厂；坐席没有七个金额列；
 * 「已隐藏 N 列」按「配件 × 数量、负责人、其他、生产厂」的顺序，其余按表格顺序。
 */

describe('P13 的列设置', () => {
  it('「列设置」里的列：除售后单号外按表格顺序；坐席不含七个金额列', () => {
    expect(hideableColumns(true)).toEqual([
      'customer',
      'storeSite',
      'method',
      'responsibility',
      'status',
      'owner',
      'factory',
      'part',
      'trackingNumber',
      'productCost',
      'freight',
      'compensation',
      'otherCost',
      'feeTotal',
      'fshShare',
      'factoryShare',
    ]);
    expect(hideableColumns(false)).toEqual([
      'customer',
      'storeSite',
      'method',
      'responsibility',
      'status',
      'owner',
      'factory',
      'part',
      'trackingNumber',
    ]);
  });

  it('默认隐藏四列；坐席的画面只算三列（其他是金额列）', () => {
    expect(hiddenColumns(defaultVisibility(), true)).toEqual([
      'part',
      'owner',
      'otherCost',
      'factory',
    ]);
    expect(hiddenColumns(defaultVisibility(), false)).toEqual(['part', 'owner', 'factory']);
  });

  it('又隐藏了别的列：排在默认隐藏的之后，按表格顺序', () => {
    const visibility = {
      ...defaultVisibility(),
      owner: true,
      trackingNumber: false,
      customer: false,
    };
    expect(hiddenColumns(visibility, true)).toEqual([
      'part',
      'otherCost',
      'factory',
      'customer',
      'trackingNumber',
    ]);
  });
});
