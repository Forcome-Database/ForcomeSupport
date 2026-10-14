import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { A11Y } from './p17-copy';
import type { DeltaTone, DeltaWords } from './p17-words';

/*
 * P17 的指标卡（原型 ui.kpi()，K19）：12 次要色名称；24 / 700 数值（等宽数字）与 12 / 600 对比（中性、绿、红）；12 浅一档的副标题。
 * 内边距 12 / 16、行距 2，行高同原型（浏览器默认的 normal）。能下钻时整张卡是按钮（点进 P04，带与指标同口径的条件）；管理员（没有工单页权限）与无数据时不可点。
 * 骨架（K3）：名称、数值、副标题三条。
 */

const toneClass: Record<DeltaTone, string> = {
  muted: 'text-muted-foreground',
  success: 'text-success',
  danger: 'text-destructive',
};

export interface Kpi {
  readonly label: string;
  readonly value: string;
  readonly delta: DeltaWords | null;
  readonly sub: string;
  /** 点开下钻；为空时不可点 */
  readonly onDrill: (() => void) | null;
}

const cardClass = 'gap-0.5 px-4 py-3 leading-[normal]';

function KpiBody({ kpi }: { kpi: Kpi }) {
  return (
    <>
      <div className="text-12 text-muted-foreground">{kpi.label}</div>
      <div className="flex items-baseline gap-2">
        <div className="text-24 font-bold tracking-[-0.01em] text-foreground tabular-nums">
          {kpi.value}
        </div>
        {kpi.delta && (
          <div className={cn('text-12 font-semibold', toneClass[kpi.delta.tone])}>
            {kpi.delta.text}
          </div>
        )}
      </div>
      <div className="text-12 text-subtle-foreground">{kpi.sub}</div>
    </>
  );
}

export function KpiRow({ kpis }: { kpis: readonly Kpi[] }) {
  return (
    <div className="grid grid-cols-3 gap-3" data-testid="report-kpis">
      {kpis.map((kpi) =>
        kpi.onDrill ? (
          <Card
            key={kpi.label}
            role="button"
            tabIndex={0}
            aria-label={A11Y.kpiDrill(kpi.label)}
            data-testid="report-kpi"
            className={cn(
              cardClass,
              'cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            onClick={kpi.onDrill}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                kpi.onDrill?.();
              }
            }}
          >
            <KpiBody kpi={kpi} />
          </Card>
        ) : (
          <Card key={kpi.label} data-testid="report-kpi" className={cardClass}>
            <KpiBody kpi={kpi} />
          </Card>
        ),
      )}
    </div>
  );
}

/** 指标骨架（K3：原型 card(skel 55% × 10、70% × 22、40% × 8)，内边距 12 / 14、行距 9） */
export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3" data-testid="report-kpis-loading">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="gap-2.25 px-3.5 py-3">
          <Skeleton className="h-2.5 w-[55%]" />
          <Skeleton className="h-5.5 w-[70%]" />
          <Skeleton className="h-2 w-[40%]" />
        </Card>
      ))}
    </div>
  );
}
