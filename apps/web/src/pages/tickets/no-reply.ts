import { NO_REPLY_UNDO_SECONDS, type TicketDetail, type TicketMessage } from '@forcome/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api';
import { dismissToast, showError, showUndo } from '@/lib/notify';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { ticketDetailQuery, TICKETS_QUERY_KEY } from '@/lib/tickets';
import { MARK_RESULT } from './p05-copy';

/*
 * P05「标记无需回复」与撤销（PRD P05「第一阶段」、AC-P1-01，待办 17；浮层写法见 I18 ① 与补充小样⑦）：
 * 点「标记无需回复」立即提交，成功后用返回的详情替换页面并弹撤销浮层——工单转了已解决写「已标记无需回复 · 工单转已解决」，
 * 还有别的未回复来信只写「已标记无需回复」；5 秒内点「撤销」提交撤销（服务端只认标记的人，多留 5 秒网络时间）。
 * 失败：被拒的（400 工单已关闭或来信已被回复、403、404、409 已被别人标记、撤销已超时）不重试，说明「已刷新为最新内容。」并重新拉取；
 * 断网、服务器出错可「立即重试」（标记失败说明「这封来信仍未标记」）；会话失效（401）按会话结束处理。
 */

const failedToast = (messageId: string) => `no-reply-failed-${messageId}`;
const undoToast = (messageId: string) => `no-reply-undo-${messageId}`;
const undoFailedToast = (messageId: string) => `no-reply-undo-failed-${messageId}`;

/** 被拒、重试也不会成功的 */
function isRefused(error: unknown): boolean {
  return error instanceof ApiRequestError && [400, 403, 404, 409].includes(error.status);
}

function useDetailCache(number: string) {
  const queryClient = useQueryClient();
  const { queryKey } = ticketDetailQuery(number);
  return {
    queryClient,
    /** 换成接口返回的最新详情；P04 列表的状态随之变化 */
    apply: (detail: TicketDetail) => {
      queryClient.setQueryData(queryKey, detail);
      void queryClient.invalidateQueries({ queryKey: [...TICKETS_QUERY_KEY, 'list'] });
    },
    refresh: () => {
      void queryClient.invalidateQueries({ queryKey: TICKETS_QUERY_KEY });
    },
  };
}

/** 失败浮层：被拒的不重试并刷新，其余可重试 */
function showFailure(
  queryClient: QueryClient,
  refresh: () => void,
  options: {
    id: string;
    action: string;
    error: unknown;
    stillThere?: string;
    retry: () => Promise<unknown>;
  },
): void {
  if (endSessionIfUnauthenticated(queryClient, options.error)) return;
  if (isRefused(options.error)) {
    refresh();
    showError({
      id: options.id,
      action: options.action,
      error: options.error,
      description: MARK_RESULT.refreshed,
    });
    return;
  }
  showError({
    id: options.id,
    action: options.action,
    error: options.error,
    description: options.stillThere,
    retry: async () => {
      try {
        await options.retry();
      } catch (retryError) {
        if (endSessionIfUnauthenticated(queryClient, retryError)) return;
        // 重试时才被拒（例如别人已先标记）：换成不带重试的浮层（另一个 id，重试的浮层随重试结束消失）
        if (!isRefused(retryError)) throw retryError;
        refresh();
        showError({
          id: `${options.id}-refused`,
          action: options.action,
          error: retryError,
          description: MARK_RESULT.refreshed,
        });
      }
    },
  });
}

/** 标记无需回复：返回提交函数与正在提交的来信（按钮显示处理中、防重复点击） */
export function useMarkNoReply(number: string) {
  const { queryClient, apply, refresh } = useDetailCache(number);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  // 防重复点击：同一帧里连点两次时 state 还没更新，另用 ref 记正在提交的来信
  const submitting = useRef(new Set<string>());

  async function undoOnce(messageId: string): Promise<void> {
    apply(await api.undoNoReply(number, messageId));
    dismissToast(undoFailedToast(messageId));
  }

  async function undo(messageId: string): Promise<void> {
    try {
      await undoOnce(messageId);
    } catch (error) {
      showFailure(queryClient, refresh, {
        id: undoFailedToast(messageId),
        action: MARK_RESULT.undoFailedAction,
        error,
        retry: () => undoOnce(messageId),
      });
    }
  }

  async function markOnce(message: TicketMessage, before: TicketDetail['ticket']['status']) {
    const detail = await api.markNoReply(number, message.id);
    apply(detail);
    dismissToast(failedToast(message.id));
    showUndo({
      id: undoToast(message.id),
      title:
        before !== 'resolved' && detail.ticket.status === 'resolved'
          ? MARK_RESULT.doneResolved
          : MARK_RESULT.done,
      seconds: NO_REPLY_UNDO_SECONDS,
      onUndo: () => undo(message.id),
    });
  }

  async function mark(message: TicketMessage, before: TicketDetail['ticket']['status']) {
    if (submitting.current.has(message.id)) return;
    submitting.current.add(message.id);
    setPending((current) => new Set(current).add(message.id));
    try {
      await markOnce(message, before);
    } catch (error) {
      showFailure(queryClient, refresh, {
        id: failedToast(message.id),
        action: MARK_RESULT.failedAction,
        error,
        stillThere: MARK_RESULT.stillUnmarked,
        retry: () => markOnce(message, before),
      });
    } finally {
      submitting.current.delete(message.id);
      setPending((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  }

  return { mark, pending };
}
