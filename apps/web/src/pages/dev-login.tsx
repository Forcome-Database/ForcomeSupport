import { roleNames } from '@forcome/contracts';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { AuthCard, AuthHeading, AuthNote } from '@/components/auth-card';
import { BACK_TO_LOGIN } from '@/pages/login/login-copy';
import { LoginDenied } from '@/components/login-denied';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { api, LoginDeniedError } from '@/lib/api';
import { avatarText } from '@/lib/avatar';
import { devMembersQuery, resetCacheForMember } from '@/lib/session';

/**
 * 开发登录页（只在非生产环境、开启开发登录时出现；原型没有这个画面，见 prototype.md「当期没有原型的界面」）：
 * 照登录卡片（G11）的布局——居中卡片、品牌标、标题与说明、分隔线下的注释——把二维码换成成员列表。
 * 登录被拒（第一期的生产厂对接人等）时卡片换成 G12 的被拒说明（宽 410）。开发登录要能换一位成员再试，
 * 所以三种被拒都带「返回登录页」（取自 G12 另两种被拒的按钮）；原型里生产厂对接人那一种没有按钮，
 * 钉钉扫码登录（pages/login）照原型不加。
 */
export function DevLoginPage() {
  const { data: members } = useSuspenseQuery(devMembersQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const login = useMutation({
    mutationFn: api.devLogin,
    onSuccess: async (member) => {
      resetCacheForMember(queryClient, member);
      await navigate({ to: '/' });
    },
  });

  const denied = login.error instanceof LoginDeniedError ? login.error : null;
  if (denied) {
    const member = members?.find((m) => m.id === login.variables);
    return (
      <AuthCard wide>
        <LoginDenied
          reason={denied.reason}
          message={denied.message}
          member={member}
          action={
            <Button variant="outline" onClick={() => login.reset()}>
              <ChevronLeft />
              {BACK_TO_LOGIN}
            </Button>
          }
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthHeading title="开发登录" subtitle="选择一位示例成员直接登录，不经钉钉扫码" />
      <ul className="flex w-full flex-col gap-2">
        {(members ?? []).map((member) => {
          const loading = login.isPending && login.variables === member.id;
          return (
            <li key={member.id}>
              <Button
                variant="outline"
                size="lg"
                className="w-full justify-start gap-2"
                loading={loading}
                // 处理中时其他成员的按钮也不再提交，防止重复登录（设计规范第 4 节）
                onClick={() => {
                  if (!login.isPending) login.mutate(member.id);
                }}
              >
                {!loading && (
                  <Avatar
                    size="sm"
                    tone={member.roles.includes('factory_contact') ? 'amber' : 'member'}
                  >
                    <AvatarFallback>{avatarText(member.name)}</AvatarFallback>
                  </Avatar>
                )}
                <span className="text-13 font-semibold text-foreground">{member.name}</span>
                <span className="ml-auto text-12 font-normal text-subtle-foreground">
                  {/* 钉钉通讯录同步进来、还没分配角色的人也在列表里（登录会被拒，G12） */}
                  {roleNames(member.roles) || '未分配角色'} · {member.dept}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
      {login.isError && (
        <p role="alert" className="w-full text-12 text-destructive-text">
          {login.error.message}
        </p>
      )}
      <AuthNote>只在本机与开发测试环境出现，生产环境没有这个入口</AuthNote>
    </AuthCard>
  );
}
