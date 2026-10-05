// 示例数据的加载步骤总表（待办 02）：各模块建表后在自己的待办里定义加载步骤（core 的 defineFixtureStep），
// 从模块的 index.ts 导出并加到这里（成员在 04、工单在 08、台账在 19、站内通知在 31）。pnpm db:seed、Playwright 与测试共用。
import { aftersalesLedgerFixtureStep } from './modules/aftersales';
import { channelSenderRulesFixtureStep, channelStoresFixtureStep } from './modules/channel';
import { coreNotificationsFixtureStep, type FixtureStep } from './modules/core';
import { factoryPartsFixtureStep } from './modules/factory';
import { orgMembersFixtureStep } from './modules/org';

/** 按依赖先后：台账引用成员与店铺，站内通知引用成员 */
export const fixtureSteps: readonly FixtureStep[] = [
  orgMembersFixtureStep,
  channelStoresFixtureStep,
  channelSenderRulesFixtureStep,
  factoryPartsFixtureStep,
  aftersalesLedgerFixtureStep,
  coreNotificationsFixtureStep,
];
