import type { ReactNode } from 'react';

/*
 * 列表页的页头（原型 page_head()，直接落在浅灰底上）：20 / 700 标题、13 次要色说明，右侧是操作按钮（底边对齐，间距 8）；
 * 内边距 16 / 24 / 2。P04、P13、P17 共用。
 */
export function PageHead({
  title,
  description,
  actions,
}: {
  title: string;
  /** 一行说明（字符串）或几行（P17 的数据来源与两条注） */
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-end justify-between gap-4 px-6 pt-4 pb-0.5">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-20 font-bold tracking-[-0.015em] text-foreground">{title}</h1>
        {typeof description === 'string' ? (
          <p className="text-13 text-muted-foreground">{description}</p>
        ) : (
          description
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
