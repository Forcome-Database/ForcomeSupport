import { devNotificationResponseSchema, notificationContentSchema } from '@forcome/contracts';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { transaction, type AppEnv, type Runtime } from '../core';
import { notifyMembers } from './notifications';
import { json } from './openapi';

/*
 * 示例通知（待办 31，ADR 0010 修订）：产生站内通知的业务（渠道连接 09/11/12、钉钉同步 05、未归属来信 15、改派队列 23）
 * 上线前，本机演示与 Playwright（含开发测试环境的冒烟）用它按 11.4 发一条通知，走与业务调用方相同的 notifyMembers。
 * 与开发登录同一个开关：只在开启开发登录的非生产环境挂上（app.ts），生产环境不挂。
 */

const notificationRoute = createRoute({
  method: 'post',
  path: '/api/dev/notifications',
  summary:
    '示例通知：按 11.4 发给该类型的接收人，与业务调用方同一个写入（只在非生产环境开启开发登录时存在）',
  request: {
    body: {
      content: { 'application/json': { schema: notificationContentSchema } },
      required: true,
    },
  },
  responses: {
    200: json(devNotificationResponseSchema, '已发出，返回发给了谁（成员 ID）'),
  },
});

export function createDevNotificationRoutes(deps: { runtime: Runtime; appEnv: AppEnv }) {
  const { runtime, appEnv } = deps;
  if (appEnv === 'production') {
    throw new Error('生产环境不能开启示例通知');
  }
  const routes = new OpenAPIHono();
  routes.openapi(notificationRoute, async (c) => {
    const content = c.req.valid('json');
    const recipients = await transaction(runtime, (tx) => notifyMembers(tx, content));
    return c.json({ recipients }, 200);
  });
  return routes;
}
