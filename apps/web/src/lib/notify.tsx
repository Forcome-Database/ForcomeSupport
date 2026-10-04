import { CircleCheck, CircleX, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { failureReason } from './api';

/*
 * 浮层提示（全局状态 G5，原型 toast()）的统一入口；页面不直接调 sonner（lint 限定，ADR 0007 修订）。
 * 失败浮层不自动消失，必须给出重试或下一步；同一件事只留一条（id），成功后用 dismissToast(id) 撤掉。
 * 成功浮层 3 秒消失（showSuccess，P18 保存店铺起用）；撤销等浮层第一次用到的待办在这里补上，同样照 G5。
 */

type ErrorToastOptions = {
  /** 同一件事的标识（即浮层 id）：再失败替换旧浮层而不是再叠一条，成功后用它撤掉 */
  readonly id: string;
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

/** 每次弹出都换一个 React key：同一个 id 的浮层被 Sonner 原地替换时，上一次的重试状态不能沿用 */
let shown = 0;

/** 失败浮层（G5）：不自动消失 */
export function showError(options: ErrorToastOptions): void {
  const instance = ++shown;
  toast.custom(() => <ErrorToast key={instance} {...options} />, {
    id: options.id,
    duration: Infinity,
  });
}

/** 成功浮层（G5、K6「设置已保存 · 已记入审计日志」）：绿色勾，3 秒后自动消失 */
export function showSuccess(options: { readonly title: string; readonly description?: string }) {
  toast.custom((id) => <SuccessToast id={id} {...options} />);
}

/** 撤掉某件事的浮层（例如之后保存成功了） */
export function dismissToast(id: string): void {
  toast.dismiss(id);
}

/** 撤掉全部浮层（退出登录、会话结束时，不把上一位成员的提示留在登录页上） */
export function dismissAllToasts(): void {
  toast.dismiss();
}

/** 浮层卡片（原型 toast()）：宽 360、12 圆角、1px 边线、md 阴影、内边距 12 / 14；左侧 18 的图标，右上角 × */
function ToastCard({
  id,
  icon,
  children,
}: {
  id: string | number;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex w-90 items-start gap-2.5 rounded-lg border bg-card px-3.5 py-3 shadow-md">
      {icon}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
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

function SuccessToast({
  id,
  title,
  description,
}: {
  id: string | number;
  title: string;
  description?: string;
}) {
  return (
    <ToastCard
      id={id}
      icon={<CircleCheck className="size-4.5 shrink-0 text-success" strokeWidth={2} />}
    >
      <div className="text-13 font-semibold text-foreground">{title}</div>
      {description && (
        <div className="text-12 leading-normal text-muted-foreground">{description}</div>
      )}
    </ToastCard>
  );
}

function ErrorToast({ id, action, error, description, retry }: ErrorToastOptions) {
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
    <ToastCard
      id={id}
      icon={<CircleX className="size-4.5 shrink-0 text-destructive" strokeWidth={2} />}
    >
      <div className="text-13 font-semibold text-foreground">{title}</div>
      {description && (
        <div className="text-12 leading-normal text-muted-foreground">{description}</div>
      )}
      {retry && (
        <div className="pt-0.5">
          <Button variant="text-link" size="text" loading={pending} onClick={() => void onRetry()}>
            立即重试
          </Button>
        </div>
      )}
    </ToastCard>
  );
}
