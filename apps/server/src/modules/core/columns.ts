import { currencies, rateSources } from '@forcome/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
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
 *   由 feeColumns 一起定义，约束由 feeChecks 一起给出；汇率是 numeric(12,6)（「1 USD = 汇率 原币」），不是金额；
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

/** 汇率 numeric(12,6)：1 USD = 汇率 原币（R-FL-06）；不是金额，迁移测试里登记为例外 */
export const exchangeRate = (name: string) => numeric(name, { precision: 12, scale: 6 });

/** 汇率来源（欧洲央行、Frankfurter，台账费用项另有「手工修改」） */
export const exchangeRateSource = (name: string) => text(name, { enum: rateSources });

/** 日历日期（北京时间的某一天，如费用发生日、汇率日期）：PostgreSQL date，在 JS 中是 `YYYY-MM-DD` 字符串 */
const calendarDate = (name: string) => date(name, { mode: 'string' });

/**
 * 一个费用项的一组列（PRD 11.1 AfterSales「每项保存原币、汇率、汇率日期与来源、冻结美元值」，R-AS-08、R-FL-06）：
 * 原币金额 `key`（列名 column）与币种 `${key}Currency`、冻结的美元值 `${key}Usd`、汇率 `${key}Rate`、
 * 汇率日期 `${key}RateDate`、汇率来源 `${key}RateSource`（列名都以 column 开头）。没登记的费用项全都空；
 * 美元金额不折算，汇率三列为空、美元值等于原值。表上用 feeChecks 约束这些组合。
 */
export function feeColumns<K extends string>(key: K, column: string) {
  return {
    [key]: amount(column),
    [`${key}Currency`]: currency(`${column}_currency`),
    [`${key}Usd`]: amount(`${column}_usd`),
    [`${key}Rate`]: exchangeRate(`${column}_rate`),
    [`${key}RateDate`]: calendarDate(`${column}_rate_date`),
    [`${key}RateSource`]: exchangeRateSource(`${column}_rate_source`),
  } as Record<K | `${K}Usd`, ReturnType<typeof amount>> &
    Record<`${K}Currency`, ReturnType<typeof currency>> &
    Record<`${K}Rate`, ReturnType<typeof exchangeRate>> &
    Record<`${K}RateDate`, ReturnType<typeof calendarDate>> &
    Record<`${K}RateSource`, ReturnType<typeof exchangeRateSource>>;
}

/** feeColumns 给出的一组列的键 */
type FeeColumnKey<K extends string> =
  K | `${K}Currency` | `${K}Usd` | `${K}Rate` | `${K}RateDate` | `${K}RateSource`;

/**
 * 一个费用项的约束（表级 CHECK，列助手里生成不了，所以建表时逐项调用，键由类型检查与 feeColumns 对上）：
 * - `${prefix}_currency_check`：有金额就有币种，反之亦然；
 * - `${prefix}_conversion_check`：美元值只跟着金额；汇率、汇率日期、来源三者同有同无，只用于非美元，且大于 0；
 *   美元金额的美元值等于原值；非美元金额有美元值就有汇率。
 * 「有金额就有美元值」由应用保证（aftersales 的 feesOf 读出时检查），没写进数据库：加这组列时，开发与开发测试库里
 * 已有非美元的示例单，迁移取不到它当时的汇率，由示例数据的加载步骤补齐（ADR 0006 修订）。
 */
export function feeChecks<K extends string>(
  prefix: string,
  t: Record<FeeColumnKey<K>, AnyPgColumn>,
  key: K,
) {
  const amountColumn = t[key];
  const currencyColumn = t[`${key}Currency`];
  const usd = t[`${key}Usd`];
  const rate = t[`${key}Rate`];
  const rateDate = t[`${key}RateDate`];
  const rateSource = t[`${key}RateSource`];
  return [
    check(`${prefix}_currency_check`, sql`(${amountColumn} IS NULL) = (${currencyColumn} IS NULL)`),
    check(
      `${prefix}_conversion_check`,
      sql`(${usd} IS NULL OR ${amountColumn} IS NOT NULL)
        AND ((${rate} IS NULL) = (${rateDate} IS NULL))
        AND ((${rate} IS NULL) = (${rateSource} IS NULL))
        AND (${rate} IS NULL OR (${rate} > 0 AND coalesce(${currencyColumn} <> 'USD', false)))
        AND (${usd} IS NULL OR ${currencyColumn} <> 'USD' OR ${usd} = ${amountColumn})
        AND (${usd} IS NULL OR ${currencyColumn} = 'USD' OR ${rate} IS NOT NULL)`,
    ),
  ];
}
