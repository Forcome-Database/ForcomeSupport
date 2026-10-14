import type { ReportChannelGroup, ReportDay } from '@forcome/contracts';
import { ChevronRight, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { A11Y, DAILY } from './p17-copy';

/*
 * 「每日工单量」卡（原型 p17_p1_daily()、build_approval_kb_reports.stacked_columns()、K19）：卡头 13 / 700 标题与 12 次要色副标题，
 * 右上「查看明细 ›」；图例（10 × 10、2 圆角的色块 + 12 深一档文字，项距 14）；按渠道堆叠的纵向柱（亚马逊在下、Shopify 与邮件在上，
 * 宽 28，两段之间 2px 白缝，顶端 4 圆角，柱顶 11 / 600 写当天合计；柱超过 14 根时不写合计，Q3），横向网格线（0 线深一档），
 * 纵轴刻度 11 浅色、横轴日期 11 次要色。悬停：整列浅主色底（6 圆角）与深色浮层「09-10 · 73 单 / 亚马逊 52 · Shopify 与邮件 21 /
 * 点击查看明细 → P04 工单（条件）」（原型 drill_tip()）。点柱、图例或「查看明细」下钻到 P04；没有工单页权限（管理员）时
 * 卡头写「没有工单页权限 · 不可下钻」、不可点、悬停没有下钻那一行（AC-P1-10）。
 * 图表用 Recharts（ADR 0007 的 shadcn Charts 即 Recharts；浮层与图例按原型自绘，没有套 shadcn 的 ChartTooltip），颜色只用令牌。
 */

const COLORS: Record<ReportChannelGroup, string> = {
  amazon: 'var(--channel-amazon)',
  shopify_email: 'var(--channel-shopify)',
};
const LABELS: Record<ReportChannelGroup, string> = {
  amazon: DAILY.amazon,
  shopify_email: DAILY.shopifyEmail,
};
/** 柱超过这么多根时柱顶不写合计（Q3） */
const MAX_LABELED_BARS = 14;
/** 柱宽与两段之间的白缝（原型 28、2） */
const BAR_WIDTH = 28;
const SEGMENT_GAP = 2;
/** 绘图区上方（最上一格的刻度字露出线上的一半）与横轴（日期）的高：卡片里的绘图区正好是 height */
const PLOT_TOP = 6;
const X_AXIS_HEIGHT = 24;

/** 纵轴：0 起、约 4 格的整齐刻度，最高一格高过最高的柱（柱顶的合计写得下；原型 73 → 0 · 20 · 40 · 60 · 80） */
export function dailyTicks(max: number): number[] {
  const rough = Math.max(max, 1) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const top = (Math.floor(max / step) + 1) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

interface Row extends ReportDay {
  readonly label: string;
  readonly total: number;
}

/** 下钻（没有工单页权限时为空）：柱为某一天，图例为某一组渠道，「查看明细」为整个期间 */
export interface DailyDrill {
  readonly day: (date: string) => void;
  readonly channel: (channel: ReportChannelGroup) => void;
  readonly detail: () => void;
  /** 悬停浮层「点击查看明细 → P04 工单（…）」里的条件：「09-10 新建或重开 · 客户来信」 */
  readonly condition: (date: string) => string;
}

/** 堆叠的一段：下面一段（亚马逊）在上面一段为 0 时顶端圆角；上面一段（Shopify 与邮件）底下留 2px 白缝、顶端圆角 */
function segmentShape(group: ReportChannelGroup) {
  return function Segment(props: BarShapeProps) {
    const row = props.payload as Row;
    const top = group === 'shopify_email' || row.shopify_email === 0;
    const gap = group === 'shopify_email' && row.amazon > 0 ? SEGMENT_GAP : 0;
    const height = Math.max(0, (props.height ?? 0) - gap);
    if (height === 0) return <g />;
    return (
      <Rectangle
        x={props.x}
        y={props.y}
        width={props.width}
        height={height}
        fill={COLORS[group]}
        radius={top ? [4, 4, 0, 0] : 0}
      />
    );
  };
}

function DailyTip({
  active,
  payload,
  drill,
}: {
  active: boolean | undefined;
  payload: readonly { readonly payload?: unknown }[] | undefined;
  drill: DailyDrill | null;
}) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  return (
    <div
      className="flex flex-col gap-px rounded-md bg-foreground px-2.5 py-1.75 text-12 leading-normal whitespace-nowrap text-primary-foreground shadow-md"
      data-testid="daily-tip"
    >
      <div className="font-semibold">{DAILY.tipTitle(row.label, row.total)}</div>
      <div className="text-primary-foreground/82">
        {DAILY.tipSplit(row.amazon, row.shopify_email)}
      </div>
      {drill && (
        <div className="mt-0.75 border-t border-primary-foreground/18 pt-1 font-semibold text-primary-on-dark">
          {DAILY.tipDrill(drill.condition(row.date))}
        </div>
      )}
    </div>
  );
}

/** 图例：能下钻时每一项是按钮（下钻带渠道） */
function Legend({ drill }: { drill: DailyDrill | null }) {
  return (
    <div className="flex items-center gap-3.5" data-testid="daily-legend">
      {(Object.keys(LABELS) as ReportChannelGroup[]).map((group) => {
        const item = (
          <>
            <span
              aria-hidden
              className="size-2.5 rounded-[2px]"
              style={{ background: COLORS[group] }}
            />
            {LABELS[group]}
          </>
        );
        return drill ? (
          <button
            key={group}
            type="button"
            aria-label={A11Y.legendDrill(LABELS[group])}
            className="inline-flex items-center gap-1.5 rounded-sm text-12 whitespace-nowrap text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => drill.channel(group)}
          >
            {item}
          </button>
        ) : (
          <span
            key={group}
            className="inline-flex items-center gap-1.5 text-12 whitespace-nowrap text-ink-2"
          >
            {item}
          </span>
        );
      })}
    </div>
  );
}

/** 卡头：标题与副标题，右侧「查看明细 ›」或「没有工单页权限 · 不可下钻」 */
function ChartHead({
  sub,
  drill,
  tag,
}: {
  sub: string;
  drill: DailyDrill | null;
  tag?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-px">
        <div className="flex items-center gap-2">
          <div className="text-13 font-bold text-foreground">{DAILY.title}</div>
          {tag}
        </div>
        <div className="text-12 text-muted-foreground">{sub}</div>
      </div>
      {drill ? (
        <Button variant="text-link" size="text" className="gap-1" onClick={drill.detail}>
          {DAILY.detail}
          <ChevronRight className="size-3.5" />
        </Button>
      ) : (
        <Badge tone="muted" data-testid="daily-no-drill">
          <Lock className="size-3" strokeWidth={2} />
          {DAILY.noDrill}
        </Badge>
      )}
    </div>
  );
}

export function DailyChart({
  days,
  sub,
  drill,
  height,
}: {
  days: readonly ReportDay[];
  sub: string;
  drill: DailyDrill | null;
  /** 绘图区高（原型客服主管 300） */
  height: number;
}) {
  const rows: Row[] = days.map((day) => ({
    ...day,
    label: day.date.slice(5),
    total: day.amazon + day.shopify_email,
  }));
  const ticks = dailyTicks(Math.max(0, ...rows.map((row) => row.total)));
  const labeled = rows.length <= MAX_LABELED_BARS;
  return (
    <Card className="min-w-0 gap-3 px-4.5 py-3.5" data-testid="daily-chart">
      <ChartHead sub={sub} drill={drill} />
      <Legend drill={drill} />
      <div
        role="img"
        aria-label={A11Y.chart}
        className={cn(drill && '[&_.recharts-bar-rectangle]:cursor-pointer')}
        style={{ height: height + PLOT_TOP + X_AXIS_HEIGHT }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: PLOT_TOP, right: 8, bottom: 0, left: 0 }}
            barSize={BAR_WIDTH}
            onClick={
              drill
                ? (state) => {
                    const row = rows.find((r) => r.label === state.activeLabel);
                    if (row) drill.day(row.date);
                  }
                : undefined
            }
            style={drill ? { cursor: 'pointer' } : undefined}
          >
            <CartesianGrid vertical={false} stroke="var(--border-soft)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              tickMargin={6}
              height={X_AXIS_HEIGHT}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis
              ticks={ticks}
              domain={[0, ticks.at(-1) ?? 0]}
              tickLine={false}
              axisLine={false}
              width={28}
              tick={{ fontSize: 11, fill: 'var(--subtle-foreground)' }}
            />
            <Tooltip
              cursor={drill ? { fill: 'var(--primary-soft)', radius: 6 } : false}
              isAnimationActive={false}
              content={({ active, payload }) => (
                <DailyTip active={active} payload={payload} drill={drill} />
              )}
            />
            <Bar
              dataKey="amazon"
              stackId="day"
              isAnimationActive={false}
              shape={segmentShape('amazon')}
            />
            <Bar
              dataKey="shopify_email"
              stackId="day"
              isAnimationActive={false}
              shape={segmentShape('shopify_email')}
            >
              {labeled && (
                <LabelList
                  dataKey="total"
                  position="top"
                  offset={6}
                  className="fill-ink-2 text-11 font-semibold tabular-nums"
                  formatter={(value) => (Number(value) > 0 ? String(value) : '')}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/** 图表骨架（K3：原型 card(between(skel 120 × 12、skel 64 × 10) + skel 100% × 150)，内边距 14 / 16、行距 12） */
export function ChartSkeleton() {
  return (
    <Card className="gap-3 px-4 py-3.5" data-testid="chart-loading">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-30" />
        <Skeleton className="h-2.5 w-16" />
      </div>
      <Skeleton className="h-37.5 w-full" />
    </Card>
  );
}
