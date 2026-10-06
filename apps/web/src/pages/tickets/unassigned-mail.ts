import { ASSIGN_UNDO_SECONDS, type StoreOption, type UnassignedMail } from '@forcome/contracts';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { UNASSIGNED } from './p04-copy';
import { api, ApiRequestError } from '@/lib/api';
import { dismissToast, showError, showUndo } from '@/lib/notify';
import { TICKETS_QUERY_KEY } from '@/lib/tickets';

/*
 * P04 未归属店铺来信队列（I17，待办 15）：队列的查询，与「指定店铺」的撤销窗口——点「指定」后该行立即移出、弹 5 秒撤销浮层，
 * 窗口结束后才提交（D-24、AC-P1-15）；窗口内撤销则什么都不提交，行回到队列。
 * 等着提交的指定放在模块里（不放组件状态）：窗口内离开 P04 或切回工单列表，到点照样提交，回来时行也还是移出的。
 * 刷新或关掉页面时还没到点的不提交（来信留在队列里，重新指定即可）。
 * 提交失败分两种（协调者 2026-10-07 决定 Q8）：别人已先指定或已自动归位（409）——浮层写已归入哪个店铺、不带重试，这一行随刷新移出；
 * 其余（断网、服务器出错）——行回到队列，浮层写「来信仍在未归属店铺队列里」，可以立即重试。
 */

export const UNASSIGNED_MAIL_QUERY_KEY = ['unassigned-mail'] as const;

/** 队列（只给有「指定店铺」能力的客服主管查） */
export const unassignedMailQuery = queryOptions({
  queryKey: UNASSIGNED_MAIL_QUERY_KEY,
  queryFn: api.unassignedMail,
});

/** 等着提交或正在提交的指定：来信 → 到点提交的计时器（提交中为 null） */
const pending = new Map<string, ReturnType<typeof setTimeout> | null>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();

function changed(): void {
  snapshot = new Set(pending.keys());
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 正在撤销窗口里或正在提交的来信：队列里不显示这些行 */
export function usePendingAssignments(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** 失败浮层的 id（撤销浮层另用 undoToastId：提交开始时撤掉它，不与失败浮层混在一起） */
const toastId = (mailId: string) => `assign-store-${mailId}`;
const undoToastId = (mailId: string) => `assign-store-undo-${mailId}`;

/** 队列与工单列表都重新拉取（提交后来信移出队列，归并成的工单出现在列表里） */
async function refresh(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: UNASSIGNED_MAIL_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: TICKETS_QUERY_KEY }),
  ]);
}

/** 别人已先指定或已自动归位（409）：失败浮层写已归入的店铺（后端的说明），不带重试 */
function isTaken(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 409;
}

function showTaken(mailId: string, error: ApiRequestError): void {
  showError({
    // 另用一个 id：重试时才发现被抢先，重试的浮层随重试结束消失，这一条要留下
    id: `${toastId(mailId)}-taken`,
    action: UNASSIGNED.failedAction,
    error: new ApiRequestError(409, error.code, UNASSIGNED.taken),
    description: error.message,
  });
}

/** 窗口结束：提交。成功或 409 后刷新（行随之移出），其余失败时行回到队列、浮层可重试 */
async function commit(queryClient: QueryClient, mail: UnassignedMail, store: StoreOption) {
  pending.set(mail.id, null);
  // 撤销浮层的倒计时与提交的计时器各走各的，可能还差一点没到 0：开始提交就撤掉它，不留一个已经撤销不了的「撤销」
  dismissToast(undoToastId(mail.id));
  try {
    await api.assignStore(mail.id, store.id);
    await refresh(queryClient);
  } catch (error) {
    if (isTaken(error)) {
      showTaken(mail.id, error);
      await refresh(queryClient);
    } else {
      showError({
        id: toastId(mail.id),
        action: UNASSIGNED.failedAction,
        error,
        description: UNASSIGNED.stillQueued,
        retry: async () => {
          try {
            await api.assignStore(mail.id, store.id);
          } catch (retryError) {
            if (!isTaken(retryError)) throw retryError;
            // 重试时发现别人已先指定：重试的浮层消失，换成 409 的浮层
            showTaken(mail.id, retryError);
          }
          await refresh(queryClient);
        },
      });
    }
  } finally {
    pending.delete(mail.id);
    changed();
  }
}

/**
 * 点「指定」：行立即移出，弹撤销浮层「已归入 <店铺> · 5 秒后归并成工单」；窗口结束后才提交，窗口内点「撤销」什么都不提交
 */
export function assignWithUndo(
  queryClient: QueryClient,
  mail: UnassignedMail,
  store: StoreOption,
): void {
  if (pending.has(mail.id)) return;
  const timer = setTimeout(() => void commit(queryClient, mail, store), ASSIGN_UNDO_SECONDS * 1000);
  pending.set(mail.id, timer);
  changed();
  showUndo({
    id: undoToastId(mail.id),
    title: UNASSIGNED.undoTitle(store.name),
    description: UNASSIGNED.undoDescription,
    seconds: ASSIGN_UNDO_SECONDS,
    onUndo: () => {
      const waiting = pending.get(mail.id);
      // 提交开始时撤销浮层已撤掉；这里只剩窗口内的撤销
      if (waiting) {
        clearTimeout(waiting);
        pending.delete(mail.id);
        changed();
      }
      return Promise.resolve();
    },
  });
}
