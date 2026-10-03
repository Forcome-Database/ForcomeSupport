import { apiErrorSchema, currentMemberSchema } from '@forcome/contracts';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Runtime } from '../core';
import { requireSession, type SessionVariables } from './session';

const meRoute = createRoute({
  method: 'get',
  path: '/api/me',
  summary: '当前登录的成员',
  responses: {
    200: {
      description: '已登录',
      content: { 'application/json': { schema: currentMemberSchema } },
    },
    401: {
      description: '未登录或会话已失效',
      content: { 'application/json': { schema: apiErrorSchema } },
    },
  },
});

/** org 的接口：当前成员。成员、角色与店铺范围、密度偏好等随 04–06 号待办加入 */
export function createOrgRoutes(deps: { runtime: Runtime }) {
  const routes = new OpenAPIHono<{ Variables: SessionVariables }>();
  routes.use('/api/me', requireSession(deps.runtime));
  routes.openapi(meRoute, (c) => c.json(c.get('session').member, 200));
  return routes;
}
