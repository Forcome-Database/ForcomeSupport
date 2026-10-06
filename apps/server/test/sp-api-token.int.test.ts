import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseCredentialVault } from '../src/modules/integration';
import { runSpApiTokenCommand } from '../src/sp-api-token-command';
import { startTestHarness, TEST_CREDENTIAL_MASTER_KEY, type TestHarness } from './harness';

/*
 * 「录入卖家授权」命令（待办 12；规格 order「刷新令牌加密存库」、ADR 0013 修订）：令牌从标准输入读，按卖家 ID 加密存给该卖家的亚马逊店铺；
 * 输出里不出现令牌。命令本身（runSpApiTokenCommand）在本测试的库上跑，运行时用测试工具的。
 */

const DIRECT = getDemoFixture().stores.find((s) => s.name === 'Forcome Direct')!;
const TOKEN = 'Atzr|IwEBIExampleRefreshToken0123456789';

let t: TestHarness;

beforeAll(async () => {
  t = await startTestHarness();
  await t.loadFixtures();
});

afterAll(async () => {
  await t.close();
});

async function run(
  args: string[],
  stdin: string,
  masterKey: Buffer | null = TEST_CREDENTIAL_MASTER_KEY,
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSpApiTokenCommand(args, stdin, {
    masterKey,
    startRuntime: () => Promise.resolve({ runtime: t.runtime, stop: () => Promise.resolve() }),
    io: { stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

describe('录入卖家授权的刷新令牌', () => {
  it('按卖家 ID 加密存给该卖家的亚马逊店铺；主密钥能读出原文；输出不含令牌', async () => {
    const result = await run(['--seller', DIRECT.platformId], `${TOKEN}\n`);
    expect(result).toEqual({
      code: 0,
      stdout: `已为 Forcome Direct（卖家 ${DIRECT.platformId}）录入卖家授权，刷新令牌已加密存库。\n`,
      stderr: '',
    });
    const stored = await databaseCredentialVault(t.runtime, TEST_CREDENTIAL_MASTER_KEY)!.read(
      'sp_api',
      DIRECT.id,
    );
    expect(stored?.secret).toBe(TOKEN);
    // 换授权时重跑：覆盖旧的
    const renewed = `${TOKEN}-renewed`;
    expect((await run(['--seller', DIRECT.platformId], renewed)).code).toBe(0);
    expect(
      (
        await databaseCredentialVault(t.runtime, TEST_CREDENTIAL_MASTER_KEY)!.read(
          'sp_api',
          DIRECT.id,
        )
      )?.secret,
    ).toBe(renewed);
  });

  it('卖家 ID 对不上亚马逊店铺、没给卖家 ID、标准输入不是刷新令牌、没有主密钥：不写库，退出码非 0，输出不含令牌', async () => {
    const unknown = await run(['--seller', 'A0NOSUCHSELLER'], TOKEN);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('没有平台标识为 A0NOSUCHSELLER 的亚马逊店铺');

    expect((await run([], TOKEN)).code).toBe(2);
    const wrong = await run(['--seller', DIRECT.platformId], 'shpat_not_an_lwa_token');
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain('不是 LWA 刷新令牌');
    expect(wrong.stderr).not.toContain('shpat_not_an_lwa_token');

    const noKey = await run(['--seller', DIRECT.platformId], TOKEN, null);
    expect(noKey.code).toBe(1);
    expect(noKey.stderr).toContain('CREDENTIAL_MASTER_KEY');
    for (const result of [unknown, noKey]) expect(result.stderr).not.toContain(TOKEN);
  });
});
