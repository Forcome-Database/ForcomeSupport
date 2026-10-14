import {
  can,
  canViewFinance,
  ledgerColumnLabels,
  PENDING_OWNER,
  type LedgerItem,
  type LedgerQuery,
} from '@forcome/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Download, Eye, ListFilter, Plus, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { PageHead } from '@/components/page-head';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LoadError } from '@/components/load-error';
import { AFTERSALES_QUERY_KEY, ledgerOptionsQuery, ledgerQuery } from '@/lib/aftersales';
import { api, ApiRequestError } from '@/lib/api';
import { storeOptionsQuery } from '@/lib/channel';
import { useCurrentMember } from '@/lib/current-member';
import { useFileExport } from '@/lib/export';
import { dismissToast, showError, showSuccess } from '@/lib/notify';
import { pages } from '@/lib/pages';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { CancelDialog, CompletionBadge, MoreMenu, useCompleteAction } from './ledger-actions';
import { ReassignDialog } from './reassign-dialog';
import type { CellContext, InlineBackfill } from './ledger-cells';
import {
  hiddenColumns,
  hideableColumns,
  useColumnVisibility,
  type ColumnVisibility,
} from './ledger-columns';
import { filterSummary, LedgerFilterBar } from './ledger-filters';
import {
  isDefaultSearch,
  ledgerQueryOf,
  ledgerSearchSchema,
  type LedgerSearch,
} from './ledger-search';
import { LedgerTable } from './ledger-table';
import {
  BACKFILL_RESULT,
  COLUMN_SETTINGS,
  EMPTY,
  EXPORT,
  FILTERS,
  NEW_REGISTRATION,
  NOTE,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  STALE,
} from './p13-copy';
import { RegistrationDrawer, type DrawerTarget } from './registration-drawer';

/*
 * P13 登记台账（第一阶段，PRD P13「第一阶段」、S11、S13–S15 与补充小样；参照图 design/spec/shots/phase1/P13_AfterSalesLog.png 与 _agent）。
 * 页头：标题、说明，右上当月登记完整率（点它筛出缺字段的已完成单）· 列设置 · 导出 Excel · 新建登记。
 * 筛选行（费用发生日默认本月、店铺、处理方式、责任、状态、负责人，条件在地址栏）与「已隐藏 N 列」，表格（ledger-table.tsx：17 列 +
 * 行尾「更多」，首列与合计行固定），表下说明。坐席只读：没有「新建登记」、七个金额列、合计行与「更多」，完整率与导出照常
 * （导出同样不含金额列）。行尾「改派负责人」随 23。
 */

const BACKFILL_TOAST = 'aftersales-backfill';
const BACKFILL_STALE_TOAST = 'aftersales-backfill-stale';
const EXPORT_TOAST = 'aftersales-export';

