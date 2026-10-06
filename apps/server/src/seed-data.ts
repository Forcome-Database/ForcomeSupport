import { getDemoFixture } from '@forcome/fixtures';
import { fixtureSteps } from './fixture-steps';
import { listOrderStores } from './modules/channel';
import {
  loadFixtures,
  startRuntime,
  type AppEnv,
  type FixtureLoadReport,
  type Logger,
} from './modules/core';
import { startOrderBackfill } from './modules/order';

/**
 * 把示例数据夹具灌进指定的库（迁移要先执行）。pnpm db:seed 与 Playwright 的 e2e api 共用；
 * 加载步骤登记在 fixture-steps.ts。生产环境拒绝（loadFixtures 里判断）。
 * 灌完后像上线前那样开始订单回补（待办 13，同部署子命令 order-backfill；已完成的跳过）：worker 起来后逐页回补 Fake 回放的
 * 历史订单，P18 两张卡的回补行与原型一致（亚马逊 90 天已完成、Shopify 没开通 read_all_orders 只回补 60 天）。
 * 不放进加载步骤：集成测试灌示例数据后要自己决定回补与否。
 */
export async function seedDemoData(
  databaseUrl: string,
  appEnv: AppEnv,
  logger: Logger,
): Promise<FixtureLoadReport> {
  const { runtime, stop } = await startRuntime(databaseUrl, { role: 'api', logger, poolMax: 1 });
  try {
    const report = await loadFixtures(runtime, {
      appEnv,
      fixture: getDemoFixture(),
      steps: fixtureSteps,
    });
    const backfills = await startOrderBackfill(runtime, listOrderStores);
    logger.info({ stores: backfills.length }, '示例数据：已开始订单回补（worker 逐页回补）');
    return report;
  } finally {
    await stop({ graceful: false });
  }
}
