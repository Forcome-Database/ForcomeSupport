import { createHash, randomBytes } from 'node:crypto';
import type { CurrentMember } from '@forcome/contracts';
import { getConnInfo } from '@hono/node-server/conninfo';
import { eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Actor, AppEnv, DbExecutor, Runtime, Tx } from '../core';
import { session } from './schema';

/** 会话 Cookie 名；主应用与工厂工作台（第二期）各用各的 Cookie（ADR 0010） */
export const SESSION_COOKIE = 'forcome_session';

/** 已登录的会话（放在请求上下文里） */
export interface CurrentSession {
  readonly id: string;
  readonly member: CurrentMember;
}

/** Hono 上下文变量：requireSession 之后的处理器用 c.get('session') 取当前会话 */
export interface SessionVariables {
  session: CurrentSession;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 开出一个会话，返回给浏览器的令牌（32 字节随机数，base64url）。在登录的业务事务里调用，
 * 与登录审计同时提交或回滚。
 */
export async function openSession(
  tx: Tx,
  member: CurrentMember,
): Promise<{ id: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const [row] = await tx.db
    .insert(session)
    .values({
      tokenHash: hashToken(token),
      memberId: member.id,
      memberName: member.name,
      memberRoles: [...member.roles],
      createdAt: tx.now,
      lastActiveAt: tx.now,
    })
    .returning({ id: session.id });
  if (!row) {
    throw new Error('会话创建失败');
  }
  return { id: row.id, token };
}

async function findSession(db: DbExecutor, token: string): Promise<CurrentSession | null> {
  const [row] = await db
    .select()
    .from(session)
    .where(eq(session.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;
  return { id: row.id, member: { id: row.memberId, name: row.memberName, roles: row.memberRoles } };
}

/**
 * 会话 Cookie：httpOnly、SameSite=Lax、整站有效。生产与开发测试环境走 HTTPS（待办 03），Cookie 带 Secure；
 * 本机开发与自动化测试是 http，不带 Secure。有效期（无操作 7 天）随 04 号待办。
 */
export function setSessionCookie(c: Context, token: string, appEnv: AppEnv): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: appEnv === 'production' || appEnv === 'staging',
  });
}

/** 受保护的接口：没有有效会话返回 401，有则把会话放进上下文 */
export function requireSession(
  runtime: Runtime,
): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const current = token ? await findSession(runtime.db, token) : null;
    if (!current) {
      return c.json({ error: 'unauthenticated', message: '未登录或会话已失效，请重新登录' }, 401);
    }
    c.set('session', current);
    await next();
  };
}

/**
 * 请求的来源 IP（审计用）。生产与开发测试环境里 api 只在 caddy 之后可达，caddy 用真实客户端地址
 * 改写 X-Forwarded-For（不信任客户端自带的值），所以取它的第一段；直连（本机开发）时取连接的对端地址。
 */
export function clientIp(c: Context): string | null {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    // 测试进程内的请求没有网络连接
    return null;
  }
}

/** 当前会话的操作人，供业务写操作记审计（ADR 0010） */
export function sessionActor(c: Context<{ Variables: SessionVariables }>): Actor {
  const { member } = c.get('session');
  return {
    kind: 'member',
    memberId: member.id,
    name: member.name,
    roles: member.roles,
    ip: clientIp(c),
  };
}
