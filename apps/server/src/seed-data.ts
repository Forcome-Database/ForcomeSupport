import { demoFixture } from '@forcome/fixtures';
import { fixtureSteps } from './fixtures';
import {
  loadFixtures,
  startRuntime,
  type AppEnv,
  type FixtureLoadReport,
  type Logger,
} from './modules/core';

/**
 * 把示例数据夹具灌进指定的库（迁移要先执行）。pnpm db:seed 与 Playwright 的 e2e api 共用；
 * 加载步骤登记在 fixtures.ts。生产环境拒绝（loadFixtures 里判断）。
 */
export async function seedDemoData(
  databaseUrl: string,
  appEnv: AppEnv,
  logger: Logger,
): Promise<FixtureLoadReport> {
  const { runtime, stop } = await startRuntime(databaseUrl, { role: 'api', logger, poolMax: 1 });
  try {
    return await loadFixtures(runtime, { appEnv, fixture: demoFixture, steps: fixtureSteps });
  } finally {
    await stop({ graceful: false });
  }
}
