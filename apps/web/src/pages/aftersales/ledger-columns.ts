import {
  ledgerColumns,
  ledgerDefaultHidden,
  ledgerFinanceColumns,
  type LedgerColumn,
} from '@forcome/contracts';
import { useState } from 'react';

/*
 * P13 的列设置（S13 补充小样，用户确认 10-05）：除「售后单号」外的列都能在「列设置」里显示或隐藏（坐席不含七个金额列）；
 * 默认隐藏 配件 × 数量、负责人、其他、生产厂；按人存在本机浏览器（localStorage，读写失败时退回默认，不影响使用），刷新后保留。
 */

/** 列的显隐（TanStack Table 的 columnVisibility：false 为隐藏，没写的为显示） */
export type ColumnVisibility = Partial<Record<LedgerColumn, boolean>>;

/** 售后单号总是显示，不在「列设置」里 */
const ALWAYS_SHOWN: LedgerColumn = 'number';

/** 这位查看者「列设置」里能选的列（按表格顺序；坐席没有七个金额列） */
export function hideableColumns(finance: boolean): LedgerColumn[] {
  return ledgerColumns.filter(
    (column) => column !== ALWAYS_SHOWN && (finance || !ledgerFinanceColumns.has(column)),
  );
}

/** 默认的显隐：配件 × 数量、负责人、其他、生产厂隐藏 */
export function defaultVisibility(): ColumnVisibility {
  return Object.fromEntries(ledgerDefaultHidden.map((column) => [column, false]));
}

/**
 * 已隐藏的列，按「已隐藏 4 列：配件 × 数量、负责人、其他、生产厂」的顺序（默认隐藏的四列在前，其余按表格顺序）；
 * 只算这位查看者能看到的列（坐席的画面写「已隐藏 3 列：配件 × 数量、负责人、生产厂」）
 */
export function hiddenColumns(visibility: ColumnVisibility, finance: boolean): LedgerColumn[] {
  const available = new Set(hideableColumns(finance));
  const order = [...new Set<LedgerColumn>([...ledgerDefaultHidden, ...ledgerColumns])];
  return order.filter((column) => available.has(column) && visibility[column] === false);
}

const STORAGE_KEY = (memberId: string) => `forcome.p13.columns.${memberId}`;

/** 本机存的隐藏列（认不出的内容当作没存，用默认） */
function readStored(memberId: string): ColumnVisibility | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY(memberId));
    if (raw === null) return null;
    const hidden: unknown = JSON.parse(raw);
    if (!Array.isArray(hidden)) return null;
    const known = new Set<string>(ledgerColumns);
    return Object.fromEntries(
      hidden
        .filter((column): column is LedgerColumn => typeof column === 'string' && known.has(column))
        .map((column) => [column, false]),
    );
  } catch {
    return null;
  }
}

function writeStored(memberId: string, visibility: ColumnVisibility): void {
  try {
    const hidden = ledgerColumns.filter((column) => visibility[column] === false);
    window.localStorage.setItem(STORAGE_KEY(memberId), JSON.stringify(hidden));
  } catch {
    // 本机存储不可用（隐私模式、被禁用）：这次照样生效，只是刷新后回到默认
  }
}

/** 这位成员的列显隐：读本机存的（没有时用默认），改了就存；reset 恢复默认 */
export function useColumnVisibility(memberId: string) {
  const [visibility, setVisibility] = useState<ColumnVisibility>(
    () => readStored(memberId) ?? defaultVisibility(),
  );
  const update = (next: ColumnVisibility) => {
    setVisibility(next);
    writeStored(memberId, next);
  };
  return {
    visibility,
    /** 显示或隐藏一列 */
    toggle: (column: LedgerColumn, visible: boolean) =>
      update({ ...visibility, [column]: visible }),
    reset: () => update(defaultVisibility()),
  };
}
