import type { ReactNode } from 'react';

/** 区块小标题（原型 label()）：12 / 600、次要色、字距 0.03em */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-12 font-semibold tracking-[0.03em] text-muted-foreground">{children}</h2>
  );
}
