import { businessDate } from '@forcome/calendar';
import {
  can,
  isEmptyTicketReport,
  reportCostDrillQuery,
  reportDrillQuery,
  reportRange,
  ticketDrillOf,
  type ReportDrillTarget,
  type ReportQuery,
  type Responsibility,
  type TicketReport,
} from '@forcome/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ChartColumn, Download, Funnel, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { LoadError } from '@/components/load-error';
import { PageHead } from '@/components/page-head';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { storeOptionsQuery } from '@/lib/channel';
import { useCurrentMember } from '@/lib/current-member';
import { useFileExport } from '@/lib/export';
import { showSuccess } from '@/lib/notify';
import { pages } from '@/lib/pages';
import { costReportQuery, ticketReportQuery } from '@/lib/reports';
import { useServerNow } from '@/lib/tickets';
import { drillChipWords } from '@/pages/tickets/p04-words';
import { CostChart, type CostDrill } from './cost-chart';
import { ChartSkeleton, DailyChart, type DailyDrill } from './daily-chart';
import { DAILY, EMPTY, EXPORT, FILTERS, KPI, NOTES, PAGE_TITLE, SOURCES } from './p17-copy';
import {
  emptyScopeWords,
  firstResponseDelta,
  firstResponseWords,
  periodWords,
  rateWords,
  slaDelta,
  slaSubWords,
  updatedWords,
  volumeDelta,
} from './p17-words';
import { KpiRow, KpiSkeleton, type Kpi } from './report-kpis';
import { ReportFilterBar } from './report-filters';
import {
  clearedSearch,
  isDefaultSearch,
  reportQueryOf,
  reportsSearchSchema,
  type ReportsSearch,
} from './reports-search';

/*
 * P17 报表（第一阶段，PRD P17「指标口径」「第一阶段」v2.34、K19、K3、K4；参照图 design/spec/shots/phase1/P17_Reports.png）：
 * 页头（数据来源 · 更新于，其下两条注；右侧「导出」）→ 筛选行（条件写在地址栏）→ 三张指标 → 「每日工单量」与右侧「售后成本按责任类型」。
 * 售后成本卡（待办 25，PRD P17「第一阶段」v2.35）只给有财务权限的角色（客服主管、售后负责人）：本月、随店铺不随时间与站点，另走一个查询，
 * 加载与失败照 K3 单独处理，工单部分无数据（K4）时照常显示；没有财务权限的（管理员、知识库负责人）每日工单量占满整行（K19 管理员小图）。
 * 点条或「查看明细」下钻到 P13（reportCostDrillQuery：本月 + 店铺，点条另带责任）。导出（K5）按地址栏的条件，服务端同步生成后直接下载。
 * 点指标、柱、图例或「查看明细」下钻到 P04（条件按 contracts 的 reportDrillQuery，与指标同口径）；没有「查看工单」的（管理员）不可点。
 * 加载超过 300ms 显示骨架、筛选后写「正在加载 · 更新于 …」，超过 10 秒转加载失败（K3）；无数据（K4）三张指标「—」，
 * 每日工单量的位置换成空状态（「调整筛选」点开自定义日历）。报表挂在工单这一组查询下，工单变化时在后台重新拉取（T+0）。
 */

/** 超过这么久没返回显示骨架、转加载失败（K3） */
const SKELETON_AFTER_MS = 300;
const FAIL_AFTER_MS = 10_000;
/** 导出失败浮层的 id（同一件事不叠浮层） */
const EXPORT_TOAST = 'report-export';
/** 每日工单量与右侧售后成本卡（原型 p17_p1()：1.25fr / 1fr，间距 14，顶端对齐） */
const WITH_COST_GRID = 'grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start gap-3.5';