/** 行内补登快递单号（S15 ③）：保存后浮层「已补登 · 已记入审计日志」，「缺 N 项」随之减少；失败按 G5 */
function useInlineBackfill(): InlineBackfill {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const mutation = useMutation({
    mutationFn: ({ item, tracking }: { item: LedgerItem; tracking: string }) =>
      api.updateAftersales(item.number, {
        version: item.version,
        changes: { trackingNumber: tracking },
      }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: AFTERSALES_QUERY_KEY });

  /** 补登一次：成功收起编辑并提示；失败时抛出（重试再失败时浮层留着，同 notify 的约定） */
  async function saveOnce(item: LedgerItem, tracking: string): Promise<void> {
    const saved = await mutation.mutateAsync({ item, tracking });
    dismissToast(BACKFILL_TOAST);
    dismissToast(BACKFILL_STALE_TOAST);
    setEditing(null);
    showSuccess({
      title: BACKFILL_RESULT.title,
      description: BACKFILL_RESULT.inline(saved.number, saved.trackingNumber ?? tracking),
    });
    await refresh();
  }

  /**
   * 这一格刚被别人改过或补过：409，或快递单号上有字段错误（行内只交快递单号，补登时它唯一会报的就是「只能补登缺失的字段」）。
   * 是的话收起编辑、刷新成最新
   */
  async function collapseIfStale(error: unknown): Promise<boolean> {
    const stale =
      error instanceof ApiRequestError &&
      (error.status === 409 || error.fields?.trackingNumber !== undefined);
    if (!stale) return false;
    setEditing(null);
    // 说明已刷新、不给重试（再试也只会冲突）；用另一个 id，重试时原来的失败浮层随之撤掉也不会误删它
    showError({
      id: BACKFILL_STALE_TOAST,
      action: BACKFILL_RESULT.failedAction,
      error,
      description: STALE,
    });
    await refresh();
    return true;
  }

  async function save(item: LedgerItem): Promise<void> {
    const tracking = draft.trim();
    try {
      await saveOnce(item, tracking);
    } catch (error) {
      if (endSessionIfUnauthenticated(queryClient, error)) return;
      if (await collapseIfStale(error)) return;
      showError({
        id: BACKFILL_TOAST,
        action: BACKFILL_RESULT.failedAction,
        error,
        // 重试时这一格刚被别人补过：收起编辑、另弹「已刷新为最新内容」，这条失败浮层随之撤掉
        retry: () =>
          saveOnce(item, tracking).catch(async (retryError: unknown) => {
            if (await collapseIfStale(retryError)) return;
            throw retryError;
          }),
      });
    }
  }

  return {
    editing,
    draft,
    saving: mutation.isPending,
    setDraft,
    start: (id) => {
      setEditing(id);
      setDraft('');
    },
    cancel: () => setEditing(null),
    save,
  };
}

/**
 * 导出 Excel（S11、K5 与 S13 补充小样）：生成中按钮写「导出中」并转圈；完成后浏览器直接下载，浮层「登记台账已导出」+
 * 「文件名 · N 单，浏览器已开始下载 · 已记入审计日志。」；失败按 G5「导出失败：原因」+「立即重试」
 */
function useLedgerExport(query: LedgerQuery) {
  return useFileExport({
    id: EXPORT_TOAST,
    action: EXPORT.failedAction,
    download: () => api.exportLedger(query),
    done: (file) =>
      showSuccess({
        title: EXPORT.doneTitle,
        description: EXPORT.doneDescription(file.fileName, file.rows),
      }),
  });
}

/** 右上「列设置」（S13 补充小样）：按表格顺序列出能隐藏的列，勾选即显示，底部「恢复默认」 */
function ColumnSettings({
  finance,
  visibility,
  open,
  onOpenChange,
  onToggle,
  onReset,
}: {
  finance: boolean;
  visibility: ColumnVisibility;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (column: ReturnType<typeof hideableColumns>[number], visible: boolean) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <ListFilter />
          {COLUMN_SETTINGS.button}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-50">
        {hideableColumns(finance).map((column) => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={visibility[column] !== false}
            onCheckedChange={(checked) => onToggle(column, checked)}
          >
            {ledgerColumnLabels[column]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReset}>
          <RefreshCw />
          {COLUMN_SETTINGS.reset}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LedgerPage() {
  const member = useCurrentMember();
  const finance = canViewFinance(member.roles);
  const canRegister = can(member.roles, 'aftersales.register');
  // 行尾「更多」：能设为已完成或取消的角色才有（坐席没有，原型 S13 坐席视角）
  const showMore =
    can(member.roles, 'aftersales.edit_open') ||
    can(member.roles, 'aftersales.cancel') ||
    can(member.roles, 'aftersales.reassign_owner');
  const search = ledgerSearchSchema.parse(useSearch({ strict: false }));
  const navigate = useNavigate();
  const query = ledgerQueryOf(search);
  const ledger = useQuery({ ...ledgerQuery(query), placeholderData: keepPreviousData });
  const stores = useQuery(storeOptionsQuery);
  const options = useQuery(ledgerOptionsQuery);
  const columns = useColumnVisibility(member.id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [opened, setOpened] = useState<DrawerTarget | null>(null);
  const [cancelling, setCancelling] = useState<LedgerItem | null>(null);
  const [reassigning, setReassigning] = useState<LedgerItem | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const backfill = useInlineBackfill();
  const complete = useCompleteAction();
  const exporter = useLedgerExport(query);
  const clearable = !isDefaultSearch(search, ledger.data?.defaultRange);
  const items = ledger.data?.items ?? null;
  // 列表为空时「清除筛选查看全部 N 张」：N 是清除后（默认的本月、其余不选）会列出的单数
  const fallback = useQuery({
    ...ledgerQuery({}),
    enabled: clearable && items !== null && items.length === 0,
  });

  const go = (next: LedgerSearch) =>
    void navigate({ to: pages.aftersalesLedger.path, search: next });
  // 地址栏带了售后单号（从 P27 点进来）时打开它的编辑登记抽屉；页面里点开的优先
  const drawer: DrawerTarget | null =
    opened ?? (search.open ? { mode: 'edit', number: search.open } : null);
  const closeDrawer = () => {
    setOpened(null);
    if (search.open) go({ ...search, open: undefined });
  };
  const storeOptions = (stores.data ?? []).map((store) => ({ value: store.id, label: store.name }));
  // 负责人：「全部」之后第一项「待分配」（钉钉离职进入改派队列的单，待办 23），其后是店铺范围内在职的售后负责人
  const ownerOptions = [
    { value: PENDING_OWNER, label: FILTERS.pendingOwner },
    ...(options.data?.owners ?? []).map((owner) => ({ value: owner.id, label: owner.name })),
  ];
  const month = Number((ledger.data?.completion.month ?? '').slice(5, 7));
  const hidden = hiddenColumns(columns.visibility, finance);
  const ctx: CellContext = {
    member,
    backfill,
    open: (number) => setOpened({ mode: 'edit', number }),
  };
  const empty = {
    description: EMPTY.description(
      filterSummary(search, ledger.data?.range ?? null, storeOptions, ownerOptions, month),
      clearable,
      fallback.data?.items.length ?? 0,
    ),
    action: clearable ? (
      <Button variant="outline" onClick={() => go({})}>
        <X />
        {FILTERS.clear}
      </Button>
    ) : undefined,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title={PAGE_TITLE}
        description={finance ? PAGE_DESCRIPTION.finance : PAGE_DESCRIPTION.readOnly}
        actions={
          <>
            {ledger.data && (
              <CompletionBadge
                completion={ledger.data.completion}
                onFilter={() => go({ missing: '1', store: search.store })}
              />
            )}
            <ColumnSettings
              finance={finance}
              visibility={columns.visibility}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              onToggle={columns.toggle}
              onReset={columns.reset}
            />
            <Button
              variant="outline"
              loading={exporter.exporting}
              onClick={() => void exporter.run()}
            >
              {!exporter.exporting && <Download />}
              {exporter.exporting ? EXPORT.busy : EXPORT.button}
            </Button>
            {canRegister && (
              <Button onClick={() => setOpened({ mode: 'create' })}>
                <Plus />
                {NEW_REGISTRATION}
              </Button>
            )}
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-6 pt-3.5 pb-3.5">
        <div className="flex flex-col gap-2">
          <LedgerFilterBar
            search={search}
            range={ledger.data?.range ?? null}
            defaultRange={ledger.data?.defaultRange}
            month={month}
            stores={storeOptions}
            owners={ownerOptions}
            clearable={clearable}
            onChange={go}
            onClear={() => go({})}
          />
          {hidden.length > 0 && (
            <div className="flex items-center gap-1.5 text-12 text-muted-foreground">
              <Eye className="size-3.5 text-subtle-foreground" />
              <span>
                {COLUMN_SETTINGS.hidden(
                  hidden.map((column) => ledgerColumnLabels[column]),
                  finance,
                )}
              </span>
              <Button variant="text-link" size="text" onClick={() => setSettingsOpen(true)}>
                {COLUMN_SETTINGS.show}
              </Button>
            </div>
          )}
        </div>
        {ledger.isError ? (
          <LoadError onRetry={() => void ledger.refetch()} />
        ) : (
          <LedgerTable
            items={items}
            totals={ledger.data?.totals}
            finance={finance}
            showMore={showMore}
            visibility={columns.visibility}
            ctx={ctx}
            selectedId={menuOpen ?? backfill.editing}
            more={(item) => (
              <MoreMenu
                item={item}
                member={member}
                onComplete={(target) => void complete(target)}
                onReassign={setReassigning}
                onCancel={setCancelling}
                onOpenChange={(open) => setMenuOpen(open ? item.id : null)}
              />
            )}
            empty={empty}
          />
        )}
        <p className="text-12 leading-[1.6] text-muted-foreground">
          {finance ? NOTE.finance : NOTE.readOnly}
        </p>
      </div>
      {drawer && <RegistrationDrawer registrar={member} target={drawer} onClose={closeDrawer} />}
      {cancelling && <CancelDialog item={cancelling} onClose={() => setCancelling(null)} />}
      {reassigning && <ReassignDialog item={reassigning} onClose={() => setReassigning(null)} />}
    </div>
  );
}
