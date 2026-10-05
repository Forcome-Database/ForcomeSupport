import {
  auditObjectTypeLabels,
  auditScope,
  canViewFinance,
  type AuditLogFilter,
  type AuditRange,
} from '@forcome/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Banknote, Download, Lock, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { LoadError } from '@/components/load-error';
import { PageHead } from '@/components/page-head';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { AUDIT_QUERY_KEY, auditLogOptionsQuery, auditLogQuery } from '@/lib/audit';
import { useCurrentMember } from '@/lib/current-member';
import { saveFile } from '@/lib/download';
import { dismissToast, showError, showSuccess } from '@/lib/notify';
import { pages } from '@/lib/pages';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { AuditFilterBar } from './audit-filters';
import {
  auditFilterOf,
  auditQueryOf,
  auditSearchSchema,
  isDefaultSearch,
  type AuditSearch,
} from './audit-search';
import { AuditTable } from './audit-table';
import {
  EMPTY,
  EXPORT,
  FILTERS,
  LIST_HEAD,
  NO_FINANCE,
  OWN_ONLY,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  PAGER,
  PERIODS,
  rangeHead,
} from './p27-copy';

/*
 * P27 审计日志（PRD P27「第一阶段」、10.2、K18 与补充小样、K5；参照图 design/spec/shots/phase1/P27_AuditLog.png）：
 * 所有角色从头像菜单进入，管理员另可从 P18 页头进入。页头（标题、说明、右上「导出」）→ 只看自己的角色的横幅（K18 ①）或
 * 没有财务权限的说明（K18 ②）→ 筛选行（条件在地址栏）→ 表头上方的时间、计数与图例 → 表格（点行展开两栏对照）→ 分页。
 * 查看范围与财务字段由后端按角色过滤（10.2），这里只照接口返回的写法显示。
 */

const EXPORT_TOAST = 'audit-export';

/** 导出（K5）：生成中按钮转圈并写「正在生成，约 3 秒」；完成后浏览器直接下载，浮层「已导出 文件名 · 已记入审计日志」；失败按 G5 */
function useAuditExport(filter: AuditLogFilter) {
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: api.exportAuditLog });

  async function exportOnce(): Promise<void> {
    const file = await mutation.mutateAsync(filter);
    dismissToast(EXPORT_TOAST);
    saveFile(file.blob, file.fileName);
    showSuccess({ title: EXPORT.done(file.fileName) });
    // 导出本身新写了一条审计
    await queryClient.invalidateQueries({ queryKey: AUDIT_QUERY_KEY });
  }

  return {
    exporting: mutation.isPending,
    run: async () => {
      try {
        await exportOnce();
      } catch (error) {
        if (endSessionIfUnauthenticated(queryClient, error)) return;
        showError({ id: EXPORT_TOAST, action: EXPORT.failedAction, error, retry: exportOnce });
      }
    },
  };
}

