import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { History } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { LoadError } from '@/components/load-error';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { channelSettingsQuery } from '@/lib/channel';
import { pages } from '@/lib/pages';
import { ChannelCards } from './channel-cards';
import { PAGE_DESCRIPTION, PAGE_TITLE, VIEW_AUDIT_LOG } from './p18-copy';
import { SettingsHeader, SettingsLayout } from './settings-layout';
import { StoreDrawer, type StoreDrawerTarget } from './store-drawer';
import { StoreTable } from './store-table';

/*
 * P18 设置 · 渠道与店铺（第一阶段，PRD P18「第一阶段」、K20；参照图 design/spec/shots/phase1/P18_Settings.png）：
 * 页头说明与右上「查看审计日志」（进入 P27，管理员的另一个入口）、渠道连接卡、店铺表；新增与编辑店铺用右侧抽屉（K8），
 * 在抽屉里保存，没有吸底保存栏。地址栏带了店铺 ID（从 P27 点店铺进来）时打开该店铺的编辑抽屉。
 */

/** P18 地址栏：store 为要打开编辑抽屉的店铺（P27 点进详情，PRD P27 v2.20）；写错的丢掉 */
export const channelsSearchSchema = z.object({ store: z.uuid().optional().catch(undefined) });

/** 加载中：渠道卡与店铺表的骨架（设计规范第 9 节） */
function ChannelsSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-md" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-md" />
        ))}
      </div>
    </div>
  );
}

export function ChannelsPage() {
  const settings = useQuery(channelSettingsQuery);
  const [opened, setDrawer] = useState<StoreDrawerTarget | null>(null);
  const search = channelsSearchSchema.parse(useSearch({ strict: false }));
  const navigate = useNavigate();
  const linked = search.store
    ? settings.data?.stores.find((store) => store.id === search.store)
    : undefined;
  const drawer: StoreDrawerTarget | null =
    opened ?? (linked ? { mode: 'edit', store: linked } : null);
  const closeDrawer = () => {
    setDrawer(null);
    if (search.store) void navigate({ to: pages.settingsChannels.path, search: {} });
  };

  return (
    <SettingsLayout>
      <SettingsHeader
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        actions={
          <Button variant="outline" asChild>
            <Link to={pages.audit.path}>
              <History />
              {VIEW_AUDIT_LOG}
            </Link>
          </Button>
        }
      />
      {settings.isPending ? (
        <ChannelsSkeleton />
      ) : settings.isError ? (
        <LoadError onRetry={() => void settings.refetch()} />
      ) : (
        <>
          <ChannelCards channels={settings.data.channels} stores={settings.data.stores} />
          <StoreTable
            stores={settings.data.stores}
            onCreate={() => setDrawer({ mode: 'create' })}
            onEdit={(store) => setDrawer({ mode: 'edit', store })}
          />
          <StoreDrawer
            target={drawer}
            dataSourceEditable={settings.data.dataSourceEditable}
            onClose={closeDrawer}
          />
        </>
      )}
    </SettingsLayout>
  );
}
