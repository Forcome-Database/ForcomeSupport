import { notificationObjectTypeSchema, notificationTypeSchema } from '@forcome/contracts';
import { defineFixtureStep } from './fixtures';
import { notification } from './schema';

/**
 * 示例站内通知（原型 G10 周敏的面板，只有第一期的类型）：本机与开发测试环境的演示、截图对照用。
 * 按夹具里的确定性 id 写入、已有的跳过（标过已读的不会被重置）；接收人按成员 key 取夹具里成员的 id（成员由 org.members 灌入）。
 */
export const coreNotificationsFixtureStep = defineFixtureStep({
  name: 'core.notifications',
  after: ['org.members'],
  async load(tx, fixture) {
    if (fixture.notifications.length === 0) return;
    const memberIds = new Map(fixture.members.map((m) => [m.key, m.id]));
    await tx.db
      .insert(notification)
      .values(
        fixture.notifications.map((n) => {
          const recipientId = memberIds.get(n.recipientKey);
          if (!recipientId) throw new Error(`示例通知的接收人 ${n.recipientKey} 不在示例成员里`);
          const at = new Date(n.at);
          return {
            id: n.id,
            recipientId,
            type: notificationTypeSchema.parse(n.type),
            title: n.title,
            body: n.body,
            objectType: notificationObjectTypeSchema.parse(n.object.type),
            objectId: n.object.id,
            objectLabel: n.object.label,
            storeId: null,
            createdAt: at,
            readAt: n.read ? at : null,
          };
        }),
      )
      .onConflictDoNothing({ target: notification.id });
  },
});
