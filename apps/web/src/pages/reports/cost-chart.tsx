import {
  costBarsShown,
  formatMoney,
  responsibilityLabels,
  UNREGISTERED_RESPONSIBILITY,
  type ReportCost,
  type Responsibility,
} from '@forcome/contracts';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ChartHead, ChartTip, DetailLink, LockTag } from './chart-head';
import { A11Y, COST } from './p17-copy';

/*
 * 「售后成本按责任类型」卡（原型 p17_p1_cost()、build_approval_kb_reports.hbars()、K19 补充小样⑥⑦，PRD P17「第一阶段」v2.35）：
 * 卡头标题旁带锁的「本月 · 不随时间筛选」，副标题「产品成本 + 运费 + 额外赔偿 + 其他」，右上「查看明细 ›」；卡头总额（20 / 700）即
 * 售后成本，旁注单数；横向条（名称列 96、条高 12、行距 14、金额列 64 右对齐 12 / 600，主色条右端 4 圆角），按金额从大到小，
 * 金额为 0 的不出条，「未登记责任」排在最后。悬停或聚焦：整行浅主色底（6 圆角，名称转深）与条下方的深色浮层
 * 「产品质量问题 · $118.89 / 本月登记台账，不含待确认 / 点击查看明细 → P13 登记台账（已按责任筛选）」；点条下钻到 P13（本月 + 该责任
 * + 店铺），「查看明细」不带责任；未登记责任不可点（P13 没有这项责任筛选），悬停没有下钻那一行。本月没有时卡头 $0.00 · 0 单与一行说明。
 * 条用 HTML 自绘（原型的 hbars() 就是一列带宽度的块）：整行悬停、名称与金额列对齐、浮层位置都照原型，不经 Recharts。
 */

/** 下钻（没有台账页权限时为空）：点条带该责任，「查看明细」不带 */
export interface CostDrill {
  readonly bar: (responsibility: Responsibility) => void;
  readonly detail: () => void;
}

interface Row {
  readonly key: string;
  readonly name: string;
  readonly responsibility: Responsibility | null;
  readonly amount: string;
  readonly count: number;
  /** 条长：占最大一条的百分比 */
  readonly pct: number;
}

function rowsOf(cost: ReportCost): Row[] {
  const shown = costBarsShown(cost.bars);
  const max = Math.max(0, ...shown.map((bar) => Number(bar.totalUsd)));
  return shown.map((bar) => ({
    key: bar.responsibility ?? 'unregistered',
    name: bar.responsibility
      ? responsibilityLabels[bar.responsibility]
      : UNREGISTERED_RESPONSIBILITY,
    responsibility: bar.responsibility,
    amount: formatMoney(bar.totalUsd, 'USD'),
    count: bar.count,
    pct: max > 0 ? (Number(bar.totalUsd) / max) * 100 : 0,
  }));
}

function CostRow({
  row,
  active,
  drill,
  onActive,
}: {
  row: Row;
  active: boolean;
  drill: CostDrill | null;
  onActive: (key: string | null) => void;
}) {
  const responsibility = row.responsibility;
  const drillable = drill !== null && responsibility !== null;
  const tip = active && (
    // 浮在条下方，左端随条长（原型 left: min(pct × 0.5, 30)%、top: 条高 + 8）
    <div
      className="absolute top-5 z-10"
      style={{ left: `${Math.min(row.pct * 0.5, 30)}%` }}
      data-testid="cost-tip"
    >
      <ChartTip
        title={COST.tipTitle(row.name, row.amount)}
        lines={[responsibility ? COST.tipSource : COST.tipUnregistered(row.count)]}
        drill={drillable ? COST.tipDrill : null}
      />
    </div>
  );
  const content = (
    <>
      <div
        className={cn(
          'w-24 shrink-0 text-left text-12 whitespace-nowrap',
          active ? 'text-foreground' : 'text-ink-2',
        )}
      >
        {row.name}
      </div>
      <div className="relative h-3 flex-1">
        <div
          // 右端 4 圆角照原型 hbars() 字面（同每日工单量柱顶的 4，设计规范板没有这一档）
          className="absolute inset-y-0 left-0 rounded-r-[4px] bg-primary"
          style={{ width: `${row.pct}%` }}
        />
        {tip}
      </div>
      <div className="w-16 shrink-0 text-right text-12 font-semibold whitespace-nowrap text-foreground tabular-nums">
        {row.amount}
      </div>
    </>
  );
  const className = cn(
    '-mx-1.5 -my-0.75 flex w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-sm px-1.5 py-0.75 outline-none',
    active && 'bg-primary-soft',
  );
  const hover = {
    onMouseEnter: () => onActive(row.key),
    onMouseLeave: () => onActive(null),
    onFocus: () => onActive(row.key),
    onBlur: () => onActive(null),
  };
  return drillable ? (
    <button
      type="button"
      aria-label={A11Y.costDrill(row.name)}
      className={cn(className, 'cursor-pointer focus-visible:ring-2 focus-visible:ring-ring')}
      data-testid="cost-bar"
      onClick={() => drill.bar(responsibility)}
      {...hover}
    >
      {content}
    </button>
  ) : (
    <div className={className} data-testid="cost-bar" {...hover}>
      {content}
    </div>
  );
}

export function CostChart({ cost, drill }: { cost: ReportCost; drill: CostDrill | null }) {
  const [active, setActive] = useState<string | null>(null);
  const rows = rowsOf(cost);
  const clickable = drill !== null && rows.some((row) => row.responsibility !== null);
  return (
    <Card className="min-w-0 gap-3 px-4.5 py-3.5" data-testid="cost-chart">
      <ChartHead
        title={COST.title}
        sub={COST.sub}
        tag={<LockTag>{COST.tag}</LockTag>}
        action={drill && <DetailLink label={COST.detail} onClick={drill.detail} />}
      />
      <div className="flex items-baseline gap-2">
        <div className="text-20 font-bold text-foreground tabular-nums" data-testid="cost-total">
          {formatMoney(cost.totalUsd, 'USD')}
        </div>
        <div className="text-12 text-muted-foreground">{COST.totalNote(cost.count, clickable)}</div>
      </div>
      {rows.length === 0 ? (
        <div className="text-12 text-muted-foreground">{COST.empty}</div>
      ) : (
        <div role="list" aria-label={A11Y.costChart} className="flex flex-col gap-3.5">
          {rows.map((row) => (
            <div role="listitem" key={row.key}>
              <CostRow row={row} active={active === row.key} drill={drill} onActive={setActive} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
