import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  currentMemberSchema,
  devDingtalkScanRequestSchema,
  devDingtalkScanResponseSchema,
  dingtalkLoginRequestSchema,
  dingtalkLoginStartSchema,
  loginDeniedSchema,
  loginDenialMessage,
  loginFailedSchema,
  loginFailureMessages,
  type LoginFailureReason,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { recordAudit, transaction, type AppEnv, type Logger, type Runtime } from '../core';
import {
  dingtalkClient,
  DingtalkAuthCodeError,
  type FakeDingtalk,
  type IntegrationClients,
} from '../integration';
import { currentMember, memberAccessOf, memberActor } from './access';
import { syncUserFromDingtalk } from './dingtalk-sync';
import { lockDirectory } from './directory';
import { loginDenial } from './login';
import { findMemberByDingtalkUserId, listAdmins } from './members';
import { json } from './openapi';
import { clientIp, openSession, setSessionCookie } from './session';

/*
 * 钉钉扫码登录（G11、G12，规格 org「钉钉扫码登录换出服务端会话」，ADR 0010 修订，待办 05）：
 * 1. 登录页 POST /api/auth/dingtalk/start：开一次登录——随机 state 记在只给这组接口的 Cookie 里，返回画二维码的参数
 *    （真实接口时登录页嵌钉钉的二维码 DTFrameLogin，Fake 时画示意二维码）；
 * 2. 扫码确认后钉钉把浏览器带回 redirectUri（前端 /login/dingtalk?authCode=…&state=…），前端 POST /api/auth/dingtalk/login；
 * 3. 核对 state（防跨站伪造登录）→ 钉钉客户端用授权码换出扫码人的钉钉用户 ID → 找成员（还没同步进来的当场向钉钉取来补建）
 *    → 能不能进入与开发登录同一套判断（G12）→ 换出与开发登录同一种会话，审计「登录（钉钉扫码）」。
 * 钉钉内免登随第二期。
 */

/** 这次扫码登录的 state：只发给这组接口；比二维码的 2 分钟长一些，扫码后在手机上多想一会儿也来得及 */
const STATE_COOKIE = 'forcome_login_state';
const STATE_COOKIE_PATH = '/api/auth/dingtalk';
const STATE_MAX_AGE_SECONDS = 10 * 60;
/** 扫码确认后钉钉把浏览器带回的前端地址（钉钉开放平台「重定向 URL」填它） */
export const DINGTALK_LOGIN_CALLBACK_PATH = '/login/dingtalk';

const startRoute = createRoute({
  method: 'post',
  path: '/api/auth/dingtalk/start',
  summary:
    '开始一次钉钉扫码登录（G11）：记下 state，返回画二维码的参数；「刷新」二维码即再开始一次',
  responses: { 200: json(dingtalkLoginStartSchema, '画二维码的参数') },
});

