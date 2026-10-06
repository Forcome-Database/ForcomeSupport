import { loginFailureDescriptions, type CurrentMember } from '@forcome/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AuthCard } from '@/components/auth-card';
import { LoginDenied } from '@/components/login-denied';
import { Button } from '@/components/ui/button';
import { api, LoginDeniedError, LoginFailedError } from '@/lib/api';
import { dismissAllToasts, showError } from '@/lib/notify';
import { resetCacheForMember } from '@/lib/session';
import { BACK_TO_LOGIN, LOGIN_ACTION, SIGNING_IN } from './login-copy';

/*
 * 扫码登录的回调页（/login/dingtalk，钉钉开放平台「重定向 URL」，待办 05）：钉钉在手机上确认后把浏览器带到这里，
 * 地址带授权码 authCode 与这次登录的 state。拿它们换会话：成功进入默认首页（PRD 4.1）；被拒换成 G12 的说明；
 * 失败（授权码已失效、state 对不上、连不上钉钉）回到二维码，并照 G5 弹失败浮层。
 */

/** 扫码登录失败的浮层，同一时间只留一条 */
const LOGIN_ERROR_TOAST = 'dingtalk-login';

/** 地址里的授权码与 state：原样取字符串（钉钉的授权码可能全是数字，不经路由的查询串解析） */
function callbackParams(): { authCode: string; state: string } | null {
  const params = new URLSearchParams(window.location.search);
  const authCode = params.get('authCode') ?? params.get('code');
  const state = params.get('state');
  return authCode && state ? { authCode, state } : null;
}

export function LoginCallbackPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useMutation({
    mutationFn: api.dingtalkLogin,
    onSuccess: async (member: CurrentMember) => {
      dismissAllToasts();
      resetCacheForMember(queryClient, member);
      await navigate({ to: '/', replace: true });
    },
    onError: async (error) => {
      if (error instanceof LoginDeniedError) return;
      showError({
        id: LOGIN_ERROR_TOAST,
        action: LOGIN_ACTION,
        error,
        description:
          error instanceof LoginFailedError
            ? loginFailureDescriptions[error.reason]
            : loginFailureDescriptions.dingtalk_unavailable,
      });
      await navigate({ to: '/login', search: {}, replace: true });
    },
  });

  // 授权码只能用一次：开发环境的 StrictMode 会把副作用跑两遍，只提交一次
  const submitted = useRef(false);
  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    const params = callbackParams();
    if (params) login.mutate(params);
    else void navigate({ to: '/login', search: {}, replace: true });
  }, [login, navigate]);

  const denied = login.error instanceof LoginDeniedError ? login.error : null;
  if (denied) {
    return (
      <AuthCard wide>
        <LoginDenied
          reason={denied.reason}
          message={denied.message}
          member={denied.member}
          action={
            // 第一期只有生产厂对接人角色的那一种，原型没有按钮
            denied.reason === 'factory_phase1' ? undefined : (
              <Button variant="outline" onClick={() => void navigate({ to: '/login', search: {} })}>
                <ChevronLeft />
                {BACK_TO_LOGIN}
              </Button>
            )
          }
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <div role="status" className="flex items-center gap-2 py-6 text-13 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {SIGNING_IN}
      </div>
    </AuthCard>
  );
}
