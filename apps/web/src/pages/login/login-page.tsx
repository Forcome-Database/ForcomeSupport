import { LOGIN_QR_EXPIRES_SECONDS } from '@forcome/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Clock, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { AuthCard, AuthHeading, AuthNote } from '@/components/auth-card';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { dismissToast, showError } from '@/lib/notify';
import { LOGIN, QR_ACTION, SESSION_EXPIRED } from './login-copy';
import { LoginQr } from './login-qr';

/*
 * 钉钉扫码登录页（G11）与会话过期（G12「已退出登录」），待办 05。地址 /login；7 天未操作过期后带 ?expired=true 进来，
 * 先显示「已退出登录」，点「重新扫码登录」换成二维码。扫码确认后钉钉把浏览器带到 /login/dingtalk（login-callback.tsx）。
 * 在钉钉内打开时免登随第二期。
 */

/** 地址栏：expired 为会话 7 天未操作过期后进来 */
export const loginSearchSchema = z.object({ expired: z.boolean().optional() });

/** 取二维码失败的浮层，同一时间只留一条 */
const QR_ERROR_TOAST = 'login-qr';

export function LoginPage({ expired }: { expired: boolean }) {
  const navigate = useNavigate();
  if (expired) {
    return (
      <AuthCard wide>
        <EmptyState
          icon={Clock}
          title={SESSION_EXPIRED.title}
          description={SESSION_EXPIRED.description}
          action={
            <Button onClick={() => void navigate({ to: '/login', search: {} })}>
              <RefreshCw />
              {SESSION_EXPIRED.action}
            </Button>
          }
          compact
        />
      </AuthCard>
    );
  }
  return <ScanLogin />;
}

/**
 * 扫码登录（G11）：开一次登录拿二维码，2 分钟后加蒙层与「刷新」，刷新就是再开一次（新的 state，重新计时）。
 * 取二维码失败弹失败浮层（G5），「立即重试」再取
 */
function ScanLogin() {
  const [attempt, setAttempt] = useState(0);
  const start = useQuery({
    queryKey: ['auth', 'dingtalk-start', attempt],
    queryFn: api.dingtalkLoginStart,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // 过期的是哪一次登录的二维码（按 state 记）：刷新后换了新的 state，蒙层自然消失
  const [expiredState, setExpiredState] = useState<string | null>(null);
  const expired = start.data !== undefined && expiredState === start.data.state;

  useEffect(() => {
    if (!start.data) return;
    const { state } = start.data;
    const timer = setTimeout(() => setExpiredState(state), LOGIN_QR_EXPIRES_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [start.data]);

  // 刷新 = 再开始一次登录（新的 state、新的二维码，重新计时）
  const refresh = useCallback(() => {
    setAttempt((n) => n + 1);
    return Promise.resolve();
  }, []);

  const { error, refetch } = start;
  useEffect(() => {
    if (!error) {
      dismissToast(QR_ERROR_TOAST);
      return;
    }
    showError({
      id: QR_ERROR_TOAST,
      action: QR_ACTION,
      error,
      retry: async () => {
        const result = await refetch();
        if (result.error) throw result.error;
      },
    });
  }, [error, refetch]);

  return (
    <AuthCard>
      <AuthHeading title={LOGIN.title} subtitle={LOGIN.subtitle} />
      <LoginQr
        start={start.data}
        expired={expired}
        refreshing={start.isFetching}
        onRefresh={refresh}
      />
      <span className="text-12 whitespace-nowrap text-subtle-foreground">{LOGIN.validity}</span>
      <AuthNote>{LOGIN.note}</AuthNote>
    </AuthCard>
  );
}
