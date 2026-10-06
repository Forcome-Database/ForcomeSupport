import { parseArgs } from 'node:util';
import { listOrderStores } from './modules/channel';
import type { Runtime } from './modules/core';
import { databaseCredentialVault, storeSpApiRefreshToken } from './modules/integration';

/*
 * 「录入卖家授权」命令（待办 12，ADR 0013 修订）：SP-API 私有应用在 Seller Central 自授权后得到的刷新令牌，按卖家 ID 录给该卖家的
 * 亚马逊店铺（P18 的平台标识），用主密钥 AES-256-GCM 加密存进 integration.credential。令牌从标准输入读（不进命令行参数与 shell 历史，
 * 也不出现在任何输出里）；卖家 ID 对不上任何亚马逊店铺时退出码为 1。之后该店铺的订单同步用它换访问令牌，没录入的店铺为「未连接」。
 * 换授权（令牌被撤销、重新自授权）时重跑一次，覆盖旧的。入口 src/sp-api-token.ts，部署脚本子命令 sp-api-token。
 */

export const SP_API_TOKEN_USAGE =
  '用法：echo <刷新令牌> | node dist/sp-api-token.mjs --seller <卖家 ID>（令牌从标准输入读）';

/** LWA 刷新令牌的样子（Atzr| 开头）；只防贴错，不校验真伪（真伪在换访问令牌时才知道） */
const REFRESH_TOKEN = /^Atzr\|\S{10,}$/;

export interface SpApiTokenCommandIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** 执行命令，返回退出码 */
export async function runSpApiTokenCommand(
  args: readonly string[],
  stdin: string,
  options: {
    readonly masterKey: Buffer | null;
    readonly startRuntime: () => Promise<{ runtime: Runtime; stop: () => Promise<void> }>;
    readonly io: SpApiTokenCommandIo;
  },
): Promise<number> {
  const { io } = options;
  let seller: string | undefined;
  try {
    seller = parseArgs({ args: [...args], options: { seller: { type: 'string' } } }).values.seller;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${SP_API_TOKEN_USAGE}\n`);
    return 2;
  }
  const token = stdin.trim();
  if (!seller) {
    io.stderr(`没有给出卖家 ID。\n${SP_API_TOKEN_USAGE}\n`);
    return 2;
  }
  if (!REFRESH_TOKEN.test(token)) {
    io.stderr(`标准输入里不是 LWA 刷新令牌（应以 Atzr| 开头）。\n${SP_API_TOKEN_USAGE}\n`);
    return 2;
  }
  if (!options.masterKey) {
    io.stderr(
      '没有配置主密钥 CREDENTIAL_MASTER_KEY，刷新令牌无法加密存库（docs/部署说明.md 第 14 节）。\n',
    );
    return 1;
  }
  const { runtime, stop } = await options.startRuntime();
  try {
    const vault = databaseCredentialVault(runtime, options.masterKey);
    if (!vault) throw new Error('主密钥不可用');
    const stores = (await listOrderStores(runtime.db)).filter(
      (s) => s.platform === 'amazon' && s.platformId === seller,
    );
    if (stores.length === 0) {
      io.stderr(`没有平台标识为 ${seller} 的亚马逊店铺：先在 P18 登记店铺，或检查卖家 ID。\n`);
      return 1;
    }
    for (const store of stores) {
      await storeSpApiRefreshToken(vault, store.id, token, runtime.clock.now());
      io.stdout(`已为 ${store.name}（卖家 ${seller}）录入卖家授权，刷新令牌已加密存库。\n`);
    }
    return 0;
  } finally {
    await stop();
  }
}
