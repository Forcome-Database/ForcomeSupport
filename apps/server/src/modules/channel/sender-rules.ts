import type { DbExecutor, Tx } from '../core';
import type { SenderRule } from './recognition';
import { senderRule } from './schema';

/*
 * 来源规则表的读写（规格 channel「来源识别」）：识别时读全部规则；登记一条规则用于示例数据（示例生产厂邮箱）与测试。
 * 第一期没有维护页面：平台通知与营销的种子由迁移写入，生产环境的真实生产厂邮箱与其他供应商名单也写迁移补（ADR 0006 修订）。
 */

/** 全部来源规则（每次同步一个邮箱读一次：规则只随迁移与示例数据变，读一次足够新） */
export async function loadSenderRules(db: DbExecutor): Promise<SenderRule[]> {
  return db
    .select({
      kind: senderRule.kind,
      pattern: senderRule.pattern,
      headerValue: senderRule.headerValue,
      source: senderRule.source,
    })
    .from(senderRule);
}

/** 登记一条来源规则（地址、发件域、头字段名与值都转小写）；同样的规则已登记则跳过 */
export async function registerSenderRule(
  tx: Tx,
  rule: SenderRule & { readonly label: string },
): Promise<void> {
  await tx.db
    .insert(senderRule)
    .values({
      kind: rule.kind,
      pattern: rule.pattern.trim().toLowerCase(),
      headerValue: rule.headerValue?.trim().toLowerCase() ?? null,
      source: rule.source,
      label: rule.label,
      createdAt: tx.now,
    })
    .onConflictDoNothing();
}