/** 不可用的分页按钮：禁用的样子，悬停写原因（禁用的按钮收不到悬停，外面包一层） */
function PagerButton({
  label,
  disabledReason,
  onClick,
}: {
  label: string;
  disabledReason: string | null;
  onClick: () => void;
}) {
  if (disabledReason === null) {
    return (
      <Button variant="outline" size="sm" onClick={onClick}>
        {label}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Button variant="outline" size="sm" disabled>
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

/** 列表为空时「当前筛选：…」里的各项（时间总写；只看自己的不写操作人） */
function filterParts(
  search: AuditSearch,
  range: AuditRange | null,
  today: string | null,
  actorName: string | undefined,
): string[] {
  const period = search.period ?? 'today';
  const parts = [period === 'custom' && range && today ? rangeHead(range, today) : PERIODS[period]];
  if (actorName) parts.push(EMPTY.actor(actorName));
  if (search.type) parts.push(auditObjectTypeLabels[search.type]);
  if (search.action) parts.push(search.action);
  if (search.q) parts.push(EMPTY.search(search.q));
  return parts;
}

export function AuditPage() {
  const member = useCurrentMember();
  const own = auditScope(member.roles) !== 'all';
  const finance = canViewFinance(member.roles);
  const search = auditSearchSchema.parse(useSearch({ strict: false }));
  const navigate = useNavigate();
  const query = auditQueryOf(search);
  const log = useQuery({ ...auditLogQuery(query), placeholderData: keepPreviousData });
  const options = useQuery({ ...auditLogOptionsQuery, enabled: !own });
  const [expanded, setExpanded] = useState<string | null>(null);
  const exporter = useAuditExport(auditFilterOf(search));

  const go = (next: AuditSearch) => void navigate({ to: pages.audit.path, search: next });
  const data = log.data;
  const actors = (options.data?.actors ?? []).map((actor) => ({ ...actor }));
  const clearable = !isDefaultSearch(search);
  const pages_ = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const page = data?.page ?? 1;
  const actorName = own ? undefined : actors.find((actor) => actor.value === search.actor)?.label;

  let notice: ReactNode = null;
  if (own) {
    notice = <Alert tone="info" title={OWN_ONLY.title} description={OWN_ONLY.description} />;
  } else if (!finance) {
    notice = (
      <div className="flex items-center gap-1.5 text-12 text-muted-foreground">
        <Lock className="size-3.5 text-subtle-foreground" />
        {NO_FINANCE}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        actions={
          <Button
            variant="outline"
            loading={exporter.exporting}
            onClick={() => void exporter.run()}
          >
            {!exporter.exporting && <Download />}
            {exporter.exporting ? EXPORT.busy : EXPORT.button}
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pt-3.5 pb-3.5">
        {notice}
        <AuditFilterBar
          search={search}
          range={data?.range ?? null}
          actors={actors}
          lockedActor={own ? member.name : null}
          onChange={(next) => {
            setExpanded(null);
            go(next);
          }}
        />
        {log.isError ? (
          <LoadError onRetry={() => void log.refetch()} />
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-12 font-semibold tracking-[0.03em] text-muted-foreground">
                  {data ? rangeHead(data.range, data.today) : ''}
                </h2>
                {data && (
                  <span className="text-12 text-muted-foreground">
                    {LIST_HEAD.count(data.total, data.denied)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-12 whitespace-nowrap text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Badge tone="danger">
                    <Lock className="size-3" strokeWidth={2} />
                    {LIST_HEAD.denied}
                  </Badge>
                  {LIST_HEAD.deniedNote}
                </span>
                <span aria-hidden className="h-3 w-px bg-border" />
                <span className="flex items-center gap-1.5">
                  <Banknote className="size-3.25 text-subtle-foreground" />
                  {LIST_HEAD.finance}
                </span>
              </div>
            </div>
            <AuditTable
              entries={data?.entries ?? null}
              member={member}
              oneDay={data ? data.range.from === data.range.to : true}
              today={data?.today ?? ''}
              expandedId={expanded}
              onToggle={(id) => setExpanded((current) => (current === id ? null : id))}
              empty={{
                description: EMPTY.description(
                  filterParts(search, data?.range ?? null, data?.today ?? null, actorName),
                  clearable,
                ),
                action: clearable ? (
                  <Button variant="outline" onClick={() => go({})}>
                    <X />
                    {FILTERS.clear}
                  </Button>
                ) : undefined,
              }}
            />
          </div>
        )}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-12 text-muted-foreground">{PAGER.summary(data.total)}</span>
            <div className="flex items-center gap-2">
              <PagerButton
                label={PAGER.prev}
                disabledReason={page <= 1 ? PAGER.first : null}
                onClick={() => go({ ...search, page: page - 1 > 1 ? page - 1 : undefined })}
              />
              <span className="text-12 text-ink-2 tabular-nums">
                {PAGER.position(page, pages_)}
              </span>
              <PagerButton
                label={PAGER.next}
                disabledReason={page >= pages_ ? PAGER.last : null}
                onClick={() => go({ ...search, page: page + 1 })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
