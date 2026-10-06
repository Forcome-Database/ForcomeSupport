import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  apiErrorSchema,
  currentMemberSchema,
  devDingtalkRejoinResponseSchema,
  devDingtalkScanRequestSchema,
  devDingtalkScanResponseSchema,
  dingtalkLoginRequestSchema,
  dingtalkLoginStartSchema,
  loginDeniedSchema,
  loginFailedSchema,
  loginFailureMessages,
  type LoginFailureReason,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, Logger, Runtime } from '../core';
import {
  dingtalkClient,
  DingtalkAuthCodeError,
  type FakeDingtalk,
  type IntegrationClients,
} from '../integration';
import { applyFetchedUser, fetchUser } from './dingtalk-sync';
import { loadDepartmentTree } from './directory';
import { loginDenial } from './login';
import { findMemberByDingtalkUnionId, findMemberByDingtalkUserId } from './members';
import { json } from './openapi';
import { secureCookies, type MemberRow } from './session';
import { loginDeniedBody, signIn } from './sign-in';

/*
 * 钉钉扫码登录（G11、G12，规格 org「钉钉扫码登录换出服务端会话」，ADR 0010 修订，待办 05）：
 * 1. 登录页 POST /api/auth/dingtalk/start：开一次登录——随机 state 记在只给这组接口的 Cookie 里，返回画二维码的参数
 *    （真实接口时登录页嵌钉钉的二维码 DTFrameLogin，Fake 时画示意二维码）；
 * 2. 扫码确认后钉钉把浏览器带回 redirectUri（前端 /login/dingtalk?authCode=…&state=…），前端 POST /api/auth/dingtalk/login；
 * 3. 核对 state（防跨站伪造登录）→ 钉钉客户端用授权码换出扫码人（unionid 与本组织的用户 ID；已离职的没有用户 ID，按 unionid
 *    认出，G12「账号已停用」）→ 找成员（成员表还没跟上钉钉的当场向钉钉取来补同步）→ 能不能进入与开发登录同一套判断（G12）
 *    → 换出与开发登录同一种会话，审计「登录（钉钉扫码）」。
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

const devRejoinRoute = createRoute({
  method: 'post',
  path: '/api/dev/dingtalk/rejoin',
  summary:
    '模拟某人钉钉离职后又回到通讯录：停用后恢复在职，角色与店铺范围清空（只在非生产环境开启开发登录、钉钉用 Fake 时存在）',
  request: {
    body: {
      content: { 'application/json': { schema: devDingtalkScanRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(devDingtalkRejoinResponseSchema, '这个人在成员表里的 ID'),
    404: json(apiErrorSchema, 'Fake 钉钉的通讯录里没有这个人'),
  },
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

/** 找到的成员是不是另一个人：他记着的 unionid 与扫码人的不同（用户 ID 给了别人时会这样） */
function isSomeoneElse(found: MemberRow | null, unionId: string): boolean {
  return found?.dingtalkUnionId != null && found.dingtalkUnionId !== unionId;
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
  const routes = new OpenAPIHono();

  routes.openapi(startRoute, (c) => {
    const state = randomBytes(24).toString('base64url');
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'Lax',
      path: STATE_COOKIE_PATH,
      secure: secureCookies(appEnv),
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
    deleteCookie(c, STATE_COOKIE, { path: STATE_COOKIE_PATH, secure: secureCookies(appEnv) });
    const failed = (reason: LoginFailureReason, status: 400 | 502) =>
      c.json(
        { error: 'login_failed' as const, reason, message: loginFailureMessages[reason] },
        status,
      );
    if (!sameState(expected, state)) return failed('state_mismatch', 400);

    // 钉钉的调用出错按「授权码已失效 / 连不上钉钉」回答；查库出错照常是 500（统一的错误处理记日志）
    const dingtalk = clients.global(dingtalkClient);
    const callDingtalk = async <T>(call: () => Promise<T>): Promise<T | LoginFailureReason> => {
      try {
        return await call();
      } catch (error) {
        if (error instanceof DingtalkAuthCodeError) {
          logger.info({ err: error }, '钉钉扫码登录：授权码无效、过期或已使用');
          return 'code_invalid';
        }
        logger.error({ err: error }, '钉钉扫码登录：调用钉钉失败');
        return 'dingtalk_unavailable';
      }
    };
    const identity = await callDingtalk(() => dingtalk.identifyByAuthCode(authCode));
    if (typeof identity === 'string') {
      return failed(identity, identity === 'code_invalid' ? 400 : 502);
    }

    // 在本组织：按用户 ID 找；已离职（换不到用户 ID）：按 unionid 认出是谁
    let found = identity.userId
      ? await findMemberByDingtalkUserId(runtime.db, identity.userId)
      : await findMemberByDingtalkUnionId(runtime.db, identity.unionId);
    // 成员表还没跟上钉钉时，当场向钉钉取这个人再判断：刚入职（还没同步进来）、钉钉离职停用后又回来、已离职但还没停用、
    // 用户 ID 换了人（对上了用户 ID、unionid 却不同：这个用户 ID 已给了另一个人，旧成员的离职还没同步到）
    const anotherPerson = isSomeoneElse(found, identity.unionId);
    const stale = identity.userId
      ? !found ||
        anotherPerson ||
        (found.status === 'disabled' && found.disabledReason === 'dingtalk_left')
      : found?.status === 'active';
    const userId = identity.userId ?? found?.dingtalkUserId;
    if (stale && userId) {
      const fetchedAt = runtime.clock.now();
      const tree = await loadDepartmentTree(runtime.db);
      const fetched = await callDingtalk(() => fetchUser(dingtalk, tree, userId, fetchedAt));
      if (typeof fetched === 'string') return failed('dingtalk_unavailable', 502);
      await applyFetchedUser(runtime, fetched);
      found = await findMemberByDingtalkUnionId(runtime.db, identity.unionId);
      found ??= await findMemberByDingtalkUserId(runtime.db, userId);
    }

    // 兜底：unionid 与扫码人对不上的成员一律不认，扫码人不能顶替别人
    if (isSomeoneElse(found, identity.unionId)) found = null;
    // 钉钉认得、成员表里没有（通讯录权限范围没覆盖他，或不是本组织的人）：按未分配角色处理
    if (!found) return c.json(await loginDeniedBody(runtime.db, 'no_role'), 403);
    const denied = loginDenial(found);
    if (denied) return c.json(await loginDeniedBody(runtime.db, denied, found), 403);
    return c.json(await signIn(runtime, c, appEnv, found, 'dingtalk'), 200);
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
 * 钉钉的开发工具（与开发登录同一个开关，钉钉用 Fake 时才有）：
 * - 模拟扫码：本机演示与 Playwright 用它拿到授权码，再像钉钉一样把浏览器带到 /login/dingtalk?authCode=…&state=…，
 *   走真实的回调页与换会话。授权码由本进程的 Fake 钉钉发出、一次有效。
 * - 模拟回到通讯录（待办 06）：走通讯录同步的同一条写入（applyFetchedUser）——先按离职停用、再按回到通讯录恢复在职，
 *   角色与店铺范围清空，审计记「钉钉离职停用」「钉钉恢复在职」。这个人仍在 Fake 通讯录里（api 与 worker 的通讯录一致，
 *   之后的对账不受影响）。长期运行的开发测试环境里 Playwright 用它让 P20「添加成员」可以重复执行。
 */
export function createDevDingtalkRoutes(deps: {
  clients: IntegrationClients;
  appEnv: AppEnv;
  runtime: Runtime;
}) {
  if (deps.appEnv === 'production') throw new Error('生产环境不能开启模拟扫码');
  const { runtime } = deps;
  const routes = new OpenAPIHono();
  routes.openapi(devScanRoute, (c) => {
    const { userId } = c.req.valid('json');
    const fake: FakeDingtalk = deps.clients.fake(dingtalkClient);
    return c.json({ authCode: fake.issueAuthCode(userId) }, 200);
  });
  routes.openapi(devRejoinRoute, async (c) => {
    const { userId } = c.req.valid('json');
    const dingtalk = deps.clients.fake(dingtalkClient).client();
    const tree = await loadDepartmentTree(runtime.db);
    const fetched = await fetchUser(dingtalk, tree, userId, runtime.clock.now());
    if (!fetched.user) {
      return c.json({ error: 'not_found', message: '钉钉通讯录里没有这个人' }, 404);
    }
    await applyFetchedUser(runtime, { ...fetched, user: null });
    await applyFetchedUser(runtime, { ...fetched, fetchedAt: runtime.clock.now() });
    const member = await findMemberByDingtalkUserId(runtime.db, userId);
    if (!member) throw new Error(`回到通讯录后成员表里没有 ${userId}`);
    return c.json({ memberId: member.id }, 200);
  });
  return routes;
}
