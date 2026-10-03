import { contactAdmins, roleNames, rolesWith, type CurrentMember } from '@forcome/contracts';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { PageDefinition } from '@/lib/pages';
import { sectionPaths } from '@/lib/pages';
import { adminContactsQuery } from '@/lib/session';
import { EmptyState } from './empty-state';

/**
 * 无权限（G2，原型 GlobalStates 的 page_403）：从链接直接进入无权页面时，在内容区正中显示卡片，
 * 写明哪个角色能看、你当前的角色、找谁开通；按钮只有「返回首页」（回到该角色的默认首页），没有「申请权限」。
 */
export function Forbidden({ page, member }: { page: PageDefinition; member: CurrentMember }) {
  const { data } = useSuspenseQuery(adminContactsQuery);
  const description =
    `「${page.label}」只对${roleNames(rolesWith(page.capability))}开放。` +
    `你当前的角色是${roleNames(member.roles)}，如需开通请${contactAdmins(data.admins.map((a) => a.name))}。`;
  return (
    <div className="flex flex-1 items-center justify-center">
      <Card className="px-6 py-2">
        <EmptyState
          icon={Lock}
          title="没有访问权限"
          description={description}
          action={
            <Button asChild>
              <Link to={sectionPaths[member.home]}>
                <ChevronLeft />
                返回首页
              </Link>
            </Button>
          }
        />
      </Card>
    </div>
  );
}
