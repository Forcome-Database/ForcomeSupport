import { Loader2, X, CircleX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from './api';

/*
 * 浮层提示（全局状态 G5，原型 toast()）的统一入口，各页面不直接调 sonner：
 * 失败浮层不自动消失，必须给出重试或下一步；右上角 × 可关闭。成功、撤销等浮层第一次用到的待办在这里补上。
 */

export interface ErrorToastOptions {
  /** 说明：保留了什么、接下来会怎样（原型例「修改已保存在本机，网络恢复后自动重试并提示结果。」） */
  readonly description?: string;
  /**
   * 「立即重试」：点了进入处理中、防重复点击；成功后浮层消失，再失败浮层留着可以再试。
   * 不给重试时 description 里要写下一步该怎么办。
   */
  readonly retry?: () => Promise<unknown>;
}

/** 失败的原因，接在「保存失败：」之类的标题后面 */
export function failureReason(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  // fetch 连不上服务器时抛 TypeError
  if (error instanceof TypeError) return '网络不可用';
  return '请稍后再试';
}

/** 失败浮层（G5）：不自动消失；返回浮层 id */
export function showError(title: string, options: ErrorToastOptions = {}): string | number {
  return toast.custom((id) => <ErrorToast id={id} title={title} {...options} />, {
    duration: Infinity,
  });
}

function ErrorToast({
  id,
  title,
  description,
  retry,
}: ErrorToastOptions & { id: string | number; title: string }) {
  const [pending, setPending] = useState(false);

  async function onRetry() {
    if (!retry || pending) return;
    setPending(true);
    try {
      await retry();
      toast.dismiss(id);
    } catch {
      setPending(false);
    }
  }

  return (
    <div
      role="alert"
      className="flex w-90 items-start gap-2.5 rounded-lg border bg-card px-3.5 py-3 shadow-md"
    >
      <CircleX className="size-4.5 shrink-0 text-destructive" strokeWidth={2} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-13 font-semibold text-foreground">{title}</div>
        {description && (
          <div className="text-12 leading-[1.5] text-muted-foreground">{description}</div>
        )}
        {retry && (
          <div className="pt-0.5">
            <button
              type="button"
              aria-busy={pending || undefined}
              disabled={pending}
              onClick={() => void onRetry()}
              className="inline-flex items-center gap-1 rounded-sm text-12 font-medium whitespace-nowrap text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-85"
            >
              {pending && <Loader2 className="size-3 animate-spin" strokeWidth={2.2} />}
              立即重试
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="关闭"
        onClick={() => toast.dismiss(id)}
        className="rounded-sm text-subtle-foreground outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
