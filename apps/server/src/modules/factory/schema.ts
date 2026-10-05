import { pgSchema, text, unique, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from '../core';

/** factory 模块的数据库 schema（一个模块一个 schema，ADR 0006）；表随各期待办加入 */
export const factorySchema = pgSchema('factory');

/**
 * 生产厂（集团内部两家，PRD 6.5「生产厂」、R-FT-07）：第一期只有代码，用于台账的「生产厂」字段（待办 19）；
 * 第二期 P24 在这里补对接人、来信邮箱与工厂工作台账号。两家生产厂由迁移 0012 写入所有环境（参考数据，ADR 0006 修订）。
 */
export const factory = factorySchema.table(
  'factory',
  {
    id: primaryId(),
    /** 生产厂代码（FQD、FZJ），台账与界面显示它 */
    code: text('code').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('factory_code_key').on(t.code)],
);

/**
 * 配件与整机的 SKU 及其所属生产厂（R-FT-07：按 SKU 归属派发）：新建登记「寄配件」时按配件预填生产厂（R-AS-08）。
 * 真实的 SKU 与生产厂归属表由业务提供（待办 32），拿到后用迁移写入；在那之前只在非生产环境随示例数据灌入
 * （加载步骤 factory.parts）。第二期 P24 维护。
 */
export const part = factorySchema.table(
  'part',
  {
    id: primaryId(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    factoryId: uuid('factory_id')
      .notNull()
      .references(() => factory.id),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('part_sku_key').on(t.sku)],
);
