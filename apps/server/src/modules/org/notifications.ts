import {
  apiErrorSchema,
  notificationListSchema,
  notificationQuerySchema,
  notificationTypeDefinitions,
  notificationUnreadSchema,
  type NotificationContent,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, arrayOverlaps, eq } from 'drizzle-orm';
import {
  countUnreadNotifications,
  isStoreInScope,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  memberStoreScope,
  queueWorkNotifications,
  sendNotification,
  transaction,
  type AppEnv,
  type NotificationViewer,
  type Runtime,
  type Tx,
} from '../core';
import { requireSession, type Access, type AccessVariables } from './access';
import { json, unauthenticated } from './openapi';
import { member } from './schema';

/*
 * 站内通知（PRD 11.4、G10，待办 31）在 org 的两部分：
 * - 按 11.4 取接收人：notifyMembers 给有该类型接收人角色的在职成员写通知（core 的 sendNotification），按店铺发的类型
 *   只发给店铺范围包含该店铺的（R-ST-06）；11.4「渠道」里有钉钉工作通知的类型，同时给同一批人排入钉钉工作通知
 *   （core 的 queueWorkNotifications，同一人 5 分钟内合并发出，待办 05）。业务模块（channel、ticket、aftersales）在自己的事务里调用它；
 * - 铃铛面板的接口：查看、未读数、标为已读与全部已读，都只针对当前成员自己的通知（任何角色都有铃铛，不要求能力）。
 * 标记已读是个人的界面状态，不记审计（同密度偏好）。
 */

/**
 * 按 11.4 发站内通知：接收人是有该类型接收人角色之一的在职成员（多角色只收一条）；按店铺发的类型只发给店铺范围包含
 * 关联对象店铺的成员。要同时发钉钉工作通知的类型（11.4「渠道」，contracts 的 definition.dingtalk）给同一批人中有钉钉账号的
 * 排入工作通知。返回发给了谁（成员 ID）；历史回放里都不发，返回空列表。
 */
export async function notifyMembers(tx: Tx, content: NotificationContent): Promise<string[]> {
  const definition = notificationTypeDefinitions[content.type];
  const candidates = await tx.db
    .select({
      id: member.id,
      allStores: member.allStores,
      storeIds: member.storeIds,
      dingtalkUserId: member.dingtalkUserId,
    })
    .from(member)
    .where(
      and(eq(member.status, 'active'), arrayOverlaps(member.roles, [...definition.recipients])),
    )
    .orderBy(member.id);
  const storeId = content.storeId;
  const recipients = candidates.filter(
    (row) => !definition.storeScoped || !storeId || isStoreInScope(memberStoreScope(row), storeId),
  );
  const sent = await sendNotification(tx, {
    ...content,
    recipientIds: recipients.map((row) => row.id),
  });
  if (definition.dingtalk && sent.length > 0) {
    const sentTo = new Set(sent);
    await queueWorkNotifications(tx, {
      type: content.type,
      title: content.title,
      body: content.body,
      object: content.object,
      recipients: recipients.flatMap((row) =>
        sentTo.has(row.id) && row.dingtalkUserId
          ? [{ memberId: row.id, dingtalkUserId: row.dingtalkUserId }]
          : [],
      ),
    });
  }
  return sent;
}

const listRoute = createRoute({
  method: 'get',
  path: '/api/notifications',
  summary:
    '铃铛面板（G10）：当前成员的通知，新的在前（最多 50 条；view=unread 只列未读），另带未读总数；店铺范围外的不列（R-ST-06）',
  request: { query: notificationQuerySchema },
  responses: {
    200: json(notificationListSchema, '通知与未读数'),
    400: json(apiErrorSchema, '页签不对'),
    401: unauthenticated,
  },
});

const unreadRoute = createRoute({
  method: 'get',
  path: '/api/notifications/unread-count',
  summary: '铃铛的未读数（前端轮询，带后台请求头，不续期会话）',
  responses: {
    200: json(notificationUnreadSchema, '未读数'),
    401: unauthenticated,
  },
});

const readRoute = createRoute({
  method: 'post',
  path: '/api/notifications/{id}/read',
  summary: '点一条：标为已读（已读的保持不变）',
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: '已标为已读' },
    400: json(apiErrorSchema, 'ID 格式不对'),
    401: unauthenticated,
    404: json(apiErrorSchema, '没有这条通知（或不是你的）'),
  },
});

const readAllRoute = createRoute({
  method: 'post',
  path: '/api/notifications/read-all',
  summary: '全部已读：当前成员的未读全部标为已读',
  responses: {
    204: { description: '已全部标为已读' },
    401: unauthenticated,
  },
});

/** 看通知的人：当前成员与他当前的店铺范围 */
function viewerOf(access: Access): NotificationViewer {
  return { memberId: access.member.id, stores: access.stores };
}

/** 铃铛面板的接口（G10）：只针对当前成员自己的通知 */
export function createNotificationRoutes(deps: { runtime: Runtime; appEnv: AppEnv }) {
  const { runtime, appEnv } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  routes.use('/api/notifications', requireSession(runtime, appEnv));
  routes.use('/api/notifications/*', requireSession(runtime, appEnv));

  routes.openapi(listRoute, async (c) => {
    const { view } = c.req.valid('query');
    const list = await listNotifications(runtime.db, viewerOf(c.get('access')), view);
    return c.json({ ...list, now: runtime.clock.now().toISOString() }, 200);
  });

  routes.openapi(unreadRoute, async (c) => {
    const unread = await countUnreadNotifications(runtime.db, viewerOf(c.get('access')));
    return c.json({ unread }, 200);
  });

  routes.openapi(readRoute, async (c) => {
    const { id } = c.req.valid('param');
    const viewer = viewerOf(c.get('access'));
    const found = await transaction(runtime, (tx) => markNotificationRead(tx, viewer, id));
    if (!found) return c.json({ error: 'not_found', message: '没有这条通知' }, 404);
    return c.body(null, 204);
  });

  routes.openapi(readAllRoute, async (c) => {
    const viewer = viewerOf(c.get('access'));
    await transaction(runtime, (tx) => markAllNotificationsRead(tx, viewer));
    return c.body(null, 204);
  });

  return routes;
}
