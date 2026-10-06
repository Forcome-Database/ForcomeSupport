// 「录入卖家授权」子命令（待办 12）：echo <刷新令牌> | node deploy/deploy.mjs <环境> sp-api-token --seller <卖家 ID>
// 用当前部署的版本起一次性容器执行 dist/sp-api-token.mjs；刷新令牌经标准输入传进容器（docker compose run -T，不分配终端），
// 不出现在命令行参数、shell 历史与输出里。容器用环境文件里的主密钥加密后存库。
import { parseArgs } from 'node:util';

export const SP_API_TOKEN_SYNOPSIS = 'sp-api-token --seller <卖家 ID>（刷新令牌从标准输入读）';

/** 卖家 ID（P18 的平台标识）：大写字母与数字 */
const SELLER_ID = /^[A-Z0-9]{8,20}$/;

/**
 * 子命令的参数 → 容器里的命令
 * @param {string[]} args 子命令后的参数
 * @returns {{ command: string[] } | { error: string }}
 */
export function spApiTokenRun(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: { seller: { type: 'string' } } });
  } catch (error) {
    return { error: `${error.message}\n用法：${SP_API_TOKEN_SYNOPSIS}` };
  }
  const seller = parsed.values.seller;
  if (!seller) return { error: `用法：${SP_API_TOKEN_SYNOPSIS}` };
  if (!SELLER_ID.test(seller)) {
    return { error: `卖家 ID 应为大写字母与数字（如 A1FD7Q2M9XK3LC）：${seller}` };
  }
  return { command: ['node', 'dist/sp-api-token.mjs', '--seller', seller] };
}
