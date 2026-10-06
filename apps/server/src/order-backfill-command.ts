import { parseArgs } from 'node:util';
import { listOrderStores } from './modules/channel';
import type { Runtime } from './modules/core';
import { ORDER_BACKFILL_DAYS } from '@forcome/contracts';
import { startOrderBackfill, type BackfillStart } from './modules/order';

/*
 * 「订单回补」命令（待办 13，协调者 2026-10-06 决定 Q1；ADR 0011 修订）：管理员上线前（选定 T0、回放邮件之前，待办 26）给亚马逊与
 * Shopify 店铺开始近 90 天的订单回补（Shopify 没开通 read_all_orders 时自动改为 60 天并记下）。命令只是登记并排上第一页，
 * worker 在后台逐页回补（低优先级，增量同步先走），进度在 P18 的亚马逊、Shopify 卡上。
 * --store 按店铺名选（可给多个），不给为全部订单店铺；已完成的跳过，--again 从头重来；还没做完的接着做。
 * 上线后新加的店铺不自动回补，再执行一次（已完成的店铺自动跳过，只补新店）。入口 src/order-backfill.ts，部署脚本子命令 order-backfill。
 */

export const ORDER_BACKFILL_USAGE =
  '用法：node dist/order-backfill.mjs [--store <店铺名>]…（不给为全部亚马逊与 Shopify 店铺） [--again]（已完成的从头重来）';

export interface OrderBackfillCommandIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const RESULT_TEXT: Record<BackfillStart['result'], string> = {
  started: `开始回补近 ${ORDER_BACKFILL_DAYS} 天的订单`,
  resumed: '上次的回补还没做完，接着回补',
  completed: '已回补完成，跳过（要从头重来加 --again）',
};

/** 执行命令，返回退出码 */
export async function runOrderBackfillCommand(
  args: readonly string[],
  options: {
    readonly startRuntime: () => Promise<{ runtime: Runtime; stop: () => Promise<void> }>;
    readonly io: OrderBackfillCommandIo;
  },
): Promise<number> {
  const { io } = options;
  let values: { store?: string[]; again?: boolean };
  try {
    values = parseArgs({
      args: [...args],
      options: { store: { type: 'string', multiple: true }, again: { type: 'boolean' } },
    }).values;
  } catch (error) {
    io.stderr(
      `${error instanceof Error ? error.message : String(error)}\n${ORDER_BACKFILL_USAGE}\n`,
    );
    return 2;
  }
  const { runtime, stop } = await options.startRuntime();
  try {
    const stores = await listOrderStores(runtime.db);
    if (stores.length === 0) {
      io.stderr('还没有亚马逊或 Shopify 店铺：先在 P18 登记店铺。\n');
      return 1;
    }
    let storeIds: string[] | undefined;
    if (values.store) {
      const unknown = values.store.filter((name) => !stores.some((s) => s.name === name));
      if (unknown.length > 0) {
        io.stderr(
          `没有这些店铺：${unknown.join('、')}（店铺名见 P18：${stores.map((s) => s.name).join('、')}）。\n`,
        );
        return 1;
      }
      storeIds = stores.filter((s) => values.store!.includes(s.name)).map((s) => s.id);
    }
    const results = await startOrderBackfill(runtime, listOrderStores, {
      storeIds,
      again: values.again ?? false,
    });
    for (const { store, result } of results) io.stdout(`${store.name}：${RESULT_TEXT[result]}\n`);
    if (results.some((r) => r.result !== 'completed')) {
      io.stdout('worker 在后台逐页回补（增量同步先走），进度见 P18 的亚马逊、Shopify 卡。\n');
    }
    return 0;
  } finally {
    await stop();
  }
}
