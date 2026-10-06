import {
  loginFailureDescriptions,
  loginFailureMessages,
  type DingtalkLoginStart,
} from '@forcome/contracts';
import { RefreshCw } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginFailedError } from '@/lib/api';
import {
  demoQrFinders,
  demoQrModules,
  dingtalkFrameParams,
  loadDingtalkFrame,
} from '@/lib/dingtalk-login';
import { showError } from '@/lib/notify';
import { LOGIN_ACTION, QR_EXPIRED } from './login-copy';

/** 二维码的边长（原型 qr_svg(size=168)） */
const QR_SIZE = 168;

/** 连不上钉钉（扫码登录框没加载出来、或它报错）时的失败浮层，同一时间只留一条 */
const FRAME_ERROR_TOAST = 'dingtalk-frame';

function frameFailed(retry: () => Promise<unknown>) {
  showError({
    id: FRAME_ERROR_TOAST,
    action: LOGIN_ACTION,
    error: new LoginFailedError(
      502,
      'dingtalk_unavailable',
      loginFailureMessages.dingtalk_unavailable,
    ),
    description: loginFailureDescriptions.dingtalk_unavailable,
    retry,
  });
}

/** 示意二维码（原型 qr_svg()）：Fake 时画，不能扫 */
function DemoQr() {
  const size = 25;
  const modules = useMemo(() => demoQrModules(size), []);
  return (
    <svg
      width={QR_SIZE}
      height={QR_SIZE}
      viewBox={`-1 -1 ${size + 2} ${size + 2}`}
      className="block fill-foreground"
      shapeRendering="crispEdges"
      role="img"
      aria-label="钉钉登录二维码"
    >
      {demoQrFinders(size).map(({ x, y }) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width={7} height={7} />
          <rect x={x + 1} y={y + 1} width={5} height={5} className="fill-card" />
          <rect x={x + 2} y={y + 2} width={3} height={3} />
        </g>
      ))}
      {modules.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
      ))}
    </svg>
  );
}

/**
 * 钉钉官方的扫码登录框（真实接口）：在这个格子里放钉钉的 iframe，扫码确认后把浏览器带到回调页。
 * 放进来之前格子里是骨架；加载不出来（或它报错）时格子保留骨架并弹失败浮层（G5），「立即重试」再加载一次
 * （G11 · G12 补充小样②，PRD v2.23）。每次登录（state）各挂一个，刷新后从骨架重新开始
 */
function DingtalkFrame({
  start,
  onReload,
}: {
  start: DingtalkLoginStart;
  onReload: () => Promise<unknown>;
}) {
  const id = `dingtalk-login-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadDingtalkFrame()
      .then((frame) => {
        if (cancelled) return;
        frame(
          { id, width: QR_SIZE, height: QR_SIZE },
          dingtalkFrameParams(start),
          (result) => window.location.assign(result.redirectUrl),
          () => {
            setShown(false);
            frameFailed(onReload);
          },
        );
        setShown(true);
      })
      .catch(() => {
        if (!cancelled) frameFailed(onReload);
      });
    return () => {
      cancelled = true;
      document.getElementById(id)?.replaceChildren();
    };
  }, [id, start, onReload]);
  return (
    <div className="relative size-42">
      <div id={id} className="size-42 overflow-hidden" aria-label="钉钉登录二维码" />
      {!shown && <Skeleton className="absolute inset-0 rounded-md" />}
    </div>
  );
}

/**
 * 二维码格子（原型 qr_box()）：白底、1px 边线、12 圆角、内边距 10；过期后加白色蒙层，写「二维码已过期」与「刷新」（G11）
 */
export function LoginQr({
  start,
  expired,
  refreshing,
  onRefresh,
}: {
  /** 这次登录（还没取到时画骨架） */
  start: DingtalkLoginStart | undefined;
  expired: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  return (
    <div
      className="relative rounded-lg border bg-card p-2.5"
      data-testid="login-qr"
      data-mode={start?.mode}
    >
      {!start ? (
        <Skeleton className="size-42 rounded-md" />
      ) : start.mode === 'fake' ? (
        <DemoQr />
      ) : (
        <DingtalkFrame key={start.state} start={start} onReload={onRefresh} />
      )}
      {expired && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-card/93">
          <span className="text-13 font-semibold whitespace-nowrap text-foreground">
            {QR_EXPIRED.title}
          </span>
          <Button size="sm" loading={refreshing} onClick={() => void onRefresh()}>
            <RefreshCw />
            {QR_EXPIRED.refresh}
          </Button>
        </div>
      )}
    </div>
  );
}
