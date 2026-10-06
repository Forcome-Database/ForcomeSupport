import { index, integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from '../core';

/** integration 模块的数据库 schema（一个模块一个 schema，ADR 0006）；表随各期待办加入 */
export const integrationSchema = pgSchema('integration');

/**
 * 外部调用记录（规格 integration「每次外部调用写一条调用记录」、ADR 0009，待办 09）：真实现经出站 HTTP 客户端工厂的每次调用
 * 一行——系统、动作、店铺、耗时、状态码、请求与响应摘要，供排错（第一期没有查看页面，查库；P26 随第二期）。
 * Fake 不是外部调用，不记。摘要只截前一段，访问凭证与密钥不写进来（请求摘要写方法与地址，查询参数里像凭证的值换成 ***）。
 */
export const callRecord = integrationSchema.table(
  'call_record',
  {
    id: primaryId(),
    /** 外部系统名（gmail、gmail_push、dingtalk、exchange_rate…） */
    system: text('system').notNull(),
    /** 动作（接口），如 users.history.list */
    operation: text('operation').notNull(),
    /** 店铺级客户端的店铺；全局客户端为空 */
    storeId: uuid('store_id'),
    startedAt: timestamptz('started_at').notNull(),
    durationMs: integer('duration_ms').notNull(),
    /** 结果：成功 / 接口返回错误 / 超时 / 网络错误 */
    outcome: text('outcome', { enum: ['ok', 'failed', 'timeout', 'network'] }).notNull(),
    /** HTTP 状态码；没有响应（超时、网络错误）为空 */
    status: integer('status'),
    /** 请求摘要：方法与地址（查询参数里像凭证的值换成 ***） */
    request: text('request').notNull(),
    /** 响应摘要：响应体的前一段，或错误说明 */
    response: text('response'),
  },
  (t) => [index('call_record_system_started_idx').on(t.system, t.startedAt)],
);
