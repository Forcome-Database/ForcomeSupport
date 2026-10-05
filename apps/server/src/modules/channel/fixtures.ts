import type { Platform } from '@forcome/contracts';
import type { FixtureStore } from '@forcome/fixtures';
import { defineFixtureStep } from '../core';
import { senderRule, store, storeMailbox } from './schema';

const PLATFORM: Record<FixtureStore['platform'], Platform> = {
  亚马逊: 'amazon',
  Shopify: 'shopify',
};

/**
 * 示例店铺（原型 data.py 的 STORES，待办 07 种子）：4 个店铺沿用夹具里确定的 id，已存在则跳过；
 * 数据来源一律模拟数据（加载器只在非生产环境运行）。建立时间按示例数据的顺序错开 1 毫秒，
 * 店铺表按建立先后排序时与原型一致（Forcome Direct、Forcome Auto、forcome.com、forcome.mx）。
 */
export const channelStoresFixtureStep = defineFixtureStep({
  name: 'channel.stores',
  async load(tx, fixture) {
    for (const [index, fixtureStore] of fixture.stores.entries()) {
      const at = new Date(tx.now.getTime() + index);
      await tx.db
        .insert(store)
        .values({
          id: fixtureStore.id,
          name: fixtureStore.name,
          platform: PLATFORM[fixtureStore.platform],
          sites: fixtureStore.sites,
          defaultSite: fixtureStore.defaultSite,
          platformId: fixtureStore.platformId,
          adapterMode: 'fake',
          createdAt: at,
          updatedAt: at,
          updatedByName: null,
        })
        .onConflictDoNothing({ target: store.id });
      await tx.db
        .insert(storeMailbox)
        .values({
          storeId: fixtureStore.id,
          address: fixtureStore.mailbox.toLowerCase(),
          position: 0,
          createdAt: at,
        })
        .onConflictDoNothing({ target: storeMailbox.address });
    }
  },
});

/**
 * 示例生产厂的来信邮箱（原型 data.py 的 FACTORIES，待办 10）：登记为来源规则「生产厂」（精确地址），
 * 这些地址发来的信建工单并标注「生产厂」（AC-P1-04）。只在非生产环境随示例数据灌入；生产环境的真实名单
 * 由业务提供后用迁移登记（协调者 10-05 决定，待办 32 跟踪）。已登记的跳过。
 */
export const channelSenderRulesFixtureStep = defineFixtureStep({
  name: 'channel.sender_rules',
  async load(tx, fixture) {
    for (const factory of fixture.factories) {
      for (const address of factory.mailboxes) {
        await tx.db
          .insert(senderRule)
          .values({
            kind: 'address',
            pattern: address.trim().toLowerCase(),
            headerValue: null,
            source: 'producer',
            label: `${factory.code} 生产厂`,
            createdAt: tx.now,
          })
          .onConflictDoNothing();
      }
    }
  },
});
