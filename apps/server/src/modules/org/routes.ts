import {
  adminContactsSchema,
  apiErrorSchema,
  currentMemberSchema,
  preferencesSchema,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { recordAudit, transaction, type AppEnv, type Runtime } from '../core';
import { currentMember, requireSession, type AccessVariables } from './access';
import { listAdmins, saveDensity } from './members';
import { clearSessionCookie, closeSession } from './session';

const unauthenticated = {
  description: '未登录、会话已失效或 7 天无操作已过期',
  content: { 'application/json': { schema: apiErrorSchema } },
};

const meRoute = createRoute({
  method: 'get',
  path: '/api/me',
  summary: '当前登录的成员：角色、店铺范围、密度，以及导航与默认首页（PRD 4.1）',
  responses: {
    200: {
      description: '已登录',
      content: { 'application/json': { schema: currentMemberSchema } },
    },
    401: unauthenticated,
  },
});

const preferencesRoute = createRoute({
  method: 'put',
  path: '/api/me/preferences',
  summary: '保存个人偏好：界面密度（G9，按成员保存在服务端）',
  request: {
    body: { content: { 'application/json': { schema: preferencesSchema } }, required: true },
  },
  responses: {
    200: {
      description: '已保存',
      content: { 'application/json': { schema: preferencesSchema } },
    },
    401: unauthenticated,
  },
});

const logoutRoute = createRoute({
  method: 'post',
  path: '/api/logout',
  summary: '退出登录：结束会话（记审计）',
  responses: {
    204: { description: '已退出' },
    401: unauthenticated,
  },
});

const adminContactsRoute = createRoute({
  method: 'get',
  path: '/api/org/admin-contacts',
  summary: '在职的管理员（无权限页面 G2 写「如需开通请联系管理员刘洋」）',
  responses: {
    200: {
      description: '管理员',
      content: { 'application/json': { schema: adminContactsSchema } },
    },
    401: unauthenticated,
  },
});

/** org 的接口：当前成员、个人偏好、退出登录、管理员联系人。成员管理（P20）随 06 号待办 */
export function createOrgRoutes(deps: { runtime: Runtime; appEnv: AppEnv }) {
  const { runtime, appEnv } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  const session = requireSession(runtime, appEnv);
  for (const path of ['/api/me', '/api/me/preferences', '/api/logout', '/api/org/admin-contacts']) {
    routes.use(path, session);
  }

  routes.openapi(meRoute, (c) => c.json(currentMember(c.get('access')), 200));

  routes.openapi(preferencesRoute, async (c) => {
    const { density } = c.req.valid('json');
    await transaction(runtime, (tx) => saveDensity(tx, c.get('access').member.id, density));
    return c.json({ density }, 200);
  });

  routes.openapi(logoutRoute, async (c) => {
    const access = c.get('access');
    await transaction(runtime, async (tx) => {
      await closeSession(tx.db, access.sessionId);
      await recordAudit(tx, access.actor, {
        action: 'auth.logout',
        objectType: 'login',
        objectId: access.sessionId,
        objectLabel: '退出登录',
      });
    });
    clearSessionCookie(c, appEnv);
    return c.body(null, 204);
  });

  routes.openapi(adminContactsRoute, async (c) =>
    c.json({ admins: await listAdmins(runtime.db) }, 200),
  );

  return routes;
}
