import { CircleX, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { failureReason } from './api';

/*
 * 浮层提示（全局状态 G5，原型 toast()）的统一入口；页面不直接调 sonner（lint 限定，ADR 0007 修订）。
 * 失败浮层不自动消失，必须给出重试或下一步；同一件事只留一条（key），成功后用 dismissToast(key) 撤掉。
 * 成功、撤销等浮层第一次用到的待办在这里补上，同样照 G5。
 */

type ErrorToastOptions = {
  /** 同一件事的标识：再失败替换旧浮层而不是再叠一条，成功后用它撤掉 */
  readonly key: string;
  /** 失败的动作，标题写成「<动作>失败：原因」（原型例「保存失败：网络不可用」「发送失败：Gmail 接口超时」） */
  readonly action: string;
  readonly error: unknown;
} & (
  | {
      /** 说明：保留了什么、重试后会怎样 */
      readonly description?: string;
      /**
       * 「立即重试」：点了进入处理中、防重复点击；成功（resolve）后浮层消失；
       * 再失败（reject）时标题换成「<动作>仍失败：原因」，浮层留着可以再试
       */
      readonly retry: () => Promise<unknown>;
    }
  | {
      /** 不给重试时必须写下一步该怎么办 */
      readonly description: string;
      readonly retry?: undefined;
    }
);

/** 失败浮层（G5）：不自动消失 */
export function showError(options: ErrorToastOptions): void {
  toast.custom((id) => <ErrorToast id={id} {...options} />, {
    id: options.key,
    duration: Infinity,
  });
}

/** 撤掉某件事的浮层（例如之后保存成功了） */
export function dismissToast(key: string): void {
  toast.dismiss(key);
}

/** 撤掉全部浮层（退出登录、会话结束时，不把上一位成员的提示留在登录页上） */
export function dismissAllToasts(): void {
  toast.dismiss();
}

function ErrorToast({
  id,
  action,
  error,
  description,
  retry,
}: ErrorToastOptions & { id: string | number }) {
  const [pending, setPending] = useState(false);
  const [retryError, setRetryError] = useState<unknown>(null);
  const title = retryError
    ? `${action}仍失败：${failureReason(retryError)}`
    : `${action}失败：${failureReason(error)}`;

  async function onRetry() {
    if (!retry) return;
    setPending(true);
    try {
      await retry();
      toast.dismiss(id);
    } catch (next) {
      setRetryError(next);
      setPending(false);
    }
  }

  return (
    <div className="flex w-90 items-start gap-2.5 rounded-lg border bg-card px-3.5 py-3 shadow-md">
      <CircleX className="size-4.5 shrink-0 text-destructive" strokeWidth={2} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-13 font-semibold text-foreground">{title}</div>
        {description && (
          <div className="text-12 leading-normal text-muted-foreground">{description}</div>
        )}
        {retry && (
          <div className="pt-0.5">
            <Button
              variant="link"
              className="h-auto px-0 text-12 font-medium"
              loading={pending}
              onClick={() => void onRetry()}
            >
              立即重试
            </Button>
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="关闭"
        onClick={() => toast.dismiss(id)}
        className="rounded-sm text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
