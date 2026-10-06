import type { TicketEvent, TicketStatus } from '@forcome/contracts';
import { and, eq, inArray, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { defineJob, systemActor, transaction, type Logger, type Runtime, type Tx } from '../core';
import { expireWaitingReplies } from './replies';
import { ticket } from './schema';
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

const DAY = 86_400_000;
/** 6.1：待回复 14 天无新来信关闭 */
export const AWAITING_REPLY_IDLE_DAYS = 14;
/** 6.1：等客户、已解决 7 天无来信关闭 */
export const WAITING_IDLE_DAYS = 7;

/** 到了时限要发生的迁移事件；还没到（或已关闭）为 null */
export function idleEventOf(
  status: TicketStatus,
  lastInboundAt: Date,
  now: Date,
): Extract<TicketEvent, 'idle_7_days' | 'idle_14_days'> | null {
  const idle = now.getTime() - lastInboundAt.getTime();
  if (status === 'awaiting_reply')
    return idle >= AWAITING_REPLY_IDLE_DAYS * DAY ? 'idle_14_days' : null;
  if (status === 'awaiting_customer' || status === 'resolved') {
    return idle >= WAITING_IDLE_DAYS * DAY ? 'idle_7_days' : null;
  }
  return null;
}

/** 锁住一张工单，到了时限就按迁移表关闭（同时把仍未回复的应回复来信计未达标）；返回是否关闭了 */
async function closeIfIdle(tx: Tx, ticketId: string, now: Date): Promise<boolean> {
  const [current] = await tx.db.select().from(ticket).where(eq(ticket.id, ticketId)).for('update');
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

  const due = await runtime.db
    .select({ id: ticket.id })
    .from(ticket)
    .where(
      or(
        and(
          eq(ticket.status, 'awaiting_reply'),
          lte(ticket.lastInboundAt, new Date(now.getTime() - AWAITING_REPLY_IDLE_DAYS * DAY)),
        ),
        and(
          inArray(ticket.status, ['awaiting_customer', 'resolved']),
          lte(ticket.lastInboundAt, new Date(now.getTime() - WAITING_IDLE_DAYS * DAY)),
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
