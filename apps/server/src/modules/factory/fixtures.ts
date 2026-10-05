import { eq } from 'drizzle-orm';
import { defineFixtureStep } from '../core';
import { factory, part } from './schema';

/**
 * 示例配件与 SKU 归属（原型 data.py 的 PARTS、PART_FACTORY，待办 19）：新建登记「寄配件」时按配件预填生产厂。
 * 只在非生产环境随示例数据灌入；生产环境的真实归属表由业务提供后用迁移写入（待办 32 跟踪）。
 * 生产厂本身由迁移 0012 写入所有环境，这里只按代码找到它。登记时间按示例顺序错开 1 毫秒，下拉顺序与原型一致；已存在的跳过。
 */
export const factoryPartsFixtureStep = defineFixtureStep({
  name: 'factory.parts',
  async load(tx, fixture) {
    for (const [index, fixturePart] of fixture.parts.entries()) {
      const [owner] = await tx.db
        .select({ id: factory.id })
        .from(factory)
        .where(eq(factory.code, fixturePart.factory))
        .limit(1);
      if (!owner)
        throw new Error(`示例配件 ${fixturePart.sku} 的生产厂 ${fixturePart.factory} 不存在`);
      await tx.db
        .insert(part)
        .values({
          sku: fixturePart.sku,
          name: fixturePart.name,
          category: fixturePart.category,
          factoryId: owner.id,
          createdAt: new Date(tx.now.getTime() + index),
        })
        .onConflictDoNothing({ target: part.sku });
    }
  },
});
