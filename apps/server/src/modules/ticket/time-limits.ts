import type { TicketEvent, TicketStatus } from '@forcome/contracts';
import { and, eq, gt, gte, isNotNull, lte, min, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  defineJob,
  storeScopeCondition,
  SYSTEM_STORE_SCOPE,
  systemActor,
  toMilliseconds,
  transaction,
  type DbExecutor,
  type Logger,
  type Runtime,
  type Tx,
} from '../core';
import { expireWaitingReplies, REPLY_WAIT_HOURS } from './replies';
import { pendingReply, ticket, ticketMessage } from './schema';
import { markOverdue, missUnrepliedOnClose } from './sla';
import { applyTransition } from './ticket-status';

/*
 * 每分钟的时限扫描（规格 ticket「时限扫描」，ADR 0008：时限靠每分钟扫描与表里的时间列，不挂延迟任务；PRD 6.1、R-SL-07，待办 16）：
 * 1. 应回复来信过了 SLA 截止仍未回复：未到期 → 未达标；
 * 2. 按时关闭：待回复 14 天无新来信 → 已关闭（未识别到回复）；等客户、已解决 7 天无来信 → 已关闭（客户未回复 / 已解决后无来信）。
 *    都从工单内最近一封来信（不论来源）的到达时间起算，满 7 × 24、14 × 24 小时即关；关闭时仍未回复的应回复来信计未达标；
 * 3. 等对应来信的我方回复满 24 小时的不再等（replies.ts）。
 * 接收显式的「当前时间」（回放时注入为邮件时间，ADR 0008）：状态变更记录的时刻即它——关闭的业务时刻，R-TK-01 的 30 天重开按它判断。
 * 第一期不产生 SLA 提醒。一张工单一个事务，锁住后按当时的状态与最近来信再判断一次（并发的归并可能刚追加了来信）。
 */

export const ticketTimeLimitsJob = defineJob(
  'ticket.time_limits',
  z.object({}),
  // 同时最多一个排队、一个在跑；失败了下一分钟照常再扫
  { policy: 'stately', retryLimit: 0 },
  { cron: '* * * * *', tz: 'Asia/Shanghai', runAtStartup: true },
);

type IdleEvent = Extract<TicketEvent, 'idle_7_days' | 'idle_14_days'>;

/**
 * 6.1 的按时关闭：哪个状态多少天无来信、按哪个事件关闭（关闭原因由迁移表给出）。扫描的候选条件与锁住后的重判都按这张表
 */
export const IDLE_LIMITS: Readonly<
  Partial<Record<TicketStatus, { readonly days: number; readonly event: IdleEvent }>>
> = {
  // 待回复 14 天无新来信 → 已关闭（未识别到回复）
  awaiting_reply: { days: 14, event: 'idle_14_days' },
  // 等客户 7 天无来信 → 已关闭（客户未回复）；已解决 7 天无来信 → 已关闭（已解决后无来信）
  awaiting_customer: { days: 7, event: 'idle_7_days' },
  resolved: { days: 7, event: 'idle_7_days' },
};

/** 到了时限要发生的迁移事件；还没到（或已关闭）为 null */
export function idleEventOf(
  status: TicketStatus,
  lastInboundAt: Date,
  now: Date,
): IdleEvent | null {
  const limit = IDLE_LIMITS[status];
  if (!limit) return null;
  return now.getTime() - lastInboundAt.getTime() >= toMilliseconds({ days: limit.days })
    ? limit.event
    : null;
}

/** 锁住一张工单，到了时限就按迁移表关闭（同时把仍未回复的应回复来信计未达标）；返回是否关闭了 */
async function closeIfIdle(tx: Tx, ticketId: string, now: Date): Promise<boolean> {
  const [current] = await tx.db
    .select()
    .from(ticket)
    .where(and(eq(ticket.id, ticketId), storeScopeCondition(SYSTEM_STORE_SCOPE, ticket.storeId)))
    .for('update');
  if (!current) return false;
  const event = idleEventOf(current.status, current.lastInboundAt, now);
  if (!event) return false;
  await applyTransition(tx, current, event, systemActor);
  await missUnrepliedOnClose(tx, ticketId);
  return true;
}

