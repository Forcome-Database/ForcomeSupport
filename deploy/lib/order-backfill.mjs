// 「订单回补」子命令（待办 13）：node deploy/deploy.mjs <环境> order-backfill [--store <店铺名>]… [--again]
// 用当前部署的版本起一次性容器执行 dist/order-backfill.mjs：给店铺开始近 90 天的订单回补，worker 在后台逐页做，进度见 P18。
// 上线前、选定 T0 与回放邮件之前执行（docs/部署说明.md 第 15 节）。
import { parseArgs } from 'node:util';

export const ORDER_BACKFILL_SYNOPSIS = 'order-backfill [--store <店铺名>]… [--again]';

/**
 * 子命令的参数 → 容器里的命令
 * @param {string[]} args 子命令后的参数
 * @returns {{ command: string[] } | { error: string }}
 */
export function orderBackfillRun(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { store: { type: 'string', multiple: true }, again: { type: 'boolean' } },
    });
  } catch (error) {
    return { error: `${error.message}\n用法：${ORDER_BACKFILL_SYNOPSIS}` };
  }
  const stores = parsed.values.store ?? [];
  if (stores.some((name) => name.trim() === '')) {
    return { error: `店铺名不能为空\n用法：${ORDER_BACKFILL_SYNOPSIS}` };
  }
  return {
    command: [
      'node',
      'dist/order-backfill.mjs',
      ...stores.flatMap((name) => ['--store', name]),
      ...(parsed.values.again ? ['--again'] : []),
    ],
  };
}
