import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * order 模块的数据库 schema（一个模块一个 schema，ADR 0006）；表随各期待办加入。
 * 注意 order 是 SQL 保留字：drizzle 会自动加引号，手写 SQL（如报表视图）必须写成 "order"。
 */
export const orderSchema = pgSchema('order');
