import { asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../core';
import { factory, part } from './schema';

/*
 * 生产厂与 SKU 归属的读服务（R-FT-07）。第一期只有台账用：新建登记的「生产厂」下拉、按配件预填生产厂、
 * 保存时核对生产厂与配件存在（待办 19）。生产厂与配件不属于任何店铺，不带店铺范围。
 */

export interface FactoryOption {
  readonly code: string;
}

export interface PartOption {
  readonly sku: string;
  readonly name: string;
  /** 所属生产厂代码 */
  readonly factory: string;
}

/** 全部生产厂，按代码排序 */
export async function listFactories(db: DbExecutor): Promise<FactoryOption[]> {
  return db.select({ code: factory.code }).from(factory).orderBy(asc(factory.code));
}

/** 全部配件与所属生产厂，按 SKU 登记先后 */
export async function listParts(db: DbExecutor): Promise<PartOption[]> {
  return db
    .select({ sku: part.sku, name: part.name, factory: factory.code })
    .from(part)
    .innerJoin(factory, eq(factory.id, part.factoryId))
    .orderBy(asc(part.createdAt), asc(part.id));
}
