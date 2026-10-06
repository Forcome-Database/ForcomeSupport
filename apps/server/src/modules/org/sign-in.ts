import {
  loginDenialMessage,
  loginMethodLabels,
  type CurrentMember,
  type LoginDenialReason,
  type LoginDenied,
} from '@forcome/contracts';
import type { Context } from 'hono';
import { recordAudit, transaction, type AppEnv, type DbExecutor, type Runtime } from '../core';
import { currentMember, memberAccessOf, memberActor } from './access';
import { listAdmins } from './members';
import { clientIp, openSession, setSessionCookie, type MemberRow } from './session';

/*
 * 登录的共用部分（开发登录、钉钉扫码登录，ADR 0010）：被拒的响应体（G12）与换出会话。
 * 能不能进入的判断是 login.ts 的 loginDenial。
 */

/** 被拒的响应体（403 login_denied）：原因、说明（未分配角色时写出在职管理员），给了成员时另带是谁 */
export async function loginDeniedBody(
  db: DbExecutor,
  reason: LoginDenialReason,
  who?: Pick<MemberRow, 'name' | 'dept' | 'roles'>,
): Promise<LoginDenied> {
  const admins = await listAdmins(db);
  return {
    error: 'login_denied',
    reason,
    message: loginDenialMessage(
      reason,
      admins.map((a) => a.name),
    ),
    ...(who ? { member: { name: who.name, dept: who.dept, roles: [...who.roles] } } : {}),
  };
}

/**
 * 换出会话：开会话并记审计「登录」（对象写登录方式），在响应上设会话 Cookie，返回当前成员。
 * 调用方已用 loginDenial 判断过能进入
 */
export async function signIn(
  runtime: Runtime,
  c: Context,
  appEnv: AppEnv,
  row: MemberRow,
  method: keyof typeof loginMethodLabels,
): Promise<CurrentMember> {
  const access = memberAccessOf(row);
  const { token } = await transaction(runtime, async (tx) => {
    const opened = await openSession(tx, row.id);
    await recordAudit(tx, memberActor(access.member, clientIp(c)), {
      action: 'auth.login',
      objectType: 'login',
      objectId: opened.id,
      objectLabel: loginMethodLabels[method],
      after: { method },
    });
    return opened;
  });
  setSessionCookie(c, token, appEnv);
  return currentMember(access);
}
