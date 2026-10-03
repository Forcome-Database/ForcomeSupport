import { currencies } from '@forcome/contracts';
import { sql } from 'drizzle-orm';
import { integer, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/*
 * 数据约定（规格「数据约定」、ADR 0006）。各模块建表一律用这些列助手，
 * 迁移测试会逐表核对：
 * - 主键 UUIDv7，由数据库生成（PostgreSQL 18 内置 uuidv7()）；业务编号另设一列；
 * - 时间一律 timestamptz（UTC 存储），日界按 Asia/Shanghai 在应用层计算；
 * - 金额 numeric(12,2) + 币种；
 * - 主表带 version 列做乐观锁，冲突时抛 OptimisticLockError（接口返回 409）；
 * - 不做软删除，作废、取消用状态表示。
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
