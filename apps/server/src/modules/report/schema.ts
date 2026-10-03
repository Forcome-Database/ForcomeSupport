import { pgSchema } from 'drizzle-orm/pg-core';

/** report 模块的数据库 schema：放报表视图（表随 24、25 号待办加入）。report 读各模块的表用只读角色 */
export const reportSchema = pgSchema('report');
