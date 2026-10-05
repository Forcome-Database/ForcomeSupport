import { aftersalesStatusLabels, type AftersalesStatus } from '@forcome/contracts';
import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';

/*
 * 售后单的状态与分类徽标（原型 state()、cat()；P13 台账，第二期 P07 共用）：状态一律带点，颜色由原型 STATE_TONE 的唯一映射决定
 * （进行中 浅靛蓝、已完成 绿、已取消 灰）；处理方式、责任类型是分类值，中性灰、不带语义色。
 */

const STATUS_TONE: Record<AftersalesStatus, BadgeTone> = {
  in_progress: 'accent',
  completed: 'success',
  cancelled: 'muted',
};

export function AftersalesStatusBadge({ status }: { status: AftersalesStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {aftersalesStatusLabels[status]}
    </Badge>
  );
}

/** 分类值（处理方式、责任类型；原型 cat()） */
export function CategoryBadge({ children }: { children: ReactNode }) {
  return <Badge tone="neutral">{children}</Badge>;
}
