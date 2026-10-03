import { createHash, randomBytes } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, DbExecutor, Tx } from '../core';
import { member, session } from './schema';

/** 会话 Cookie 名；主应用与工厂工作台（第二期）各用各的 Cookie（ADR 0010） */
export const SESSION_COOKIE = 'forcome_session';

/** 无操作多久过期（ADR 0010、G12「7 天未操作，已退出登录」） */
export const SESSION_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 续期的最小间隔：每次请求都算「有操作」，但距上次续期不到 1 分钟时不再写库，
 * 免得每个请求都更新会话行；过期判断因此最多早 1 分钟，可以忽略。
 */
const RENEW_INTERVAL_MS = 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 开出一个会话，返回给浏览器的令牌（32 字节随机数，base64url）。在登录的业务事务里调用，
 * 与登录审计同时提交或回滚。
 */
export async function openSession(
  tx: Tx,
  memberId: string,
): Promise<{ id: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const [row] = await tx.db
    .insert(session)
    .values({ tokenHash: hashToken(token), memberId, createdAt: tx.now, lastActiveAt: tx.now })
    .returning({ id: session.id });
  if (!row) {
    throw new Error('会话创建失败');
  }
  return { id: row.id, token };
}

export type MemberRow = typeof member.$inferSelect;

export type SessionLookup =
  | { readonly status: 'missing' }
  | { readonly status: 'expired' }
  | {
      readonly status: 'active';
      readonly sessionId: string;
      readonly member: MemberRow;
      /** 这次请求是否续期了（续期后要重发 Cookie，让浏览器端的有效期也往后顺延） */
      readonly renewed: boolean;
    };

/**
 * 按令牌找会话：找不到为 missing；7 天无操作为 expired（同时删掉这行）；否则视这次请求为一次操作并续期。
 * 成员一并读出——角色、店铺范围与状态每次请求都以成员表为准（ADR 0010）。
 */
export async function lookupSession(
  db: DbExecutor,
  token: string,
  now: Date,
): Promise<SessionLookup> {
  const [row] = await db
    .select({ session, member })
    .from(session)
    .innerJoin(member, eq(member.id, session.memberId))
    .where(eq(session.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return { status: 'missing' };
  const idle = now.getTime() - row.session.lastActiveAt.getTime();
  if (idle >= SESSION_IDLE_TIMEOUT_MS) {
    await db.delete(session).where(eq(session.id, row.session.id));
    return { status: 'expired' };
  }
  const renewed = idle >= RENEW_INTERVAL_MS;
  if (renewed) {
    await db.update(session).set({ lastActiveAt: now }).where(eq(session.id, row.session.id));
  }
  return { status: 'active', sessionId: row.session.id, member: row.member, renewed };
}

/** 结束会话（退出登录、成员不能再进入时） */
export async function closeSession(db: DbExecutor, sessionId: string): Promise<void> {
  await db.delete(session).where(eq(session.id, sessionId));
}

export function sessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

/**
 * 会话 Cookie：httpOnly、SameSite=Lax、整站有效，有效期与服务端一致（7 天，续期时随之顺延）——
 * 关掉浏览器不会退出登录，7 天无操作才需要重新登录。生产与开发测试环境走 HTTPS（待办 03），Cookie 带 Secure；
 * 本机开发与自动化测试是 http，不带 Secure。
 */
export function setSessionCookie(c: Context, token: string, appEnv: AppEnv): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: appEnv === 'production' || appEnv === 'staging',
    maxAge: SESSION_IDLE_TIMEOUT_MS / 1000,
  });
}

export function clearSessionCookie(c: Context, appEnv: AppEnv): void {
  deleteCookie(c, SESSION_COOKIE, {
    path: '/',
    secure: appEnv === 'production' || appEnv === 'staging',
  });
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
