import { businessDate } from '@forcome/calendar';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from './runtime';
import { businessNumberCounter } from './schema';

/**
 * 业务编号（规格「数据约定」）：在业务事务内生成，与业务数据同时提交；事务回滚则号不被占用。
 * - 工单 `T-日期-4 位当日序号`：日期取首封来信日期（回放同样适用），按北京时间每天从 0001 起；
 * - 售后单 `S-创建日期-4 位全局序号`：序号全局递增、不按日重置；历史导入的日期取原登记日期。
 * 第二期的审批单、结算批次在这里加规则。
 */
const RULES = {
  ticket: { prefix: 'T', perDay: true },
  aftersales: { prefix: 'S', perDay: false },
} as const;

export type BusinessNumberKind = keyof typeof RULES;

/**
 * 取下一个业务编号。
 * @param at 编号日期所依据的时刻（工单为首封来信时间，售后单为创建时间），按北京时间取日期
 */
export async function nextBusinessNumber(
  tx: Tx,
  kind: BusinessNumberKind,
  at: Date,
): Promise<string> {
  const rule = RULES[kind];
  const date = businessDate(at).replaceAll('-', '');
  const period = rule.perDay ? date : 'all';
  // 同一行上的 upsert 会排队：并发事务依次拿到 1、2、3……，不会重号
  const [row] = await tx.db
    .insert(businessNumberCounter)
    .values({ kind, period, lastValue: 1 })
    .onConflictDoUpdate({
      target: [businessNumberCounter.kind, businessNumberCounter.period],
      set: { lastValue: sql`${businessNumberCounter.lastValue} + 1` },
    })
    .returning({ value: businessNumberCounter.lastValue });
  if (!row) {
    throw new Error(`业务编号生成失败：${kind}`);
  }
  return `${rule.prefix}-${date}-${String(row.value).padStart(4, '0')}`;
}

/**
 * 清掉某类业务编号的计数，之后从 0001 重新发号。只用于非生产环境的「重放来信」（该类对象已全部清掉时），
 * 生产环境的编号不回收、不重用。
 */
export async function resetBusinessNumbers(tx: Tx, kind: BusinessNumberKind): Promise<void> {
  await tx.db.delete(businessNumberCounter).where(eq(businessNumberCounter.kind, kind));
}
