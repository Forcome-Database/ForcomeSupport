import { can, contactAdmins, type TicketDetail } from '@forcome/contracts';
import { useQuery, useSuspenseQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { Fragment, Suspense, type ReactNode } from 'react';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden';
import { LoadError } from '@/components/load-error';
import { TicketChannelStore, TicketStatusBadge } from '@/components/ticket-badges';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError } from '@/lib/api';
import { storeOptionsQuery } from '@/lib/channel';
import { useCurrentMember } from '@/lib/current-member';
import { pages } from '@/lib/pages';
import { adminContactsQuery } from '@/lib/session';
import { ticketDetailQuery } from '@/lib/tickets';
import { useMarkNoReply } from './no-reply';
import { META, MISSING } from './p05-copy';
import { autoCloseWords } from './p05-words';
import { TicketSide } from './ticket-side';
import { TicketTimeline } from './ticket-timeline';

/*
 * P05 工单详情（第一阶段，PRD P05「第一阶段」、I18 与补充小样③–⑧；参照图 design/spec/shots/phase1/P05_TicketDetail*.png；待办 17）：
 * 只读，标题区没有重新打开、合并、内部备注、导出记录、添加标签与负责人，客户名不是链接；唯一的操作是来信卡上的「标记无需回复」
 * （坐席、客服主管）。布局：标题区（主题 · 状态 · 渠道与店铺；元信息「编号 · 客户 · 订单 · 自动关闭」）+ 左边全程记录（卡片内滚动）、
 * 右边 380 的四张卡（页头与右栏不随全程记录滚动）。加载骨架；其他店铺的工单 G2（按店铺范围写），不存在的 G3（只有「返回工单列表」）。
 */

/** 标题区（原型 ui.detail_head()）：20 / 600 主题 + 状态与渠道徽标；下一行 12 号元信息，用「·」隔开 */
function DetailHead({ detail }: { detail: TicketDetail }) {
  const { ticket } = detail;
  const meta = [
    ticket.number,
    META.customer(ticket.customer.name),
    ...(ticket.orderNumber ? [META.order(ticket.orderNumber)] : []),
    autoCloseWords(detail),
  ].filter((part): part is string => Boolean(part));
  return (
    <div className="flex shrink-0 flex-col gap-1 px-6 pt-3.5 pb-1">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="text-20 leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">
          {ticket.subject}
        </h1>
        <TicketStatusBadge status={ticket.status} />
        <TicketChannelStore channel={ticket.channel} site={ticket.site} store={ticket.store.name} />
      </div>
      <div
        className="flex flex-wrap items-center gap-3 text-12 text-muted-foreground"
        data-testid="ticket-meta"
      >
        {meta.map((part, i) => (
          <Fragment key={part}>
            {i > 0 && <span className="text-subtle-foreground">·</span>}
            <span className="whitespace-nowrap">{part}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function DetailLayout({
  head,
  left,
  right,
}: {
  head: ReactNode;
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {head}
      <div className="flex min-h-0 flex-1 gap-4 px-6 pt-3.5 pb-4">
        <div className="flex min-w-0 flex-1 flex-col">{left}</div>
        {right}
      </div>
    </div>
  );
}

/** 加载骨架（P05「状态」：加载骨架；同 G1 的写法） */
function DetailSkeleton() {
  return (
    <DetailLayout
      head={
        <div className="flex shrink-0 flex-col gap-2 px-6 pt-3.5 pb-1" aria-busy>
          <Skeleton className="h-5 w-80 rounded-sm" />
          <Skeleton className="h-3 w-120 rounded-sm" />
        </div>
      }
      left={
        <Card className="min-h-0 flex-1 gap-3 px-4.5 py-3.5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </Card>
      }
      right={
        <div className="flex w-95 shrink-0 flex-col gap-3">
          {[120, 160, 100, 180].map((h) => (
            <Skeleton key={h} className="rounded-lg" style={{ height: h }} />
          ))}
        </div>
      }
    />
  );
}

/** G2：其他店铺的工单（Q5）——写这张工单不在你的店铺范围内与你的店铺范围，管理员姓名的写法同 G2；数据都到了才显示 */
function TicketForbidden({ number }: { number: string }) {
  const member = useCurrentMember();
  const [admins, stores] = useSuspenseQueries({ queries: [adminContactsQuery, storeOptionsQuery] });
  const scope = stores.data.map((store) => store.name).join('、');
  const contact = contactAdmins(admins.data.admins.map((admin) => admin.name));
  return <ForbiddenCard description={MISSING.forbidden(number, scope, contact)} member={member} />;
}

/** G3：找不到这张工单（第一阶段没有全局搜索，只有「返回工单列表」） */
function TicketNotFound({ number }: { number: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Card className="px-6 py-2">
        <EmptyState
          icon={Search}
          title={MISSING.notFoundTitle}
          description={MISSING.notFound(number)}
          action={
            <Button asChild>
              <Link to={pages.tickets.path}>{MISSING.backToList}</Link>
            </Button>
          }
        />
      </Card>
    </div>
  );
}

function TicketDetailView({ detail }: { detail: TicketDetail }) {
  const member = useCurrentMember();
  const { mark, pending } = useMarkNoReply(detail.ticket.number);
  return (
    <DetailLayout
      head={<DetailHead detail={detail} />}
      left={
        <TicketTimeline
          detail={detail}
          canMark={can(member.roles, 'ticket.mark_no_reply')}
          marking={pending}
          onMark={(message) => void mark(message, detail.ticket.status)}
        />
      }
      right={<TicketSide detail={detail} />}
    />
  );
}

export function TicketDetailPage({ number }: { number: string }) {
  const detail = useQuery(ticketDetailQuery(number));
  if (detail.isPending) return <DetailSkeleton />;
  if (detail.isError) {
    const status = detail.error instanceof ApiRequestError ? detail.error.status : null;
    // G2 要等店铺范围与管理员两份数据：就近的 Suspense 兜住（路由没有 pending 组件，不然整个外壳会挂起）
    if (status === 403) {
      return (
        <Suspense fallback={<DetailSkeleton />}>
          <TicketForbidden number={number} />
        </Suspense>
      );
    }
    // 编号格式不对（400）与没有这张工单都按找不到
    if (status === 404 || status === 400) return <TicketNotFound number={number} />;
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadError onRetry={() => void detail.refetch()} />
      </div>
    );
  }
  return <TicketDetailView detail={detail.data} />;
}