const loginRoute = createRoute({
  method: 'post',
  path: '/api/auth/dingtalk/login',
  summary: '扫码确认后用授权码换会话：与开发登录同一种会话，记审计「登录（钉钉扫码）」',
  request: {
    body: {
      content: { 'application/json': { schema: dingtalkLoginRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(currentMemberSchema, '已登录，会话 Cookie 在响应头里'),
    400: json(
      loginFailedSchema,
      '授权码已失效或用过、这次登录的 state 对不上（请求参数不对也是 400）',
    ),
    403: json(loginDeniedSchema, '登录被拒（G12：未分配角色、已停用；第一期只有生产厂对接人角色）'),
    502: json(loginFailedSchema, '连不上钉钉'),
  },
});

const devScanRoute = createRoute({
  method: 'post',
  path: '/api/dev/dingtalk/scan',
  summary:
    '模拟某人在手机上扫码并确认，返回钉钉会带回的授权码（只在非生产环境开启开发登录、钉钉用 Fake 时存在）',
  request: {
    body: {
      content: { 'application/json': { schema: devDingtalkScanRequestSchema } },
      required: true,
    },
  },
  responses: { 200: json(devDingtalkScanResponseSchema, '授权码（一次有效）') },
});

/** 扫码确认后钉钉带浏览器回到的地址：本站的 /login/dingtalk（经 caddy 时按转发头取协议与域名） */
function redirectUriOf(c: Context): string {
  const url = new URL(c.req.url);
  const proto =
    c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() ?? url.protocol.replace(':', '');
  const host =
    c.req.header('x-forwarded-host')?.split(',')[0]?.trim() ?? c.req.header('host') ?? url.host;
  return `${proto}://${host}${DINGTALK_LOGIN_CALLBACK_PATH}`;
}

function sameState(expected: string | undefined, received: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createDingtalkLoginRoutes(deps: {
  runtime: Runtime;
  appEnv: AppEnv;
  clients: IntegrationClients;
  logger: Logger;
}) {
  const { runtime, appEnv, clients, logger } = deps;
  const secure = appEnv === 'production' || appEnv === 'staging';
  const routes = new OpenAPIHono();

  routes.openapi(startRoute, (c) => {
    const state = randomBytes(24).toString('base64url');
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'Lax',
      path: STATE_COOKIE_PATH,
      secure,
      maxAge: STATE_MAX_AGE_SECONDS,
    });
    const mode = clients.globalMode(dingtalkClient.system);
    return c.json(
      {
        mode,
        clientId: mode === 'real' ? clients.global(dingtalkClient).loginClientId : null,
        redirectUri: redirectUriOf(c),
        state,
      },
      200,
    );
  });

  routes.openapi(loginRoute, async (c) => {
    const { authCode, state } = c.req.valid('json');
    const expected = getCookie(c, STATE_COOKIE);
    // state 只用一次
    deleteCookie(c, STATE_COOKIE, { path: STATE_COOKIE_PATH, secure });
    const failed = (reason: LoginFailureReason, status: 400 | 502) =>
      c.json(
        { error: 'login_failed' as const, reason, message: loginFailureMessages[reason] },
        status,
      );
    if (!sameState(expected, state)) return failed('state_mismatch', 400);

    const dingtalk = clients.global(dingtalkClient);
    let found;
    try {
      const userId = await dingtalk.userIdByAuthCode(authCode);
      found = await findMemberByDingtalkUserId(runtime.db, userId);
      // 还没同步进来（刚入职、事件还没处理到），或钉钉离职停用后又回到通讯录：当场向钉钉取来再判断
      if (!found || (found.status === 'disabled' && found.disabledReason === 'dingtalk_left')) {
        await transaction(runtime, async (tx) => {
          await lockDirectory(tx);
          await syncUserFromDingtalk(tx, dingtalk, userId);
        });
        found = await findMemberByDingtalkUserId(runtime.db, userId);
      }
    } catch (error) {
      if (error instanceof DingtalkAuthCodeError) return failed('code_invalid', 400);
      logger.warn({ err: error }, '钉钉扫码登录：连不上钉钉');
      return failed('dingtalk_unavailable', 502);
    }

    const admins = async () => (await listAdmins(runtime.db)).map((a) => a.name);
    if (!found) {
      // 钉钉说是本组织的人，通讯录里却取不到（权限范围没覆盖他）：按未分配角色处理
      return c.json(
        {
          error: 'login_denied' as const,
          reason: 'no_role' as const,
          message: loginDenialMessage('no_role', await admins()),
        },
        403,
      );
    }
    const denied = loginDenial(found);
    if (denied) {
      return c.json(
        {
          error: 'login_denied' as const,
          reason: denied,
          message: loginDenialMessage(denied, await admins()),
          member: { name: found.name, dept: found.dept, roles: [...found.roles] },
        },
        403,
      );
    }
    const access = memberAccessOf(found);
    const { token } = await transaction(runtime, async (tx) => {
      const opened = await openSession(tx, found.id);
      await recordAudit(tx, memberActor(access.member, clientIp(c)), {
        action: 'auth.login',
        objectType: 'login',
        objectId: opened.id,
        objectLabel: '钉钉扫码',
        after: { method: 'dingtalk' },
      });
      return opened;
    });
    setSessionCookie(c, token, appEnv);
    return c.json(currentMember(access), 200);
  });

  return routes;
}

/** 是否挂「模拟扫码」：开发登录开着（非生产）且钉钉用 Fake */
export function devDingtalkScanAvailable(
  config: { appEnv: AppEnv; devLoginEnabled: boolean },
  clients: IntegrationClients,
): boolean {
  return (
    config.devLoginEnabled &&
    config.appEnv !== 'production' &&
    clients.globalMode(dingtalkClient.system) === 'fake'
  );
}

/**
 * 模拟扫码（开发工具，与开发登录同一个开关）：本机演示与 Playwright 用它拿到授权码，再像钉钉一样把浏览器带到
 * /login/dingtalk?authCode=…&state=…，走真实的回调页与换会话。授权码由本进程的 Fake 钉钉发出、一次有效。
 */
export function createDevDingtalkRoutes(deps: { clients: IntegrationClients; appEnv: AppEnv }) {
  if (deps.appEnv === 'production') throw new Error('生产环境不能开启模拟扫码');
  const routes = new OpenAPIHono();
  routes.openapi(devScanRoute, (c) => {
    const { userId } = c.req.valid('json');
    const fake: FakeDingtalk = deps.clients.fake(dingtalkClient);
    return c.json({ authCode: fake.issueAuthCode(userId) }, 200);
  });
  return routes;
}
