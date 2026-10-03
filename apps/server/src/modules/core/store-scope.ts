import type { StoreScopeValue } from '@forcome/contracts';
import { inArray, sql, type Column, type SQL } from 'drizzle-orm';

declare const storeScopeBrand: unique symbol;

/**
 * 店铺数据范围（R-ST-06、ADR 0010）：各模块的仓储查询必须把它作为参数（缺了编译不过），
 * 查询时用 storeScopeCondition 加到 where 上。不用 RLS，范围在应用层强制。
 *
 * 带品牌的类型，不能用对象字面量冒充，只有两个来源，评审时检查它们的调用方：
 * - 请求里的范围由 org 按当前成员构造（接口里取 c.get('access').stores）；
 * - 后台任务、同步等系统操作不受店铺范围限制，用 SYSTEM_STORE_SCOPE；接口里不直接用它——
 *   详情接口要先取出对象才知道它属于哪个店铺，用 org 的 access.findOwned（取对象并校验归属，越权记审计）。
 * 报表（report）直接读各模块的表，绕过了仓储层，每个视图查询也要用 storeScopeCondition 显式过滤。
 */
export type StoreScope = { readonly [storeScopeBrand]: true } & (
  { readonly all: true } | { readonly all: false; readonly storeIds: readonly string[] }
);

/** 成员的店铺范围（只由 org 在建立访问上下文时调用）：全部店铺（含以后新增的）或指定的几个店铺 */
export function memberStoreScope(member: {
  readonly allStores: boolean;
  readonly storeIds: readonly string[];
}): StoreScope {
  return (
    member.allStores ? { all: true } : { all: false, storeIds: [...new Set(member.storeIds)] }
  ) as StoreScope;
}

/** 系统操作（后台任务、同步、扫描）的范围：全部店铺；接口里只经 org 的 access.findOwned 间接使用 */
export const SYSTEM_STORE_SCOPE = { all: true } as StoreScope;

/** 这个店铺是否在范围内 */
export function isStoreInScope(scope: StoreScope, storeId: string): boolean {
  return scope.all || scope.storeIds.includes(storeId);
}

/** 不在范围内的店铺（越权的部分，E-24） */
export function storesOutsideScope(scope: StoreScope, storeIds: readonly string[]): string[] {
  return [...new Set(storeIds)].filter((storeId) => !isStoreInScope(scope, storeId));
}

/**
 * 查询条件：全部店铺时不加条件（返回 undefined，drizzle 的 and() 会忽略它），
 * 否则「店铺列 ∈ 授权店铺」；没有任何授权店铺时条件恒假。店铺为空的行（如未归属店铺的来信）不在范围内，
 * 需要例外可见的查询（客服主管的未归属队列，PRD I17）由调用方另写条件。
 */
export function storeScopeCondition(scope: StoreScope, storeColumn: Column): SQL | undefined {
  if (scope.all) return undefined;
  if (scope.storeIds.length === 0) return sql`false`;
  return inArray(storeColumn, [...scope.storeIds]);
}

/** 接口里返回给前端的形状（/api/me 的 stores） */
export function storeScopeValue(scope: StoreScope): StoreScopeValue {
  return scope.all ? { all: true } : { all: false, storeIds: [...scope.storeIds] };
}
