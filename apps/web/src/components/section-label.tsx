import type { ReactNode } from 'react';

/**
 * 区块小标题（原型 label()）：12 / 600、次要色、字距 0.03em。默认是 h2；不是页面区块的标题时（如 P27 展开里「变更前」
 * 「变更后」两栏的栏名）用 as="div"
 */
export function SectionLabel({
  children,
  as: Tag = 'h2',
}: {
  children: ReactNode;
  as?: 'h2' | 'div';
}) {
  return (
    <Tag className="text-12 font-semibold tracking-[0.03em] text-muted-foreground">{children}</Tag>
  );
}