/** 正在为当前条件取数时，过了多久（换了条件或重试从 0 算起）：超过 300ms 显示骨架，超过 10 秒转加载失败 */
function useWaiting(waiting: boolean, key: string): { slow: boolean; failed: boolean } {
  const [elapsed, setElapsed] = useState({ key, ms: 0 });
  useEffect(() => {
    if (!waiting) return;
    const timers = [SKELETON_AFTER_MS, FAIL_AFTER_MS].map((ms) =>
      setTimeout(() => setElapsed({ key, ms }), ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [waiting, key]);
  const ms = waiting && elapsed.key === key ? elapsed.ms : 0;
  return { slow: ms >= SKELETON_AFTER_MS, failed: ms >= FAIL_AFTER_MS };
}

/** 导出（K5）：按当前条件取文件，完成浮层「已导出 文件名 · 已记入审计日志」，失败按 G5「导出失败：原因」+「立即重试」 */
function useReportExport(query: ReportQuery) {
  return useFileExport({
    id: EXPORT_TOAST,
    action: EXPORT.failedAction,
    download: () => api.exportReport(query),
    done: (file) =>
      showSuccess({ title: EXPORT.done(file.fileName), description: EXPORT.doneDescription }),
  });
}

/** 页头的说明：数据来源 · 更新于，其下两条注（原型 p17_p1_notes()） */
function Description({ report, now }: { report: TicketReport | null; now: Date }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-13 whitespace-nowrap text-muted-foreground" data-testid="report-sources">
        {report ? `${SOURCES} · ${updatedWords(report.updatedAt, now)}` : SOURCES}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex items-center gap-1.25 text-12 whitespace-nowrap text-muted-foreground">
          <Info className="size-3.25 text-subtle-foreground" />
          {NOTES.replies}
        </span>
        {report?.shopifyBackfillDays && (
          <span
            className="inline-flex items-center gap-1.25 text-12 whitespace-nowrap text-warning"
            data-testid="report-backfill-note"
          >
            <TriangleAlert className="size-3.25" strokeWidth={2} />
            {NOTES.backfill(report.shopifyBackfillDays)}
          </span>
        )}
      </div>
    </div>
  );
}

export function ReportsPage() {
  const member = useCurrentMember();
  const navigate = useNavigate();
  const search = reportsSearchSchema.parse(useSearch({ strict: false }));
  const query = reportQueryOf(search);
  const report = useQuery({ ...ticketReportQuery(query), placeholderData: keepPreviousData });
  const stores = useQuery(storeOptionsQuery);
  const [attempt, setAttempt] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const data = report.data ?? null;
  const now = useServerNow(data?.now ?? null);
  const today = businessDate(now);
  // 当前条件还没有自己的数据（第一次打开，或换了条件、正显示上一份）
  const waiting = report.isPending || report.isPlaceholderData;
  const { slow, failed } = useWaiting(waiting, `${JSON.stringify(query)}#${attempt}`);
  // 没有工单页权限（管理员）：指标、柱与图例都不可点，没有「查看明细」（AC-P1-10）
  const drillable = can(member.roles, 'ticket.view');
  // 售后成本卡只给有财务权限的角色：没有时每日工单量占满整行、不取成本
  const withCost = can(member.roles, 'finance.view');
  const costQuery = { store: query.store };
  const cost = useQuery({
    ...costReportQuery(costQuery),
    placeholderData: keepPreviousData,
    enabled: withCost,
  });
  const [costAttempt, setCostAttempt] = useState(0);
  // 成本卡的条件只有店铺：换了店铺、新的还没返回时同样 300ms 后出骨架、10 秒转加载失败（K3）
  const costWaiting = withCost && (cost.isPending || cost.isPlaceholderData);
  const costTimer = useWaiting(costWaiting, `${query.store ?? ''}#${costAttempt}`);
  // 下钻到 P13 要有台账页权限（有财务权限的角色都有）
  const costDrillable = can(member.roles, 'aftersales.view');
  const exporter = useReportExport(query);
  const storeOptions = (stores.data ?? []).map((store) => ({ value: store.id, label: store.name }));
  const clearable = !isDefaultSearch(search);

  const go = (next: ReportsSearch) => void navigate({ to: pages.reports.path, search: next });
  const clear = () => go(clearedSearch);
  const queryClient = useQueryClient();
  // 重试：先中止还没返回的那次（这一组条件还没有数据时，TanStack 的 refetch 会沿用它），再重新取
  const retry = async () => {
    setAttempt((n) => n + 1);
    await queryClient.cancelQueries({ queryKey: ticketReportQuery(query).queryKey, exact: true });
    await report.refetch();
  };
  const retryCost = async () => {
    setCostAttempt((n) => n + 1);
    await queryClient.cancelQueries({
      queryKey: costReportQuery(costQuery).queryKey,
      exact: true,
    });
    await cost.refetch();
  };

  // 下钻到 P13：期间按卡上这一份数据的本月、店铺按地址栏；换了店铺、新的还没返回时不可下钻
  const costData = cost.data?.cost ?? null;
  const drillToLedger = (responsibility?: Responsibility) => {
    if (!costData || costWaiting) return;
    void navigate({
      to: pages.aftersalesLedger.path,
      search: reportCostDrillQuery(costData.range, { store: query.store, responsibility }),
    });
  };
  const costDrill: CostDrill | null =
    costDrillable && costData && !costWaiting
      ? { bar: (responsibility) => drillToLedger(responsibility), detail: () => drillToLedger() }
      : null;
  // 售后成本卡（右侧）：加载失败、骨架、上一份或这一份数据
  const costCard =
    cost.isError || costTimer.failed ? (
      <Card className="px-6 py-5" data-testid="cost-error">
        <LoadError onRetry={() => void retryCost()} />
      </Card>
    ) : costWaiting && costTimer.slow ? (
      <ChartSkeleton />
    ) : costData ? (
      <CostChart cost={costData} drill={costDrill} />
    ) : null;

  // 下钻的期间、店铺、站点都按画面上这一份数据的条件；换了条件、新的还没返回时不可下钻（不拼出新旧混搭的条件）
  const drillTo = (target: ReportDrillTarget) => {
    if (!data || waiting) return;
    void navigate({
      to: pages.tickets.path,
      search: reportDrillQuery(
        target,
        { range: data.range, store: query.store, site: query.site },
        today,
      ),
    });
  };
  const dailyDrill: DailyDrill | null =
    drillable && data && !waiting
      ? {
          day: (date) => drillTo({ from: 'daily-bar', date }),
          channel: (channel) => drillTo({ from: 'daily-legend', channel }),
          detail: () => drillTo({ from: 'daily-detail' }),
          condition: (date) => {
            const drill = ticketDrillOf(
              reportDrillQuery({ from: 'daily-bar', date }, { range: data.range }, today),
            );
            return drill ? drillChipWords(drill, today) : '';
          },
        }
      : null;

  const canDrill = drillable && !waiting;
  // 换了条件、还没超过 300ms 时照旧显示上一份；超过了显示骨架
  const shown = waiting && slow ? null : data;
  const empty = shown !== null && isEmptyTicketReport(shown);
  const period = shown ? periodWords(shown.range, today) : '';

  const kpis = (r: TicketReport): Kpi[] => {
    if (empty) {
      return [KPI.volume, KPI.firstResponse, KPI.sla].map((label) => ({
        label,
        value: KPI.none,
        delta: null,
        sub: KPI.noData,
        onDrill: null,
      }));
    }
    const firstResponse = firstResponseWords(r.current.firstResponseMs);
    const rate = rateWords(r.current.sla);
    return [
      {
        label: KPI.volume,
        value: String(r.current.volume),
        delta: volumeDelta(r.current.volume, r.prior.volume, r.range),
        sub: KPI.volumeSub(period),
        onDrill: canDrill ? () => drillTo({ from: 'metric-volume' }) : null,
      },
      {
        label: KPI.firstResponse,
        value: firstResponse,
        delta: firstResponseDelta(r.current.firstResponseMs, r.prior.firstResponseMs, r.range),
        sub: KPI.firstResponseSub,
        onDrill:
          canDrill && r.current.firstResponseMs !== null
            ? () => drillTo({ from: 'metric-first-response' })
            : null,
      },
      {
        label: KPI.sla,
        value: rate,
        delta: slaDelta(r.current.sla, r.prior.sla, r.range),
        sub: slaSubWords(r.current.sla, r.unassignedMissed),
        onDrill:
          canDrill && r.current.sla.counted > 0 ? () => drillTo({ from: 'metric-sla' }) : null,
      },
    ];
  };

  const storeName = storeOptions.find((option) => option.value === query.store)?.label ?? null;
  const daily = shown ? (
    empty ? (
      <Card className="px-6 py-5" data-testid="report-empty">
        <EmptyState
          compact
          icon={ChartColumn}
          title={EMPTY.title}
          description={EMPTY.description(period, emptyScopeWords(storeName, query.site ?? null))}
          action={
            <div className="flex items-center gap-2">
              <Button onClick={() => setPickerOpen(true)}>
                <Funnel />
                {EMPTY.adjust}
              </Button>
              {clearable && (
                <Button variant="outline" onClick={clear}>
                  <X />
                  {EMPTY.clear}
                </Button>
              )}
            </div>
          }
        />
      </Card>
    ) : (
      <DailyChart
        days={shown.daily}
        sub={DAILY.sub(period, dailyDrill !== null)}
        drill={dailyDrill}
        height={300}
        today={today}
      />
    )
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title={PAGE_TITLE}
        description={<Description report={data} now={now} />}
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
        <ReportFilterBar
          search={search}
          range={data ? reportRange(query, today) : null}
          today={today}
          stores={storeOptions}
          loading={
            slow && !failed
              ? data
                ? `${FILTERS.loading} · ${updatedWords(data.updatedAt, now)}`
                : FILTERS.loading
              : null
          }
          clearable={clearable}
          pickerOpen={pickerOpen}
          onPickerOpenChange={setPickerOpen}
          onChange={go}
          onClear={clear}
        />
        {report.isError || failed ? (
          <LoadError onRetry={() => void retry()} />
        ) : waiting && slow ? (
          <>
            <KpiSkeleton />
            <div className={withCost ? WITH_COST_GRID : 'grid grid-cols-1 gap-3.5'}>
              <ChartSkeleton />
              {withCost && <ChartSkeleton />}
            </div>
          </>
        ) : shown ? (
          <>
            <KpiRow kpis={kpis(shown)} />
            {withCost ? (
              <div className={WITH_COST_GRID}>
                {daily}
                {costCard}
              </div>
            ) : (
              daily
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
