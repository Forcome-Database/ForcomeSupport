import { z } from 'zod';

/**
 * P13 地址栏里的筛选条件（TanStack Router 按它校验，ADR 0007）：missing 是点页头完整率「筛出缺字段的 N 单」，只列当月
 * 缺字段的已完成单；写错的条件丢掉。筛选行的其余条件（日期、店铺、处理方式等）随待办 22。
 */
export const ledgerSearchSchema = z.object({
  missing: z.literal('1').optional().catch(undefined),
});
export type LedgerSearch = z.infer<typeof ledgerSearchSchema>;
