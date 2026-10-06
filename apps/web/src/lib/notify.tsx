import { CircleCheck, CircleX, History, Info, Loader2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { failureReason } from './api';

/*
 * 浮层提示（全局状态 G5，原型 toast()）的统一入口；页面不直接调 sonner（lint 限定，ADR 0007 修订）。
 * 失败浮层不自动消失，必须给出重试或下一步；同一件事只留一条（id），成功后用 dismissToast(id) 撤掉。
 * 成功浮层 3 秒消失（showSuccess，P18 保存店铺起用）；可逆操作的撤销浮层（showUndo，P13 设为已完成起用，待办 21）
 * 固定在内容区右下的另一个容器（UNDO_TOASTER），带倒计时，倒计时结束前不消失（G5）。
 * 警示浮层（showWarning，不自动消失）与中性浮层（showNeutral，3 秒消失）随 P20 的吸底保存栏起用（K6 断网后自动重试，待办 06）。
 */

/** 撤销浮层的容器 id（components/ui/sonner.tsx 的 UndoToaster） */
export const UNDO_TOASTER = 'undo';

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

/**
 * 警示浮层（原型 toast('warning')，K6「网络已断开，暂未保存」）：黄色警示图标，不自动消失；
 * pending 为说明下方带转圈的进行中写法（「等待网络恢复…」）。同一件事用同一个 id，之后用 dismissToast(id) 撤掉
 */
export function showWarning(options: {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly pending?: string;
}): void {
  toast.custom((toastId) => <WarningToast toastId={toastId} {...options} />, {
    id: options.id,
    duration: Infinity,
  });
}

/** 中性浮层（原型 toast('neutral')，K6「已自动重试并保存」）：灰色信息图标，3 秒后自动消失 */
export function showNeutral(options: { readonly title: string; readonly description?: string }) {
  toast.custom((id) => <NeutralToast id={id} {...options} />);
}

type UndoToastOptions = {
  /** 同一件事的标识（即浮层 id） */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** 撤销窗口的秒数（G5：5 秒） */
  readonly seconds: number;
  /**
   * 点「撤销」：进入处理中、防重复点击；成功（resolve）后浮层消失；失败（reject）时浮层消失，由调用方给失败浮层
   */
  readonly onUndo: () => Promise<unknown>;
};

/**
 * 可逆操作的撤销浮层（G5，原型 toast(..., undo=5)）：成功图标、标题与说明，右侧剩余秒数与「撤销」，底部主色倒计时条；
 * 倒计时结束自动消失（之后不能再撤销），点「撤销」后消失
 */
export function showUndo(options: UndoToastOptions): void {
  const instance = ++shown;
  toast.custom((id) => <UndoToast key={instance} toastId={id} {...options} />, {
    id: options.id,
    toasterId: UNDO_TOASTER,
    duration: Infinity,
  });
}

/** 撤掉某件事的浮层（例如之后保存成功了） */
export function dismissToast(id: string): void {
  toast.dismiss(id);
}

/** 撤掉全部浮层（退出登录、会话结束时，不把上一位成员的提示留在登录页上） */
export function dismissAllToasts(): void {
  toast.dismiss();
}

/**
 * 浮层卡片（原型 toast()）：宽 360、12 圆角、1px 边线、md 阴影、内边距 12 / 14；左侧 18 的图标，右上角 ×。
 * 撤销浮层（toast(undo=)）的右侧是剩余秒数与「撤销」（aside 代替 ×）、底部是倒计时条（footer），只有标题时内容竖向居中
 */
function ToastCard({
  id,
  icon,
  children,
  aside,
  footer,
  centered = false,
}: {
  id: string | number;
  icon: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  centered?: boolean;
}) {
  return (
    <div
      className={cn(
        'relative flex w-90 gap-2.5 overflow-hidden rounded-lg border bg-card px-3.5 py-3 shadow-md',
        centered ? 'items-center' : 'items-start',
      )}
    >
      {icon}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
      {aside ?? (
        <button
          type="button"
          aria-label="关闭"
          onClick={() => toast.dismiss(id)}
          className="rounded-sm text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      )}
      {footer}
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

function WarningToast({
  toastId,
  title,
  description,
  pending,
}: {
  toastId: string | number;
  title: string;
  description?: string;
  pending?: string;
}) {
  return (
    <ToastCard
      id={toastId}
      icon={<TriangleAlert className="size-4.5 shrink-0 text-warning" strokeWidth={2} />}
    >
      <div className="text-13 font-semibold text-foreground">{title}</div>
      {description && (
        <div className="text-12 leading-normal text-muted-foreground">{description}</div>
      )}
      {pending && (
        <div className="flex items-center gap-1.5 pt-0.5 text-12 text-muted-foreground">
          <Loader2 className="size-3 animate-spin text-subtle-foreground" strokeWidth={2.2} />
          {pending}
        </div>
      )}
    </ToastCard>
  );
}

function NeutralToast({
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
      icon={<Info className="size-4.5 shrink-0 text-muted-foreground" strokeWidth={2} />}
    >
      <div className="text-13 font-semibold text-foreground">{title}</div>
      {description && (
        <div className="text-12 leading-normal text-muted-foreground">{description}</div>
      )}
    </ToastCard>
  );
}

function UndoToast({
  toastId,
  title,
  description,
  seconds,
  onUndo,
}: UndoToastOptions & { toastId: string | number }) {
  const [left, setLeft] = useState(seconds);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (pending) return;
    if (left <= 0) {
      toast.dismiss(toastId);
      return;
    }
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, pending, toastId]);

  async function undo() {
    setPending(true);
    try {
      await onUndo();
    } finally {
      toast.dismiss(toastId);
    }
  }

  return (
    <ToastCard
      id={toastId}
      centered={!description}
      icon={<CircleCheck className="size-4.5 shrink-0 text-success" strokeWidth={2} />}
      aside={
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-12 text-subtle-foreground tabular-nums">{`${Math.max(left, 0)}s`}</span>
          <Button variant="outline" size="sm" loading={pending} onClick={() => void undo()}>
            {!pending && <History />}
            撤销
          </Button>
        </div>
      }
      footer={
        <div
          aria-hidden
          className="absolute bottom-0 left-0 h-0.75 bg-primary transition-[width] duration-1000 ease-linear"
          style={{ width: `${(Math.max(left, 0) * 100) / seconds}%` }}
        />
      }
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
