import { parseArgs } from 'node:util';
import { listOrderStores } from './modules/channel';
import type { Runtime } from './modules/core';
import { ORDER_BACKFILL_DAYS } from '@forcome/contracts';
import { orderStoreStatuses, startOrderBackfill, type BackfillStart } from './modules/order';

/*
 * 「订单回补」命令（待办 13，协调者 2026-10-06 决定 Q1；ADR 0011 修订）：管理员上线前（选定 T0、回放邮件之前，待办 26）给亚马逊与
 * Shopify 店铺开始近 90 天的订单回补（Shopify 没开通 read_all_orders 时自动改为 60 天并记下）。命令只是登记并排上第一页，
 * worker 在后台逐页回补（低优先级，增量同步先走），进度在 P18 的亚马逊、Shopify 卡上。
 * --store 按店铺名选（可给多个），不给为全部订单店铺；已完成的跳过，--again 从头重来；还没做完的接着做。
 * 上线后新加的店铺不自动回补，再执行一次（已完成的店铺自动跳过，只补新店）。入口 src/order-backfill.ts，部署脚本子命令 order-backfill。
 * 订单同步还没连上的店铺（例如还没配置凭据或卖家授权）照样登记，但先取不到：worker 每 10 分钟续跑一次，连上后自动开始、不用再执行；
 * 这期间 P18 只汇总连上的店铺，看不到它的进度——输出里逐个写明，不让管理员以为已经在回补（协调者验收返工）。
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

/** 订单同步还没连上的店铺：已登记，但先取不到 */
const NOT_CONNECTED_TEXT: Record<Exclude<BackfillStart['result'], 'completed'>, string> = {
  started: `已登记近 ${ORDER_BACKFILL_DAYS} 天的订单回补`,
  resumed: '已登记的回补还没做完',
};
const NOT_CONNECTED_NOTE =
  '订单同步还没连上（例如还没配置凭据或卖家授权），暂时取不到订单，P18 也不显示它的进度；连上后 10 分钟内自动开始，不用再执行';

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
    const statuses = await orderStoreStatuses(
      runtime.db,
      results.map((r) => r.store),
      runtime.clock.now(),
    );
    let running = 0;
    for (const { store, result } of results) {
      if (result !== 'completed' && statuses.get(store.id) === 'not_connected') {
        io.stdout(`${store.name}：${NOT_CONNECTED_TEXT[result]}；${NOT_CONNECTED_NOTE}\n`);
        continue;
      }
      if (result !== 'completed') running += 1;
      io.stdout(`${store.name}：${RESULT_TEXT[result]}\n`);
    }
    if (running > 0) {
      io.stdout('worker 在后台逐页回补（增量同步先走），进度见 P18 的亚马逊、Shopify 卡。\n');
    }
    return 0;
  } finally {
    await stop();
  }
}
