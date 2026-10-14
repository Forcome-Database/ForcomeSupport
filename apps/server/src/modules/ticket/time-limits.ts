import type { TicketEvent, TicketStatus } from '@forcome/contracts';
import { and, eq, gt, gte, inArray, isNotNull, lte, min, or } from 'drizzle-orm';
import { z } from 'zod';
import { listMergeableInboundIds, mailSyncedThrough } from '../channel';
import {
  defineJob,
  storeScopeCondition,
  SYSTEM_STORE_SCOPE,
  systemActor,
  toMilliseconds,
  transaction,
  type AppEnv,
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
 *    都从工单内最近一封来信（不论来源）的到达时间起算，满 7 × 24、14 × 24 小时即关；关闭时仍未回复的应回复来信计未达标。
 *    前提是到期前的来信都已看到（待办 33，ADR 0008 修订）：店铺的进线邮箱都已同步到到期时刻（回放按回放时钟，不看）、
 *    店铺在最近来信与到期之间到达的来信都已归并；没看到就本轮不关，等之后的扫描——否则同步滞后、归并排队时会先关再按 30 天内重开。
 *    关闭时把到期时刻记进状态变更（P05 状态流转这一步的业务时刻）；
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

/** 按时关闭：迁移事件与到期时刻（最近来信 + 7 / 14 天）；还没到（或已关闭）为 null */
export function idleCloseOf(
  status: TicketStatus,
  lastInboundAt: Date,
  now: Date,
): { readonly event: IdleEvent; readonly dueAt: Date } | null {
  const limit = IDLE_LIMITS[status];
  if (!limit) return null;
  const dueAt = new Date(lastInboundAt.getTime() + toMilliseconds({ days: limit.days }));
  return now.getTime() >= dueAt.getTime() ? { event: limit.event, dueAt } : null;
}

type TicketRow = typeof ticket.$inferSelect;

/**
 * 入库后最多等它归并多久：归并通常几秒，大批补拉后的积压也在几十分钟内；入库超过 1 小时仍没归并的（归并任务重试用完失败了，
 * 另有 worker 自检的失败任务告警）不再挡住按时关闭，免得一封信让整个店铺的工单一直不关
 */
const MERGE_WAIT_MS = toMilliseconds({ hours: 1 });

/** 按时关闭被挡住超过这么久（到期之后）记一条警告：多半是邮箱同步一直失败或有来信归并不了，要人去看 */
const HELD_WARN_MS = toMilliseconds({ hours: 1 });

/**
 * 到期前的来信是否都已看到（见文件头）：店铺的进线邮箱都同步到了到期时刻（回放里按回放时钟，回放逐封入库、跑完流水线才扫描，
 * 不看同步记录），且店铺在 (最近来信, 到期) 之间到达、要归并的来信都已在工单里（入库超过 MERGE_WAIT_MS 仍没归并的不等）。
 * 只看店铺：还没归并的信归哪张工单要归并了才知道
 */
async function mailSeenBefore(
  tx: Tx,
  appEnv: AppEnv,
  current: Pick<TicketRow, 'storeId' | 'lastInboundAt'>,
  dueAt: Date,
): Promise<boolean> {
  if (!tx.replay && !(await mailSyncedThrough(tx.db, appEnv, current.storeId, dueAt))) {
    return false;
  }
  const ids = await listMergeableInboundIds(
    tx.db,
    current.storeId,
    { after: current.lastInboundAt, before: dueAt },
    new Date(tx.now.getTime() - MERGE_WAIT_MS),
  );
  if (ids.length === 0) return true;
  const merged = await tx.db
    .select({ id: ticketMessage.channelMessageId })
    .from(ticketMessage)
    .where(inArray(ticketMessage.channelMessageId, ids));
  return merged.length === ids.length;
}

/** 一张工单这一轮的结果：关闭了、到期了但来信还没看全（挡住，到期时刻随附）、没到期 */
type IdleOutcome =
  { readonly kind: 'closed' } | { readonly kind: 'held'; readonly dueAt: Date } | null;

/** 锁住一张工单，到了时限、到期前的来信也都看到了，就按迁移表关闭（同时把仍未回复的应回复来信计未达标） */
async function closeIfIdle(
  tx: Tx,
  appEnv: AppEnv,
  ticketId: string,
  now: Date,
): Promise<IdleOutcome> {
  const [current] = await tx.db
    .select()
    .from(ticket)
    .where(and(eq(ticket.id, ticketId), storeScopeCondition(SYSTEM_STORE_SCOPE, ticket.storeId)))
    .for('update');
  if (!current) return null;
  const close = idleCloseOf(current.status, current.lastInboundAt, now);
  if (!close) return null;
  if (!(await mailSeenBefore(tx, appEnv, current, close.dueAt))) {
    return { kind: 'held', dueAt: close.dueAt };
  }
  await applyTransition(tx, current, close.event, systemActor, { dueAt: close.dueAt });
  await missUnrepliedOnClose(tx, ticketId);
  return { kind: 'closed' };
}

export interface TimeLimitScan {
  /** 过了截止改为未达标的来信封数 */
  readonly overdue: number;
  /** 按时关闭的工单张数 */
  readonly closed: number;
  /** 到期了、但到期前的来信还没看全，这一轮没关的工单张数 */
  readonly held: number;
  /** 不再等的我方回复封数 */
  readonly expiredReplies: number;
}

/** 按给定的「当前时间」扫一遍（任务处理器传运行时时钟的当前时间）；appEnv 定上线切换前算不算已切换（mail-cutover） */
export async function scanTimeLimits(
  runtime: Runtime,
  appEnv: AppEnv,
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
  let held = 0;
  // 到期超过 1 小时仍被挡住的到期时刻：一轮汇总记一条警告
  const heldLong: Date[] = [];
  for (const { id } of due) {
    const outcome = await transaction(at, (tx) => closeIfIdle(tx, appEnv, id, now));
    if (outcome?.kind === 'closed') closed += 1;
    if (outcome?.kind === 'held') {
      held += 1;
      if (now.getTime() - outcome.dueAt.getTime() >= HELD_WARN_MS) heldLong.push(outcome.dueAt);
    }
  }
  if (heldLong.length > 0) {
    logger.warn(
      {
        count: heldLong.length,
        earliestDueAt: new Date(Math.min(...heldLong.map((d) => d.getTime()))),
      },
      '有工单按时关闭已到期超过 1 小时仍没关：店铺的邮箱还没同步到到期时刻，或有到期前的来信没归并',
    );
  }

  const expiredReplies = await transaction(at, (tx) => expireWaitingReplies(tx, now, logger));
  if (overdue + closed + held + expiredReplies > 0) {
    logger.info(
      { overdue, closed, held, expiredReplies },
      '时限扫描：SLA 到期、按时关闭（与等来信看全的）、不再等的回复',
    );
  }
  return { overdue, closed, held, expiredReplies };
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
