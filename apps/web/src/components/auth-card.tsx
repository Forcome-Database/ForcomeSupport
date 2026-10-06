import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * 登录卡片（原型 auth_card()，G11、G12）：整页浅灰底上居中，白底卡片（16 圆角、卡片阴影、内边距 24 / 24 / 20），
 * 顶上品牌标，内容竖排、间距 14。扫码登录宽 360；被拒说明宽 410（原型 deny()）。开发登录页、钉钉扫码登录页、
 * 扫码回调页共用。
 */
export function AuthCard({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card
        className={cn(
          'items-center gap-3.5 rounded-xl px-6 pt-6 pb-5 shadow-card',
          wide ? 'w-102.5' : 'w-90',
        )}
      >
        <Brand />
        {children}
      </Card>
    </main>
  );
}

/** 登录卡片的标题与副标题（原型 col(text(16, 700) + muted(12), 2)） */
export function AuthHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-0.5 text-center">
      <h1 className="text-16 font-bold text-foreground">{title}</h1>
      <p className="text-12 text-muted-foreground">{subtitle}</p>
    </div>
  );
}

/** 登录卡片底部的说明（原型 login_note：12、次要色、居中，上方一条浅分隔线） */
export function AuthNote({ children }: { children: ReactNode }) {
  return (
    <p className="w-full border-t border-border-soft pt-3 text-center text-12 leading-[1.55] text-muted-foreground">
      {children}
    </p>
  );
}
