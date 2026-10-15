import {
  platformLabels,
  mailProviderLabels,
  platformTerms,
  type Store,
  type StoreConnection,
} from '@forcome/contracts';
import { Check, Copy, Plus, Store as StoreIcon } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { InfoTip } from '@/components/info-tip';
import { SectionLabel } from '@/components/section-label';
import { ChannelBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConnectionBadge } from './channel-cards';
import { A11Y, EMPTY_STORES, RULE_ROUTE, STORE_SECTION, STORE_TABLE } from './p18-copy';

/*
 * P18 店铺表（第一阶段，K20；原型 build_settings.p18_stores(phase1=True)）：
 * 列为 店铺 · 站点（加粗为默认）· 进线邮箱 · 平台标识（可复制）· 状态 · 行尾「编辑」，第一阶段没有覆盖项列；
 * 表头上方「店铺 N 个 | ⓘ 进线识别」，右侧「新增店铺」。上线初期没有店铺时显示空状态。
 */

function SiteCell({ store }: { store: Store }) {
  return (
    <div
      title={STORE_TABLE.defaultSiteTitle(store.defaultSite)}
      className="text-13 whitespace-nowrap text-subtle-foreground"
    >
      {store.sites.map((site, index) => (
        <Fragment key={site}>
          {index > 0 && STORE_TABLE.separator}
          <span
            className={
              site === store.defaultSite ? 'font-bold text-foreground' : 'text-muted-foreground'
            }
          >
            {site}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** 平台标识全文显示，右侧复制（复制后图标短暂变成勾） */
function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-13 text-ink-2" title={value}>
        {value}
      </span>
      <button
        type="button"
        aria-label={copied ? A11Y.copied : A11Y.copy(value)}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => setCopied(true));
        }}
        className="shrink-0 rounded-sm text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? <Check className="size-3.25 text-success" /> : <Copy className="size-3.25" />}
      </button>
    </div>
  );
}

/**
 * 「状态」列（6.9、K20 小样）：各连接同一状态时写该状态并在下方列出连接（例「已连接 / Gmail · SP-API」）；
 * 不同时逐个写出不是已连接的那几个（例「SP-API 未连接」）。
 */
function StoreStatus({ store }: { store: Store }) {
  const names: Record<StoreConnection['kind'], string> = {
    gmail: STORE_TABLE.gmail,
    // 163 企业邮箱的进线邮箱（D-28，待办 35 接口；店铺表的服务商写法随待办 36 核对）
    qiye163: mailProviderLabels.qiye163,
    orders: platformTerms[store.platform].ordersApi,
  };
  const [first] = store.connections;
  if (first && store.connections.every((c) => c.status === first.status)) {
    return (
      <div className="flex flex-col items-start gap-0.75">
        <ConnectionBadge status={first.status} />
        <span className="text-11 whitespace-nowrap text-subtle-foreground">
          {store.connections.map((c) => names[c.kind]).join(STORE_TABLE.separator)}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-0.75">
      {store.connections
        .filter((c) => c.status !== 'connected')
        .map((c) => (
          <ConnectionBadge key={c.kind} status={c.status} prefix={names[c.kind]} />
        ))}
    </div>
  );
}

function StoreRow({ store, onEdit }: { store: Store; onEdit: (store: Store) => void }) {
  const terms = platformTerms[store.platform];
  return (
    <TableRow data-testid="store-row">
      <TableCell className="py-3">
        <div className="flex flex-col items-start gap-1">
          <span className="truncate text-13 font-semibold text-foreground">{store.name}</span>
          <ChannelBadge channel={store.platform}>{platformLabels[store.platform]}</ChannelBadge>
        </div>
      </TableCell>
      <TableCell className="py-3">
        <SiteCell store={store} />
      </TableCell>
      <TableCell className="py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {store.mailboxes.map(({ address: mailbox }) => (
            <span
              key={mailbox}
              className="truncate text-13 font-semibold text-foreground"
              title={mailbox}
            >
              {mailbox}
            </span>
          ))}
          <span className="text-11 text-subtle-foreground">{terms.mailbox}</span>
        </div>
      </TableCell>
      <TableCell className="py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-11 text-subtle-foreground">{terms.platformId}</span>
          <CopyValue value={store.platformId} />
        </div>
      </TableCell>
      <TableCell className="py-3">
        <StoreStatus store={store} />
      </TableCell>
      <TableCell className="py-3 text-right">
        <Button
          variant="text-link"
          size="text"
          aria-label={A11Y.edit(store.name)}
          onClick={() => onEdit(store)}
        >
          {STORE_TABLE.edit}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function StoreTable({
  stores,
  onCreate,
  onEdit,
}: {
  stores: readonly Store[];
  onCreate: () => void;
  onEdit: (store: Store) => void;
}) {
  return (
    <section aria-label={A11Y.storesRegion} className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <SectionLabel>{STORE_SECTION.label}</SectionLabel>
          <span className="text-12 whitespace-nowrap text-muted-foreground">
            {STORE_SECTION.count(stores.length)}
          </span>
          <span aria-hidden className="h-3 w-px bg-border" />
          <InfoTip label={STORE_SECTION.ruleLabel} tip={RULE_ROUTE} />
        </div>
        <Button variant="outline" size="sm" onClick={onCreate}>
          <Plus />
          {STORE_SECTION.create}
        </Button>
      </div>
      {stores.length === 0 ? (
        <Card>
          <EmptyState
            icon={StoreIcon}
            title={EMPTY_STORES.title}
            description={EMPTY_STORES.description}
            action={
              <Button variant="outline" onClick={onCreate}>
                <Plus />
                {STORE_SECTION.create}
              </Button>
            }
          />
        </Card>
      ) : (
        <Table>
          <colgroup>
            <col className="w-55.5" />
            <col className="w-40.5" />
            <col className="w-68" />
            <col />
            <col className="w-43" />
            <col className="w-15.5" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>{STORE_TABLE.columns.store}</TableHead>
              <TableHead>{STORE_TABLE.columns.sites}</TableHead>
              <TableHead>{STORE_TABLE.columns.mailboxes}</TableHead>
              <TableHead>{STORE_TABLE.columns.platformId}</TableHead>
              <TableHead>{STORE_TABLE.columns.status}</TableHead>
              <TableHead>
                <span className="sr-only">{A11Y.actionsColumn}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.map((store) => (
              <StoreRow key={store.id} store={store} onEdit={onEdit} />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