export interface TimeLimitScan {
  /** 过了截止改为未达标的来信封数 */
  readonly overdue: number;
  /** 按时关闭的工单张数 */
  readonly closed: number;
  /** 不再等的我方回复封数 */
  readonly expiredReplies: number;
}

/** 按给定的「当前时间」扫一遍（任务处理器传运行时时钟的当前时间） */
export async function scanTimeLimits(
  runtime: Runtime,
  now: Date,
  logger: Logger,
): Promise<TimeLimitScan> {
  // 事务的「当前时间」（tx.now，状态变更记录的时刻）就是这次扫描的时间
  const at: Runtime = { ...runtime, clock: { now: () => now } };
  const overdue = await transaction(at, (tx) => markOverdue(tx, now));

  // 系统操作，扫全部店铺
  const due = await runtime.db
    .select({ id: ticket.id })
    .from(ticket)
    .where(
      and(
        storeScopeCondition(SYSTEM_STORE_SCOPE, ticket.storeId),
        or(
          ...Object.entries(IDLE_LIMITS).map(([status, limit]) =>
            and(
              eq(ticket.status, status as TicketStatus),
              lte(
                ticket.lastInboundAt,
                new Date(now.getTime() - toMilliseconds({ days: limit.days })),
              ),
            ),
          ),
        ),
      ),
    );
  let closed = 0;
  for (const { id } of due) {
    if (await transaction(at, (tx) => closeIfIdle(tx, id, now))) closed += 1;
  }

  const expiredReplies = await transaction(at, (tx) => expireWaitingReplies(tx, now, logger));
  if (overdue + closed + expiredReplies > 0) {
    logger.info({ overdue, closed, expiredReplies }, '时限扫描：SLA 到期、按时关闭与不再等的回复');
  }
  return { overdue, closed, expiredReplies };
}

/**
 * 最早什么时候又有时限要到（历史回放，待办 26）：给出最早的「到了这一刻扫描就会改东西」的时刻，没有为 null；可能早于回放的
 * 当前时间（一封邮件改了状态，让早就到点的时限生效，调用方放在这封之后的下一分钟）。回放不逐分钟扫 90 天，而是按它把扫描放在
 * 实时 worker 会扫到的那一分钟，结果与逐分钟扫描相同：
 * - 应回复来信：截止之后（markOverdue 是「截止早于当前时间」，所以是截止 + 1 毫秒）；
 * - 按时关闭：各状态最近来信 + 7 / 14 天（IDLE_LIMITS，「满」即关）；
 * - 等来信的我方回复：开始等 + 24 小时。
 * 给了 after 只看它之后的：扫描过、仍到点却没改动的（单线程回放里不会出现）由调用方据此跳过，免得反复扫同一刻。
 */
export async function nextTimeLimitAt(db: DbExecutor, after: Date | null): Promise<Date | null> {
  const candidates: Date[] = [];
  const [sla] = await db
    .select({ at: min(ticketMessage.slaDueAt) })
    .from(ticketMessage)
    .where(
      and(
        eq(ticketMessage.slaResult, 'pending'),
        after ? gte(ticketMessage.slaDueAt, after) : isNotNull(ticketMessage.slaDueAt),
      ),
    );
  if (sla?.at) candidates.push(new Date(sla.at.getTime() + 1));
  for (const [status, limit] of Object.entries(IDLE_LIMITS)) {
    const ms = toMilliseconds({ days: limit.days });
    const [idle] = await db
      .select({ at: min(ticket.lastInboundAt) })
      .from(ticket)
      .where(
        and(
          storeScopeCondition(SYSTEM_STORE_SCOPE, ticket.storeId),
          eq(ticket.status, status as TicketStatus),
          after ? gt(ticket.lastInboundAt, new Date(after.getTime() - ms)) : undefined,
        ),
      );
    if (idle?.at) candidates.push(new Date(idle.at.getTime() + ms));
  }
  const waitMs = toMilliseconds({ hours: REPLY_WAIT_HOURS });
  const [waiting] = await db
    .select({ at: min(pendingReply.waitingSince) })
    .from(pendingReply)
    .where(after ? gt(pendingReply.waitingSince, new Date(after.getTime() - waitMs)) : undefined);
  if (waiting?.at) candidates.push(new Date(waiting.at.getTime() + waitMs));
  return candidates.length === 0
    ? null
    : new Date(Math.min(...candidates.map((at) => at.getTime())));
}
