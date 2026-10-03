import {
  apiErrorSchema,
  currentMemberSchema,
  devLoginRequestSchema,
  devMembersResponseSchema,
  type DevMember,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { recordAudit, transaction, type AppEnv, type Runtime } from '../core';
import { clientIp, memberActor, openSession, setSessionCookie } from './session';

/*
 * 开发登录（ADR 0010 修订）：本机、CI 与 Playwright 绕过钉钉扫码，选一位成员直接登录，
 * 换出与扫码登录（05）同一种会话，并像正式登录一样记审计。
 * 只在非生产环境由 DEV_LOGIN_ENABLED=true 开启：生产环境配置了就拒绝启动（core 的 loadConfig），
 * 接口层再判断一次，生产环境不挂这组路由。
 * 可选的成员来自示例数据夹具（id 是确定的）；04 号待办有了成员表后改为从成员表取。
 */

/**
 * 第一期能进入客服系统的示例成员（04 号待办改为成员表）。生产厂对接人第一期不分配、登录被拒（PRD 4.1、G12），
 * 不列出；04 号待办实现登录被拒时，连同被拒的场景一起加回来。
 */
function devMembers(): DevMember[] {
  return getDemoFixture()
    .members.filter((m) => m.role !== '生产厂对接人')
    .map((m) => ({ id: m.id, name: m.name, roles: [m.role], dept: m.dept }));
}

const membersRoute = createRoute({
  method: 'get',
  path: '/api/dev/members',
  summary: '开发登录可选的成员（只在非生产环境开启时存在）',
  responses: {
    200: {
      description: '成员列表',
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
  if (deps.appEnv === 'production') {
    throw new Error('生产环境不能开启开发登录');
  }
  // 只在开启开发登录时才取用示例数据，生产环境的 api 不解析夹具
  const members = devMembers();
  const routes = new OpenAPIHono();

  routes.openapi(membersRoute, (c) => c.json({ members }, 200));

  routes.openapi(loginRoute, async (c) => {
    const { memberId } = c.req.valid('json');
    const found = members.find((m) => m.id === memberId);
    if (!found) {
      return c.json({ error: 'not_found', message: '没有这位成员' }, 404);
    }
    const member = { id: found.id, name: found.name, roles: found.roles };
    const { token } = await transaction(deps.runtime, async (tx) => {
      const opened = await openSession(tx, member);
      await recordAudit(tx, memberActor(member, clientIp(c)), {
        action: 'auth.login',
        objectType: 'login',
        objectId: opened.id,
        objectLabel: '开发登录',
        after: { method: 'dev' },
      });
      return opened;
    });
    setSessionCookie(c, token, deps.appEnv);
    return c.json(member, 200);
  });

  return routes;
}
