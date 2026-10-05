import { currencies } from '@forcome/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  numeric,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/*
 * 数据约定（规格「数据约定」、ADR 0006）。各模块建表一律用这些列助手：
 * - 主键 UUIDv7，由数据库生成（PostgreSQL 18 内置 uuidv7()）；业务编号另设一列；
 * - 时间一律 timestamptz（UTC 存储），日界按 Asia/Shanghai 在应用层计算；
 * - 金额 numeric(12,2) + 币种。PRD 11.1 要求每个费用项另存汇率、汇率日期与来源、冻结的美元值：一个费用项的这组列
 *   由 feeColumns 一起定义（19 号待办先有原币金额与币种，20 号待办在这里补汇率与美元值）；
 * - 主表带 version 列，更新经 updateWithVersion，冲突抛 OptimisticLockError（接口返回 409）；
 * - 不做软删除，作废、取消用状态表示。
 * 迁移测试（apps/server/test/migrations.int.test.ts）逐表核对：时间列、JSON 列、numeric 精度、
 * 有金额列的表必须有币种列、UUIDv7 主键，以及 version 列的类型与默认值。
 */

/** UUIDv7 主键 `id` */
export const primaryId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);

/** 带时区的时间列；在 JS 中是 Date */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** 金额 numeric(12,2)；在 JS 中是字符串，避免浮点误差 */
export const amount = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** 币种（USD、CAD、MXN） */
export const currency = (name: string) => text(name, { enum: currencies });

/** 乐观锁版本号，每次更新加 1 */
export const version = () => integer('version').notNull().default(1);

/** 金额 numeric(12,2) 列 */
type AmountColumn = ReturnType<typeof amount>;
/** 币种列 */
type CurrencyColumn = ReturnType<typeof currency>;

/**
 * 一个费用项的一组列（PRD 11.1 AfterSales「每项保存原币、汇率、汇率日期与来源、冻结美元值」，R-AS-08）：
 * 原币金额 `key`（列名 column）与币种 `${key}Currency`（列名 `${column}_currency`）。没登记的费用项两列都空，
 * 表上用 feeCurrencyCheck 保证「有金额就有币种」。汇率、汇率日期与来源、冻结美元值随 20 号待办加在这里。
 */
export function feeColumns<K extends string>(key: K, column: string) {
  return {
    [key]: amount(column),
    [`${key}Currency`]: currency(`${column}_currency`),
  } as Record<K, AmountColumn> & Record<`${K}Currency`, CurrencyColumn>;
}

/** 费用项的金额与币种要么都有、要么都空 */
export function feeCurrencyCheck(
  name: string,
  amountColumn: AnyPgColumn,
  currencyColumn: AnyPgColumn,
) {
  return check(name, sql`(${amountColumn} IS NULL) = (${currencyColumn} IS NULL)`);
}
