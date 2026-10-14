import {
  NOTIFICATION_LIST_LIMIT,
  notificationTypeDefinitions,
  type Notification,
  type NotificationContent,
  type NotificationView,
} from '@forcome/contracts';
import { and, count, desc, eq, isNull, or, type SQL } from 'drizzle-orm';
import { announceChange } from './changes';
import type { DbExecutor } from './db';
import type { Tx } from './runtime';
import { notification } from './schema';
import { storeScopeCondition, type StoreScope } from './store-scope';

/*
 * 站内通知（PRD 11.1 Notification、11.4、G10，待办 31）。写入只经这里（或 org 按 11.4 取接收人的 notifyMembers）：
 * 其他模块在自己的业务事务里调用，通知与业务数据同时提交；需要同时发钉钉工作通知的类型（11.4「渠道」）由调用方另行发送。
 * 历史回放（Runtime.replay，待办 26）里写入不产生通知（规格「历史导入与切换」）。
 */

/** 写入接口的参数（PRD 11.1：接收人、类型、关联对象、内容；时间取事务的当前时间）。内容的结构在 contracts */
export interface NotificationDraft extends NotificationContent {
  /** 接收人（成员 ID）；重复的只写一条 */
  readonly recipientIds: readonly string[];
}

/**
 * 写入站内通知：每个接收人一条，时间是事务的当前时间（tx.now）。返回写给了谁（去重后的成员 ID）；
 * 回放模式下什么也不写，返回空列表（调用方据此也不发钉钉工作通知）。
 */
export async function sendNotification(tx: Tx, draft: NotificationDraft): Promise<string[]> {
  if (notificationTypeDefinitions[draft.type].storeScoped && !draft.storeId) {
    throw new Error(`通知 ${draft.type} 按店铺发，必须给出关联对象所属的店铺`);
  }
  if (tx.replay) return [];
  const recipients = [...new Set(draft.recipientIds)];
  if (recipients.length === 0) return [];
  await tx.db.insert(notification).values(
    recipients.map((recipientId) => ({
      recipientId,
      type: draft.type,
      title: draft.title,
      body: draft.body,
      objectType: draft.object.type,
      objectId: draft.object.id,
      objectLabel: draft.object.label,
      storeId: draft.storeId ?? null,
      createdAt: tx.now,
    })),
  );
  // 铃铛与面板经 SSE 自动刷新（待办 18）：只推给接收人
  await announceChange(tx, { topic: 'notifications', memberIds: recipients });
  return recipients;
}

/** 看通知的人：接收人本人与他当前的店铺范围（接口里由 org 按访问上下文给出） */
export interface NotificationViewer {
  readonly memberId: string;
  readonly stores: StoreScope;
}

/** 看得到的通知：自己的，且对象没有店铺属性或店铺在他当前的范围内（范围收窄后，范围外的旧通知不再显示） */
function visibleTo(viewer: NotificationViewer): SQL | undefined {
  const inScope = storeScopeCondition(viewer.stores, notification.storeId);
  return and(
    eq(notification.recipientId, viewer.memberId),
    inScope === undefined ? undefined : or(isNull(notification.storeId), inScope),
  );
}

/** 未读数（铃铛）：店铺范围内的全部未读 */
export async function countUnreadNotifications(
  db: DbExecutor,
  viewer: NotificationViewer,
): Promise<number> {
  const [row] = await db
    .select({ unread: count() })
    .from(notification)
    .where(and(visibleTo(viewer), isNull(notification.readAt)));
  return row?.unread ?? 0;
}

/** 面板的一个页签：新的在前，最多 NOTIFICATION_LIST_LIMIT 条，另带未读总数 */
export async function listNotifications(
  db: DbExecutor,
  viewer: NotificationViewer,
  view: NotificationView = 'all',
): Promise<{ items: Notification[]; unread: number }> {
  const rows = await db
    .select()
    .from(notification)
    .where(and(visibleTo(viewer), view === 'unread' ? isNull(notification.readAt) : undefined))
    // 同一时刻写的几条（同一事务）按写入先后：UUIDv7 随写入递增
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(NOTIFICATION_LIST_LIMIT);
  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      object: { type: row.objectType, id: row.objectId, label: row.objectLabel },
      createdAt: row.createdAt.toISOString(),
      read: row.readAt !== null,
    })),
    unread: await countUnreadNotifications(db, viewer),
  };
}

/**
 * 标为已读（点了一条）：已读的保持原来的已读时间。接收人看不到的（不是他的、不存在、在他当前的店铺范围外）返回 false
 */
export async function markNotificationRead(
  tx: Tx,
  viewer: NotificationViewer,
  id: string,
): Promise<boolean> {
  const [row] = await tx.db
    .select({ readAt: notification.readAt })
    .from(notification)
    .where(and(eq(notification.id, id), visibleTo(viewer)))
    .limit(1);
  if (!row) return false;
  if (row.readAt === null) {
    await tx.db
      .update(notification)
      .set({ readAt: tx.now })
      .where(and(eq(notification.id, id), isNull(notification.readAt)));
    // 同一成员开着的其他标签页跟着刷新
    await announceChange(tx, { topic: 'notifications', memberIds: [viewer.memberId] });
  }
  return true;
}

/**
 * 全部已读：接收人看得到的未读全部标为已读（与角标的未读数同一个范围；店铺范围外的不动，范围放宽后它们照常是未读），
 * 返回标了几条
 */
export async function markAllNotificationsRead(
  tx: Tx,
  viewer: NotificationViewer,
): Promise<number> {
  const rows = await tx.db
    .update(notification)
    .set({ readAt: tx.now })
    .where(and(visibleTo(viewer), isNull(notification.readAt)))
    .returning({ id: notification.id });
  if (rows.length > 0) {
    await announceChange(tx, { topic: 'notifications', memberIds: [viewer.memberId] });
  }
  return rows.length;
}
