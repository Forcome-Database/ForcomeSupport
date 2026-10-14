import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { Logger } from './logger';
import type { Tx } from './runtime';

/*
 * 数据变化的通知（ADR 0006「实时推送」，待办 18）：业务事务里 announceChange 发 PostgreSQL NOTIFY（随事务提交才送出，
 * 回滚就不送；同一事务里内容相同的只送一次），api 进程用一条专门的连接 LISTEN（createChangeFeed），再经 SSE 推给浏览器
 * （org 的 /api/live）。只说「哪一类对象变了」，不带数据；站内通知另带接收人，只推给他们。
 */

/** NOTIFY 的频道 */
export const CHANGE_CHANNEL = 'forcome_change';

/** 一次变化：工单、未归属店铺来信队列，或某几位成员的站内通知 */
export type Change =
  | { readonly topic: 'tickets' }
  | { readonly topic: 'unassigned_mail' }
  | { readonly topic: 'notifications'; readonly memberIds: readonly string[] };

/** 监听送来的：一次变化，或监听断过、重连上了（期间的变化可能漏了） */
export type ChangeEvent = Change | { readonly topic: 'resync' };

/** NOTIFY 的内容上限是 8000 字节：接收人多时分几条发（成员 id 36 字符，100 个约 4 KB） */
const MEMBER_IDS_PER_NOTIFY = 100;

/** 在事务里登记一次变化，随事务提交送出 */
export async function announceChange(tx: Tx, change: Change): Promise<void> {
  const payloads =
    change.topic === 'notifications'
      ? Array.from(
          { length: Math.ceil(change.memberIds.length / MEMBER_IDS_PER_NOTIFY) },
          (_, i) => ({
            topic: change.topic,
            memberIds: change.memberIds.slice(
              i * MEMBER_IDS_PER_NOTIFY,
              (i + 1) * MEMBER_IDS_PER_NOTIFY,
            ),
          }),
        )
      : [change];
  for (const payload of payloads) {
    await tx.db.execute(sql`SELECT pg_notify(${CHANGE_CHANNEL}, ${JSON.stringify(payload)})`);
  }
}

function parseChange(payload: string | undefined): Change | null {
  try {
    const value = JSON.parse(payload ?? '') as Partial<Record<string, unknown>>;
    if (value.topic === 'tickets' || value.topic === 'unassigned_mail')
      return { topic: value.topic };
    if (value.topic === 'notifications' && Array.isArray(value.memberIds)) {
      return {
        topic: 'notifications',
        memberIds: value.memberIds.filter((id): id is string => typeof id === 'string'),
      };
    }
  } catch {
    // 认不出的内容丢掉（下面记日志）
  }
  return null;
}

/** 一位订阅者：ready 在监听已建立（之后提交的变化都会送到）或已退订时完成 */
export interface ChangeSubscription {
  readonly ready: Promise<void>;
  unsubscribe(): void;
}

/** api 进程里的变化来源：一条专门的数据库连接 LISTEN，分发给各条 SSE 连接 */
export interface ChangeFeed {
  /**
   * 订阅；第一位订阅者到来时才连数据库开始监听，之后一直保持。onClose 在变化来源关闭（进程退出）时调用，退订后不再调用
   */
  subscribe(listener: (event: ChangeEvent) => void, onClose?: () => void): ChangeSubscription;
  /** 断开监听（进程退出、测试结束） */
  close(): Promise<void>;
}

export interface ChangeFeedOptions {
  /** 连接断开后多久重连，默认 5 秒 */
  readonly retryMs?: number;
}

/**
 * 变化来源：懒连接（还没有人订阅过时不占连接，连上后一直保持），连接出错或断开后按 retryMs 重连，重连上后给所有订阅者送 resync。
 * 多个 api 实例各自监听，不用改代码（ADR 0006）。
 */
export function createChangeFeed(
  databaseUrl: string,
  logger: Logger,
  options: ChangeFeedOptions = {},
): ChangeFeed {
  const retryMs = options.retryMs ?? 5_000;
  /** 订阅者 → 关闭时的回调 */
  const listeners = new Map<(event: ChangeEvent) => void, (() => void) | undefined>();
  let client: pg.Client | null = null;
  let connecting: Promise<void> | null = null;
  let retry: NodeJS.Timeout | undefined;
  let everConnected = false;
  let closed = false;

  const dispatch = (event: ChangeEvent) => {
    for (const listener of listeners.keys()) {
      try {
        listener(event);
      } catch (error) {
        logger.warn({ err: error }, '实时推送：分发变化失败');
      }
    }
  };

  const scheduleReconnect = () => {
    if (closed || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      void connect().catch(() => undefined);
    }, retryMs);
  };

  const drop = (current: pg.Client) => {
    if (client !== current) return;
    client = null;
    current.removeAllListeners();
    current.on('error', () => undefined);
    void current.end().catch(() => undefined);
    scheduleReconnect();
  };

  function connect(): Promise<void> {
    if (client) return Promise.resolve();
    connecting ??= (async () => {
      const next = new pg.Client({
        connectionString: databaseUrl,
        keepAlive: true,
        application_name: 'forcome-api-listen',
      });
      try {
        await next.connect();
        await next.query(`LISTEN ${CHANGE_CHANNEL}`);
      } catch (error) {
        next.on('error', () => undefined);
        void next.end().catch(() => undefined);
        logger.warn({ err: error, retryMs }, '实时推送：连不上数据库，稍后重连');
        scheduleReconnect();
        throw error;
      }
      if (closed) {
        await next.end();
        return;
      }
      next.on('notification', (message) => {
        const change = parseChange(message.payload);
        if (change) dispatch(change);
        else logger.warn({ payload: message.payload }, '实时推送：认不出的变化通知');
      });
      next.on('error', (error) => {
        logger.warn({ err: error }, '实时推送：监听连接出错，稍后重连');
        drop(next);
      });
      next.on('end', () => drop(next));
      client = next;
      // 断过又连上：断开期间提交的变化收不到了，让浏览器全部重新拉取
      if (everConnected) dispatch({ topic: 'resync' });
      everConnected = true;
    })().finally(() => {
      connecting = null;
    });
    return connecting;
  }

  return {
    subscribe(listener, onClose) {
      listeners.set(listener, onClose);
      // 连不上时 ready 一直等到重连成功（SSE 连接照常保持，浏览器不用跟着重连）
      const ready = new Promise<void>((resolve) => {
        const attempt = () => {
          if (closed || !listeners.has(listener)) return resolve();
          connect().then(resolve, () => setTimeout(attempt, retryMs));
        };
        attempt();
      });
      return {
        ready,
        unsubscribe: () => {
          listeners.delete(listener);
        },
      };
    },
    async close() {
      closed = true;
      clearTimeout(retry);
      const onCloses = [...listeners.values()];
      listeners.clear();
      for (const onClose of onCloses) onClose?.();
      await connecting?.catch(() => undefined);
      const current = client;
      client = null;
      if (current) {
        current.removeAllListeners();
        current.on('error', () => undefined);
        await current.end().catch(() => undefined);
      }
    },
  };
}
