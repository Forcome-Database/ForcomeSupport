import { LIVE_EVENT, LIVE_PATH, liveEventSchema, type LiveTopic } from '@forcome/contracts';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './api';
import { invalidateInBackground } from './background-fetch';
import { notificationsKey } from './notifications';
import { endSessionIfUnauthenticated } from './session';
import { TICKETS_QUERY_KEY, UNASSIGNED_MAIL_QUERY_KEY } from './tickets';

/*
 * 实时推送（ADR 0006「SSE」、ADR 0007 修订，待办 18）：登录后连 /api/live，收到「某类对象变了」就让对应的缓存失效，
 * 正在显示的查询随即在后台重新拉取（background-fetch.ts：带后台请求头，不续期会话）。
 * 每次连上（收到 ready，服务端已开始监听）都在后台全部重新拉取一次：第一次补上页面取数与开始监听之间的变化，断线重连（浏览器按服务端
 * 给的 retry 自己重连）后补上断开期间的变化。连接被拒（401 等）时先用后台请求核对会话：会话已结束就按会话结束处理，否则隔一会儿再连。
 */

/** 连接被拒或连不上时隔多久再连 */
const RECONNECT_MS = 5_000;

/** 服务端在开始监听后发的第一条（org/live.ts 的 LIVE_READY_EVENT） */
const READY_EVENT = 'ready';

/** 每一类变化让哪些缓存失效 */
const TOPIC_KEYS: Readonly<Record<Exclude<LiveTopic, 'resync'>, QueryKey>> = {
  tickets: TICKETS_QUERY_KEY,
  unassigned_mail: UNASSIGNED_MAIL_QUERY_KEY,
  notifications: notificationsKey,
};

/**
 * 一阵推送合成一次重新拉取：同一类变化在这段时间内只失效一次（批量归并、历史回放时每个事务都会推一条，不能每条都重新拉取）
 */
export const LIVE_COALESCE_MS = 300;

/**
 * 收到推送后，把要失效的缓存攒一下再失效（返回登记的函数与清掉还没到点的计时器的函数）；
 * resync 让全部缓存失效
 */
export function liveInvalidator(queryClient: QueryClient) {
  const timers = new Map<QueryKey, ReturnType<typeof setTimeout>>();
  return {
    apply(topic: LiveTopic): void {
      const keys = topic === 'resync' ? Object.values(TOPIC_KEYS) : [TOPIC_KEYS[topic]];
      for (const key of keys) {
        if (timers.has(key)) continue;
        timers.set(
          key,
          setTimeout(() => {
            timers.delete(key);
            void invalidateInBackground(queryClient, key);
          }, LIVE_COALESCE_MS),
        );
      }
    },
    stop(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

/** 登录后挂在外壳上：连着 /api/live，直到退出登录或页面关闭 */
export function useLiveUpdates(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const invalidator = liveInvalidator(queryClient);

    const later = () => {
      clearTimeout(retry);
      retry = setTimeout(open, RECONNECT_MS);
    };

    function open() {
      if (stopped) return;
      const current = new EventSource(LIVE_PATH);
      source = current;
      current.addEventListener(READY_EVENT, () => invalidator.apply('resync'));
      current.addEventListener(LIVE_EVENT, (event) => {
        let data: unknown;
        try {
          data = JSON.parse((event as MessageEvent<string>).data);
        } catch {
          return;
        }
        const parsed = liveEventSchema.safeParse(data);
        if (parsed.success) invalidator.apply(parsed.data.topic);
      });
      current.onerror = () => {
        // 还在 CONNECTING 是浏览器在自己重连；CLOSED 是连接被拒（401 等），不会再自己重连
        if (current.readyState !== EventSource.CLOSED || stopped) return;
        current.close();
        api.me({ background: true }).then(later, (error: unknown) => {
          if (!endSessionIfUnauthenticated(queryClient, error)) later();
        });
      };
    }

    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      invalidator.stop();
      source?.close();
    };
  }, [queryClient]);
}
