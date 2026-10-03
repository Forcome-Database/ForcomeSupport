import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Brand } from '@/components/brand';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { avatarText } from '@/lib/avatar';
import { devMembersQuery, rememberMember } from '@/lib/session';

/**
 * 开发登录页（只在非生产环境、开启开发登录时出现；原型没有这个画面，见 prototype.md「当期没有原型的界面」）：
 * 照登录卡片（G11）的布局——居中卡片、品牌标、标题与说明、分隔线下的注释——把二维码换成成员列表。
 */
export function DevLoginPage() {
  const { data: members } = useSuspenseQuery(devMembersQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const login = useMutation({
    mutationFn: api.devLogin,
    onSuccess: async (member) => {
      rememberMember(queryClient, member);
      await navigate({ to: '/' });
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-90 items-center gap-3.5 rounded-xl px-6 pt-6 pb-5 shadow-card">
        <Brand />
        <div className="flex flex-col gap-0.5 text-center">
          <h1 className="text-16 font-bold text-foreground">开发登录</h1>
          <p className="text-12 text-muted-foreground">选择一位示例成员直接登录，不经钉钉扫码</p>
        </div>
        <ul className="flex w-full flex-col gap-2">
          {(members ?? []).map((member) => (
            <li key={member.id}>
              <Button
                variant="outline"
                size="lg"
                className="w-full justify-start gap-2"
                disabled={login.isPending}
                onClick={() => login.mutate(member.id)}
              >
                <Avatar size="sm">
                  <AvatarFallback>{avatarText(member.name)}</AvatarFallback>
                </Avatar>
                <span className="text-13 font-semibold text-foreground">{member.name}</span>
                <span className="ml-auto text-12 font-normal text-subtle-foreground">
                  {member.roles.join('、')} · {member.dept}
                </span>
              </Button>
            </li>
          ))}
        </ul>
        {login.isError && (
          <p role="alert" className="w-full text-12 text-destructive-text">
            {login.error.message}
          </p>
        )}
        <p className="w-full border-t border-border-soft pt-3 text-center text-12 leading-[1.55] text-muted-foreground">
          只在本机与开发测试环境出现，生产环境没有这个入口
        </p>
      </Card>
    </main>
  );
}
