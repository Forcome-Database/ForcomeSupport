import {
  can,
  homeFor,
  navFor,
  type AuditObjectType,
  type Capability,
  type CurrentMember,
  type Density,
  type Role,
} from '@forcome/contracts';
import type { Context, MiddlewareHandler } from 'hono';
import {
  AccessDeniedError,
  memberStoreScope,
  recordAudit,
  storeScopeValue,
  storesOutsideScope,
  transaction,
  type Actor,
  type AppEnv,
  type Runtime,
  type StoreScope,
} from '../core';
import { loginDenial } from './login';
import {
  clearSessionCookie,
  clientIp,
  closeSession,
  lookupSession,
  sessionToken,
  setSessionCookie,
  type MemberRow,
} from './session';

/** 当前成员（会话所属；角色、店铺范围与偏好都是这次请求时从成员表读出的） */
export interface SessionMember {
  readonly id: string;
  readonly name: string;
  readonly dept: string;
  readonly roles: readonly Role[];
  readonly density: Density;
  readonly factoryCode: string | null;
}

/** 越权访问的目标（E-24 审计记的对象） */
export interface StoreAccessTarget {
  /** 这次要访问的数据所属的店铺 */
  readonly storeIds: readonly string[];
  readonly objectType: AuditObjectType;
  readonly objectId: string;
  /** 对象编号或名称（P27「对象」列） */
  readonly objectLabel?: string | null;
}

/**
 * 请求的访问上下文（ADR 0010）：受保护的接口经 requireSession 拿到它（c.get('access')），
 * 用它判断能力、取店铺范围交给仓储查询、决定是否返回财务字段、记审计的操作人。
 */
export interface Access {
  readonly sessionId: string;
  readonly member: SessionMember;
  /** 店铺数据范围：仓储查询的必需参数（core 的 StoreScope） */
  readonly stores: StoreScope;
  /** 能否看到成本、承担比例与结算金额（finance.view）；输出时交给 contracts 的 stripFinanceFields / maskFinanceFields */
  readonly financeVisible: boolean;
  /** 审计的操作人（成员、角色快照、来源 IP） */
  readonly actor: Actor;
  /** 是否有这项能力（PRD 10.1，多角色取并集；「○」的归属由业务模块再校验） */
  can(capability: Capability): boolean;
  /**
   * 要访问这些店铺的数据：都在店铺范围内则通过；否则记一条审计「越权访问被拒」（E-24），
   * 再抛 AccessDeniedError（接口返回 403）。审计单独提交，不随业务事务回滚。
   */
  requireStores(target: StoreAccessTarget): Promise<void>;
}

/** Hono 上下文变量：requireSession 之后的处理器用 c.get('access') 取访问上下文 */
export interface AccessVariables {
  access: Access;
}

export function sessionMemberOf(row: MemberRow): SessionMember {
  return {
    id: row.id,
    name: row.name,
    dept: row.dept,
    roles: row.roles,
    density: row.density,
    factoryCode: row.factoryCode,
  };
}

/** 成员作为审计的操作人（ADR 0010：角色在写入时快照） */
export function memberActor(member: SessionMember, ip: string | null): Actor {
  return { kind: 'member', memberId: member.id, name: member.name, roles: member.roles, ip };
}

function buildAccess(runtime: Runtime, c: Context, sessionId: string, row: MemberRow): Access {
  const sessionMember = sessionMemberOf(row);
  const stores = memberStoreScope(row);
  const actor = memberActor(sessionMember, clientIp(c));
  return {
    sessionId,
    member: sessionMember,
    stores,
    financeVisible: can(row.roles, 'finance.view'),
    actor,
    can: (capability) => can(row.roles, capability),
    async requireStores(target) {
      const outside = storesOutsideScope(stores, target.storeIds);
      if (outside.length === 0) return;
      await transaction(runtime, (tx) =>
        recordAudit(tx, actor, {
          action: 'access.denied',
          objectType: target.objectType,
          objectId: target.objectId,
          objectLabel: target.objectLabel ?? null,
          storeId: outside[0],
          after: {
            reason: 'store_scope',
            storeIds: outside,
            method: c.req.method,
            path: c.req.path,
          },
        }),
      );
      throw new AccessDeniedError('这条数据不在你的店铺范围内');
    },
  };
}

/**
 * 受保护的接口：没有有效会话返回 401。7 天无操作的会话过期（401 session_expired，G12「会话过期」）；
 * 成员已停用或不再能进入（loginDenial）时会话作废（401 unauthenticated）。每次请求都算一次操作，会话随之续期。
 */
export function requireSession(
  runtime: Runtime,
  appEnv: AppEnv,
): MiddlewareHandler<{ Variables: AccessVariables }> {
  return async (c, next) => {
    const token = sessionToken(c);
    const found = token
      ? await lookupSession(runtime.db, token, runtime.clock.now())
      : ({ status: 'missing' } as const);
    if (found.status === 'expired') {
      clearSessionCookie(c, appEnv);
      return c.json({ error: 'session_expired', message: '7 天未操作，已退出登录' }, 401);
    }
    if (found.status === 'active' && loginDenial(found.member) !== null) {
      await closeSession(runtime.db, found.sessionId);
    }
    if (found.status !== 'active' || loginDenial(found.member) !== null) {
      if (token) clearSessionCookie(c, appEnv);
      return c.json({ error: 'unauthenticated', message: '未登录或会话已失效，请重新登录' }, 401);
    }
    if (found.renewed && token) setSessionCookie(c, token, appEnv);
    c.set('access', buildAccess(runtime, c, found.sessionId, found.member));
    await next();
  };
}

/** 需要某项能力的接口（挂在 requireSession 之后）：没有则 403（PRD 10.1；界面不会给没有能力的人入口） */
export function requireCapability(
  capability: Capability,
): MiddlewareHandler<{ Variables: AccessVariables }> {
  return async (c, next) => {
    if (!c.get('access').can(capability)) {
      return c.json({ error: 'forbidden', message: '你的角色没有这项权限' }, 403);
    }
    await next();
  };
}

/** /api/me 与登录接口返回的当前成员：身份、店铺范围、密度，以及按角色算出的导航与默认首页（PRD 4.1） */
export function currentMember(member: SessionMember, stores: StoreScope): CurrentMember {
  const home = homeFor(member.roles);
  if (!home) throw new Error(`成员 ${member.id} 没有默认首页，不应能登录`);
  return {
    id: member.id,
    name: member.name,
    dept: member.dept,
    roles: [...member.roles],
    stores: storeScopeValue(stores),
    density: member.density,
    nav: navFor(member.roles),
    home,
  };
}
