import { adapterModes, platforms, sites } from '@forcome/contracts';
import { sql } from 'drizzle-orm';
import { index, integer, pgSchema, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz, version } from '../core';

/** channel 模块的数据库 schema（一个模块一个 schema，ADR 0006）；表随各期待办加入 */
export const channelSchema = pgSchema('channel');

/**
 * 店铺（PRD 11.1 Store、P18、K8）：来信按进线邮箱识别店铺，订单在店铺内匹配，成员按店铺授权数据范围。
 * 第一期没有签名与覆盖配置（第二阶段起再加列）。店铺名不分大小写唯一。不做物理删除。
 */
export const store = channelSchema.table(
  'store',
  {
    id: primaryId(),
    name: text('name').notNull(),
    platform: text('platform', { enum: platforms }).notNull(),
    /** 站点（多选，按 US · CA · MX 排序） */
    sites: text('sites', { enum: sites }).array().notNull(),
    /** 默认站点：无订单的来信按它归站点（D-23），是 sites 之一 */
    defaultSite: text('default_site', { enum: sites }).notNull(),
    /** 平台标识：亚马逊卖家 ID / Shopify 店铺域名 */
    platformId: text('platform_id').notNull(),
    /** 数据来源：真实接口 / 模拟数据（Fake，只在非生产环境可设，ADR 0009 修订）；店铺级客户端按它选择 */
    adapterMode: text('adapter_mode', { enum: adapterModes }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    /** 最近一次保存的人（姓名快照，G7「这条记录刚被某人修改」用）；示例数据等系统写入为空 */
    updatedByName: text('updated_by_name'),
    version: version(),
  },
  (t) => [uniqueIndex('store_name_key').on(sql`lower(${t.name})`)],
);

/**
 * 店铺的进线邮箱（可多个，含别名，D-26）：寄到这些地址的来信归到该店铺。地址存小写，全表唯一——
 * 一个地址只能属于一个店铺（P18「校验」）。编辑店铺时按新的列表整体替换。
 */
export const storeMailbox = channelSchema.table(
  'store_mailbox',
  {
    id: primaryId(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => store.id),
    address: text('address').notNull(),
    /** 在店铺里的显示顺序，从 0 开始 */
    position: integer('position').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    unique('store_mailbox_address_key').on(t.address),
    index('store_mailbox_store_idx').on(t.storeId),
  ],
);
