import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LoadError } from '@/components/load-error';
import { channelSettingsQuery } from '@/lib/channel';
import { ChannelCards } from './channel-cards';
import { SettingsHeader, SettingsLayout } from './settings-layout';
import { StoreDrawer, type StoreDrawerTarget } from './store-drawer';
import { StoreTable } from './store-table';

/*
 * P18 设置 · 渠道与店铺（第一阶段，PRD P18「第一阶段」、K20；参照图 design/spec/shots/phase1/P18_Settings.png）：
 * 页头说明、渠道连接卡、店铺表；新增与编辑店铺用右侧抽屉（K8），在抽屉里保存，没有吸底保存栏。
 * 页头右上「查看审计日志」（进入 P27）随 30 号待办加上，在那之前不显示。
 */

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-secondary ${className}`} />;
}

/** 加载中：渠道卡与店铺表的骨架（设计规范第 9 节） */
function ChannelsSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function ChannelsPage() {
  const settings = useQuery(channelSettingsQuery);
  const [drawer, setDrawer] = useState<StoreDrawerTarget | null>(null);

  return (
    <SettingsLayout>
      <SettingsHeader
        title="渠道与店铺"
        description="订单由平台直读；客户来信统一经 Gmail 收取。店铺决定订单匹配与数据权限。"
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
            onClose={() => setDrawer(null)}
          />
        </>
      )}
    </SettingsLayout>
  );
}
