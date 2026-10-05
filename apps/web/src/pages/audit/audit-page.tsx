import {
  auditConditionWords,
  auditScope,
  canViewFinance,
  type AuditLogFilter,
  type AuditRange,
} from '@forcome/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Banknote, Download, Lock, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { DisabledReason } from '@/components/disabled-reason';
import { LoadError } from '@/components/load-error';
import { PageHead } from '@/components/page-head';
import { SectionLabel } from '@/components/section-label';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { AUDIT_QUERY_KEY, auditLogOptionsQuery, auditLogQuery } from '@/lib/audit';
import { useCurrentMember } from '@/lib/current-member';
import { useFileExport } from '@/lib/export';
import { showSuccess } from '@/lib/notify';
import { pages } from '@/lib/pages';
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
  EXPORT,
  FILTERS,
  LIST_HEAD,
  NO_FINANCE,
  OWN_ONLY,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  PAGER,
  PERIODS,
  EMPTY,
  rangeHead,
} from './p27-copy';

/*
 * P27 审计日志（PRD P27「第一阶段」、10.2、K18 与补充小样、K5；参照图 design/spec/shots/phase1/P27_AuditLog.png）：
 * 所有角色从头像菜单进入，管理员另可从 P18 页头进入。页头（标题、说明、右上「导出」）→ 只看自己的角色的横幅（K18 ①）或
 * 没有财务权限的说明（K18 ②）→ 筛选行（条件在地址栏）→ 表头上方的时间、计数与图例 → 表格（点行展开两栏对照）→ 分页。
 * 查看范围与财务字段由后端按角色过滤（10.2），这里照接口返回的写法显示；加载前先按角色算出查看范围，免得横幅闪一下。
 */

const EXPORT_TOAST = 'audit-export';

/** 导出（K5）：生成中按钮转圈并写「正在生成，约 3 秒」；完成后浏览器直接下载，浮层「已导出 文件名 · 已记入审计日志」；失败按 G5 */
function useAuditExport(filter: AuditLogFilter) {
  const queryClient = useQueryClient();
  return useFileExport({
    id: EXPORT_TOAST,
    action: EXPORT.failedAction,
    download: () => api.exportAuditLog(filter),
    done: async (file) => {
      showSuccess({ title: EXPORT.done(file.fileName) });
      // 导出本身新写了一条审计
      await queryClient.invalidateQueries({ queryKey: AUDIT_QUERY_KEY });
    },
  });
}

/** 列表为空时「当前筛选：…」里的各项：时间总写（自定义写起止），其余照 contracts 的写法；只看自己的不写操作人 */
function filterParts(
  search: AuditSearch,
  range: AuditRange | null,
  today: string | null,
  actorName: string | undefined,
): string[] {
  const period = search.period ?? 'today';
  const time = period === 'custom' && range && today ? rangeHead(range, today) : PERIODS[period];
  return [time, ...auditConditionWords({ ...search, actorName })];
}

export function AuditPage() {
  const member = useCurrentMember();
  const search = auditSearchSchema.parse(useSearch({ strict: false }));
  const navigate = useNavigate();
  const log = useQuery({
    ...auditLogQuery(auditQueryOf(search)),
    placeholderData: keepPreviousData,
  });
  const data = log.data;
  const own = (data?.scope ?? auditScope(member.roles)) === 'own';
  const finance = data?.financeVisible ?? canViewFinance(member.roles);
  const options = useQuery({ ...auditLogOptionsQuery, enabled: !own });
  const [expanded, setExpanded] = useState<string | null>(null);
  const exporter = useAuditExport(auditFilterOf(search));

  const go = (next: AuditSearch) => void navigate({ to: pages.audit.path, search: next });
  const actors = options.data?.actors ?? [];
  const clearable = !isDefaultSearch(search);
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
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
                <SectionLabel>{data ? rangeHead(data.range, data.today) : ''}</SectionLabel>
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
              withDate={(search.period ?? 'today') !== 'today'}
              today={data?.today ?? ''}
              expandedId={expanded}
              onExpandedChange={setExpanded}
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
              <DisabledReason reason={page <= 1 ? PAGER.first : null}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => go({ ...search, page: page - 1 > 1 ? page - 1 : undefined })}
                >
                  {PAGER.prev}
                </Button>
              </DisabledReason>
              <span className="text-12 text-ink-2 tabular-nums">
                {PAGER.position(page, pageCount)}
              </span>
              <DisabledReason reason={page >= pageCount ? PAGER.last : null}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => go({ ...search, page: page + 1 })}
                >
                  {PAGER.next}
                </Button>
              </DisabledReason>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
