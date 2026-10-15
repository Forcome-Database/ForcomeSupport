import { QIYE_IMAP_DEFAULTS, type Platform } from '@forcome/contracts';
import type { FixtureStore } from '@forcome/fixtures';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { defineFixtureStep } from '../core';
import { mailboxSync, store, storeMailbox } from './schema';
import { registerSenderRule } from './sender-rules';

const PLATFORM: Record<FixtureStore['platform'], Platform> = {
  亚马逊: 'amazon',
  Shopify: 'shopify',
};

/**
 * 示例店铺（原型 data.py 的 STORES，待办 07 种子）：4 个店铺沿用夹具里确定的 id，已存在则跳过；
 * 数据来源一律模拟数据（加载器只在非生产环境运行）。建立时间按示例数据的顺序错开 1 毫秒，
 * 店铺表按建立先后排序时与原型一致（Forcome Direct、Forcome Auto、forcome.com、forcome.mx）。
 * 进线邮箱的服务商按夹具（待办 35：Forcome Auto 的 amz-auto@forcome.com 为 163 企业邮箱，IMAP 服务器与端口取默认值）；
 * 加服务商之前灌进库的示例店铺（迁移 0038 一律补成 Gmail）在没被人改过（updated_by_name 为空）时按夹具改过来。
 * 163 企业邮箱的模拟授权码要主密钥加密，不在这一步：灌完数据后由 seedDemoData 存（integration 的 seedFixtureMailboxAuthCodes）。
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
      const mailbox = {
        provider: fixtureStore.provider,
        imapHost: fixtureStore.provider === 'qiye163' ? QIYE_IMAP_DEFAULTS.host : null,
        imapPort: fixtureStore.provider === 'qiye163' ? QIYE_IMAP_DEFAULTS.port : null,
      };
      const address = fixtureStore.mailbox.toLowerCase();
      await tx.db
        .insert(storeMailbox)
        .values({ storeId: fixtureStore.id, address, position: 0, ...mailbox, createdAt: at })
        .onConflictDoNothing({ target: storeMailbox.address });
      const [stale] = await tx.db
        .select({ id: storeMailbox.id })
        .from(storeMailbox)
        .innerJoin(store, eq(store.id, storeMailbox.storeId))
        .where(
          and(
            eq(storeMailbox.storeId, fixtureStore.id),
            eq(storeMailbox.address, address),
            ne(storeMailbox.provider, mailbox.provider),
            isNull(store.updatedByName),
          ),
        )
        .limit(1);
      if (stale) {
        await tx.db.update(storeMailbox).set(mailbox).where(eq(storeMailbox.id, stale.id));
        // 服务商换了：同步记录从头算（同 P18 改服务商，stores.ts）
        await tx.db.delete(mailboxSync).where(eq(mailboxSync.address, address));
      }
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
        await registerSenderRule(tx, {
          kind: 'address',
          pattern: address,
          headerValue: null,
          source: 'producer',
          label: `${factory.code} 生产厂`,
        });
      }
    }
  },
});
