// 示例数据的加载步骤总表（待办 02）：各模块建表后在自己的待办里定义加载步骤（core 的 defineFixtureStep），
// 从模块的 index.ts 导出并加到这里（成员在 04、工单在 08、台账在 19）。pnpm db:seed、Playwright 与测试共用。
import { channelStoresFixtureStep } from './modules/channel';
import type { FixtureStep } from './modules/core';
import { orgMembersFixtureStep } from './modules/org';

export const fixtureSteps: readonly FixtureStep[] = [
  orgMembersFixtureStep,
  channelStoresFixtureStep,
];
