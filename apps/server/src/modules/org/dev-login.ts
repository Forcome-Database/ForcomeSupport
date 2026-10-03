import {
  apiErrorSchema,
  currentMemberSchema,
  devLoginRequestSchema,
  devMembersResponseSchema,
  loginDeniedSchema,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { memberStoreScope, recordAudit, transaction, type AppEnv, type Runtime } from '../core';
import { currentMember, memberActor, sessionMemberOf } from './access';
import { loginDenial, loginDenialMessage } from './login';
import { findMember, listActiveMembers, listAdmins } from './members';
import { clientIp, openSession, setSessionCookie } from './session';

/*
 * 开发登录（ADR 0010 修订）：本机、CI 与 Playwright 绕过钉钉扫码，选一位成员直接登录，
 * 换出与扫码登录（05）同一种会话，并像正式登录一样记审计；能不能进入与正式登录同一套判断（G12）。
 * 只在非生产环境由 DEV_LOGIN_ENABLED=true 开启：生产环境配置了就拒绝启动（core 的 loadConfig），
 * 接口层再判断一次，生产环境不挂这组路由。可选的成员是成员表里的在职成员（示例数据夹具灌入）。
 */

const membersRoute = createRoute({
  method: 'get',
  path: '/api/dev/members',
  summary: '开发登录可选的成员（只在非生产环境开启时存在）',
  responses: {
    200: {
      description: '在职成员，含第一期会被拒绝的生产厂对接人',
      content: { 'application/json': { schema: devMembersResponseSchema } },
    },
  },
});

const loginRoute = createRoute({
  method: 'post',
  path: '/api/dev/login',
  summary: '开发登录：以某位成员登录（只在非生产环境开启时存在）',
  request: {
    body: { content: { 'application/json': { schema: devLoginRequestSchema } }, required: true },
  },
  responses: {
    200: {
      description: '已登录，会话 Cookie 在响应头里',
      content: { 'application/json': { schema: currentMemberSchema } },
    },
    403: {
      description: '登录被拒（G12：未分配角色、已停用；第一期只有生产厂对接人角色）',
      content: { 'application/json': { schema: loginDeniedSchema } },
    },
    404: {
      description: '没有这位成员',
      content: { 'application/json': { schema: apiErrorSchema } },
    },
  },
});

/** 是否挂开发登录：配置开启且不是生产环境（生产环境的配置已在启动时拒绝，这里再挡一次） */
export function devLoginAvailable(config: { appEnv: AppEnv; devLoginEnabled: boolean }): boolean {
  return config.devLoginEnabled && config.appEnv !== 'production';
}

export function createDevLoginRoutes(deps: { runtime: Runtime; appEnv: AppEnv }) {
  const { runtime, appEnv } = deps;
  if (appEnv === 'production') {
    throw new Error('生产环境不能开启开发登录');
  }
  const routes = new OpenAPIHono();

  routes.openapi(membersRoute, async (c) => {
    const members = await listActiveMembers(runtime.db);
    return c.json(
      {
        members: members.map((m) => ({ id: m.id, name: m.name, dept: m.dept, roles: m.roles })),
      },
      200,
    );
  });

  routes.openapi(loginRoute, async (c) => {
    const { memberId } = c.req.valid('json');
    const found = await findMember(runtime.db, memberId);
    if (!found) {
      return c.json({ error: 'not_found', message: '没有这位成员' }, 404);
    }
    const denied = loginDenial(found);
    if (denied) {
      const admins = await listAdmins(runtime.db);
      const message = loginDenialMessage(
        denied,
        admins.map((a) => a.name),
      );
      return c.json({ error: 'login_denied' as const, reason: denied, message }, 403);
    }
    const sessionMember = sessionMemberOf(found);
    const { token } = await transaction(runtime, async (tx) => {
      const opened = await openSession(tx, found.id);
      await recordAudit(tx, memberActor(sessionMember, clientIp(c)), {
        action: 'auth.login',
        objectType: 'login',
        objectId: opened.id,
        objectLabel: '开发登录',
        after: { method: 'dev' },
      });
      return opened;
    });
    setSessionCookie(c, token, appEnv);
    return c.json(currentMember(sessionMember, memberStoreScope(found)), 200);
  });

  return routes;
}
