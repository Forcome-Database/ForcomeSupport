import { ChevronRight, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/*
 * P17 图表卡的卡头（原型 build_approval_kb_reports.chart_card()）：13 / 700 标题（旁边可带标签，间距 8）与 12 次要色副标题，
 * 右侧「查看明细 ›」或其他说明。「每日工单量」与「售后成本按责任类型」共用。
 */

export function ChartHead({
  title,
  sub,
  tag,
  action,
}: {
  title: string;
  sub: string;
  tag?: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-px">
        <div className="flex items-center gap-2">
          <div className="text-13 font-bold text-foreground">{title}</div>
          {tag}
        </div>
        <div className="text-12 text-muted-foreground">{sub}</div>
      </div>
      {action}
    </div>
  );
}

/** 卡头右上的「查看明细 ›」 */
export function DetailLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="text-link" size="text" className="gap-1" onClick={onClick}>
      {label}
      <ChevronRight className="size-3.5" />
    </Button>
  );
}

/** 带锁的灰色标签（原型 chip(…, 'muted', 11, 'lock')）：「本月 · 不随时间筛选」「没有工单页权限 · 不可下钻」 */
export function LockTag({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <Badge tone="muted" data-testid={testId}>
      <Lock className="size-3" strokeWidth={2} />
      {children}
    </Badge>
  );
}

/**
 * 悬停浮层（原型 drill_tip()）：深色底，第一行 600 字重，其下几行 82% 白，可下钻时末行隔一道 18% 白线写「点击查看明细 → …」
 * （主色在深底上的令牌）
 */
export function ChartTip({
  title,
  lines,
  drill,
  testId,
}: {
  title: string;
  lines: readonly string[];
  /** 可下钻时末行的文字；不可下钻为空 */
  drill: string | null;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-col gap-px rounded-md bg-foreground px-2.5 py-1.75 text-12 leading-normal whitespace-nowrap text-primary-foreground shadow-md"
      data-testid={testId}
    >
      <div className="font-semibold">{title}</div>
      {lines.map((line) => (
        <div key={line} className="text-primary-foreground/82">
          {line}
        </div>
      ))}
      {drill && (
        <div className="mt-0.75 border-t border-primary-foreground/18 pt-1 font-semibold text-primary-on-dark">
          {drill}
        </div>
      )}
    </div>
  );
}
