import { can, LIVE_EVENT, LIVE_PATH, type LiveTopic, type Role } from '@forcome/contracts';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppEnv, ChangeEvent, ChangeFeed, Runtime } from '../core';
import { requireSession, type AccessVariables } from './access';
import { loginDenial } from './login';
import { lookupSession, sessionToken } from './session';

/*
 * 实时推送（ADR 0006「SSE」，待办 18）：GET /api/live 是一条 SSE 连接，数据变化时推「某类对象变了」（contracts 的 live.ts），
 * 浏览器让对应的缓存失效后重新拉取。在 org 是因为要按会话与成员决定推什么：
 * - 连接本身不续期会话（EventSource 带不了后台请求头；ADR 0010「7 天无操作过期」），每次心跳重新核对会话，过期、退出、
 *   停用或不再能进入时断开——浏览器随即重连，得到 401 后按会话结束处理；
 * - 工单只推给有「查看工单」能力的，未归属店铺来信只推给有「指定店铺」能力的，站内通知只推给接收人；推送里不带数据，
 *   不按店铺范围再分（重新拉取时照常按范围过滤）。
 */

/** 心跳间隔：写一行注释保住连接（代理与浏览器都不会当它断了），顺带重新核对会话 */
export const LIVE_HEARTBEAT_MS = 25_000;

/** 断线后浏览器隔多久重连（SSE 的 retry） */
const RECONNECT_MS = 5_000;

/** 连接建立、开始监听后发的第一条（浏览器据此知道是不是重连上的：重连上时全部重新拉取，补上断开期间的变化） */
export const LIVE_READY_EVENT = 'ready';

/** 这位成员要不要收这一条，要的话推哪一类 */
function topicFor(
  event: ChangeEvent,
  member: { id: string; roles: readonly Role[] },
): LiveTopic | null {
  switch (event.topic) {
    case 'tickets':
      return can(member.roles, 'ticket.view') ? 'tickets' : null;
    case 'unassigned_mail':
      return can(member.roles, 'ticket.assign_store') ? 'unassigned_mail' : null;
    case 'notifications':
      return event.memberIds.includes(member.id) ? 'notifications' : null;
    case 'resync':
      return 'resync';
  }
}

export function createLiveRoutes(deps: {
  runtime: Runtime;
  appEnv: AppEnv;
  changes: ChangeFeed;
  /** 测试里调短 */
  heartbeatMs?: number;
}) {
  const { runtime, appEnv, changes } = deps;
  const heartbeatMs = deps.heartbeatMs ?? LIVE_HEARTBEAT_MS;
  const routes = new Hono<{ Variables: AccessVariables }>();
  routes.use(LIVE_PATH, requireSession(runtime, appEnv, { background: true }));

  routes.get(LIVE_PATH, (c) => {
    const access = c.get('access');
    const token = sessionToken(c);
    let member = { id: access.member.id, roles: access.member.roles };
    return streamSSE(c, async (stream) => {
      // 等心跳的计时器在连接断开时立即结束，不让断开的连接再挂一个心跳周期
      let wake: (() => void) | undefined;
      stream.onAbort(() => wake?.());
      const pause = (ms: number) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });

      const subscription = changes.subscribe((event) => {
        const topic = topicFor(event, member);
        if (topic) void stream.writeSSE({ event: LIVE_EVENT, data: JSON.stringify({ topic }) });
      });
      // 进程退出（变化来源关闭）时结束连接，浏览器稍后重连到新的进程
      let shuttingDown = false;
      void subscription.closed.then(() => {
        shuttingDown = true;
        wake?.();
      });
      try {
        await subscription.ready;
        await stream.writeSSE({ event: LIVE_READY_EVENT, data: '{}', retry: RECONNECT_MS });
        while (!stream.aborted && !stream.closed && !shuttingDown) {
          await pause(heartbeatMs);
          if (stream.aborted || shuttingDown || !token) break;
          // 会话已结束（过期、退出、停用、不再能进入）就断开；角色改了按新角色推
          const found = await lookupSession(runtime.db, token, runtime.clock.now(), {
            renew: false,
            keepExpired: true,
          });
          if (found.status !== 'active' || loginDenial(found.member) !== null) break;
          member = { id: found.member.id, roles: found.member.roles };
          await stream.write(': ping\n\n');
        }
      } finally {
        subscription.unsubscribe();
      }
    });
  });

  return routes;
}
