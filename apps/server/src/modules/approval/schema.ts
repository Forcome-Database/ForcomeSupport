import { pgSchema } from 'drizzle-orm/pg-core';

/** approval 模块的数据库 schema（一个模块一个 schema，ADR 0006）；表随各期待办加入 */
export const approvalSchema = pgSchema('approval');
