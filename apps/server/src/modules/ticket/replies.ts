import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  findOutboundMessage,
  listReplyTargets,
  type OutboundMessage,
  type ReplyTarget,
} from '../channel';
import {
  advisoryLock,
  defineJob,
  storeScopeCondition,
  SYSTEM_STORE_SCOPE,
  systemActor,
  toMilliseconds,
  transaction,
  type JobContext,
  type Logger,
  type StoreScope,
  type Tx,
} from '../core';
import { pendingReply, ticket, ticketMessage } from './schema';
import { endTimersBefore, hasUnrepliedInbound } from './sla';
import { applyTransition } from './ticket-status';

/*
 * 回复识别（规格 ticket「回复识别」，PRD R-SL-08、6.1 第一阶段迁移表，待办 16；处理 channel 的「我方发信已同步」）：
 * 1. 「已发送」里的一封我方邮件按 In-Reply-To、References（从最近的一封往前）、Gmail 线程的顺序找它回复的邮件，
 *    归到那封邮件所在的工单；只归到发件邮箱所属店铺的工单（别的店铺邮箱回的不算，工单详情按店铺范围读消息）。
 * 2. 归到工单后：消息照常入工单（全程记录）；带 Auto-Submitted 或自动回复标记的不算回复，到此为止。其余结束它之前该工单内
 *    所有未回复来信的计时（sla.ts）；工单是待回复、且这之后没有未回复来信时按迁移表转等客户。已关闭的工单只记首次回复
 *    （关闭前发出、关闭后才同步进来的回信也算首响），不改状态；关闭时仍未回复的已计未达标（R-SL-07），超时后才回的仍是未达标。
 * 3. 乱序（R-SL-08「回复先于它所回复的来信入库时，等来信归并后再归属」）：In-Reply-To 指向的来信还没入库、或入库了还没归并时，
 *    不退而按 References、线程归属（同一线程里可能有别的工单的邮件），记进 pending_reply 等着；三种都找不到工单时同样等着。
 *    来信归并时按它的 Message-ID 与线程找到这里等着的回复，重新识别（retryWaitingReplies，同一事务里排任务）。
 *    最多等 24 小时：每分钟的扫描把满 24 小时的移出等待表，最后识别一次（不再等 In-Reply-To，按 References、线程找），
 *    还找不到就放弃（记日志）。
 * 回复与来信的「找不到 → 等着」和「归并 → 找等着的」要互斥，否则两边同时进行时谁也看不到谁：双方都先按「Message-ID」与
 * 「邮箱 + 线程」取咨询锁（排序后依次取，不会互相等死），归并在锁工单行之前取。
 * 任务幂等：一封回复只归属一次（工单消息按邮件 id 唯一），重跑结果不变。
 */

/** 回复最多等它所回复的来信多久（规格「回复找不到对应来信时任务延后重试（最长 24 小时）」） */
export const REPLY_WAIT_HOURS = 24;

/**
 * 重新识别一封等着的回复（它回复的来信归并了），与「我方发信已同步」同一个处理器；final 为等满 24 小时后的最后一次：
 * 不再等 In-Reply-To 指向的来信，找不到就放弃
 */
export const attributeReplyJob = defineJob(
  'ticket.attribute_reply',
  z.object({ messageId: z.uuid(), final: z.boolean().optional() }),
  { retryLimit: 5, retryDelay: 10, retryBackoff: true },
);

/** 回复与来信互斥用的咨询锁键：每个 Message-ID 一个、邮箱里的 Gmail 线程一个，排序去重 */
function replyLinkKeys(input: {
  readonly messageIds: readonly (string | null)[];
  readonly mailbox: string;
  readonly gmailThreadId: string;
}): string[] {
  const keys = input.messageIds
    .filter((id) => id !== null)
    .map((id) => `ticket.reply_link:message:${id}`);
  keys.push(`ticket.reply_link:thread:${input.mailbox}:${input.gmailThreadId}`);
  return [...new Set(keys)].sort();
}

export async function lockReplyLinks(
  tx: Tx,
  input: Parameters<typeof replyLinkKeys>[0],
): Promise<void> {
  for (const key of replyLinkKeys(input)) await advisoryLock(tx, key);
}

async function alreadyLinked(tx: Tx, channelMessageId: string): Promise<boolean> {
  const [row] = await tx.db
    .select({ id: ticketMessage.id })
    .from(ticketMessage)
    .where(eq(ticketMessage.channelMessageId, channelMessageId))
    .limit(1);
  return Boolean(row);
}

/** 回复要等 In-Reply-To 指向的来信归并（matchTicket 的结果之一） */
const WAIT = Symbol('wait');

/**
 * 这封回复归到哪张工单（见文件头第 1、3 点）：工单 id；要等 In-Reply-To 指向的来信归并时为 WAIT；找不到为 null。
 * 候选邮件由 channel 给出，它们在哪张工单由这里查
 */
async function matchTicket(
  tx: Tx,
  scope: StoreScope,
  reply: OutboundMessage & { readonly storeId: string },
  targets: readonly ReplyTarget[],
  final: boolean,
): Promise<string | typeof WAIT | null> {
  const linked = await tx.db
    .select({ channelMessageId: ticketMessage.channelMessageId, ticketId: ticketMessage.ticketId })
    .from(ticketMessage)
    .innerJoin(ticket, eq(ticket.id, ticketMessage.ticketId))
    .where(
      and(
        inArray(
          ticketMessage.channelMessageId,
          targets.map((target) => target.id),
        ),
        storeScopeCondition(scope, ticket.storeId),
        eq(ticket.storeId, reply.storeId),
      ),
    );
  const ticketOf = new Map(linked.map((row) => [row.channelMessageId, row.ticketId]));
  const byMessageId = (rfcMessageId: string) =>
    targets
      .filter((target) => target.rfcMessageId === rfcMessageId)
      .map((target) => ticketOf.get(target.id))
      .find((id) => id !== undefined) ?? null;
  // 1. In-Reply-To：它回复的来信还没入库，或是会归并的来信但还没归到工单——等它
  if (reply.inReplyTo && !final) {
    const found = byMessageId(reply.inReplyTo);
    if (found) return found;
    const repliedTo = targets.filter((target) => target.rfcMessageId === reply.inReplyTo);
    if (repliedTo.length === 0 || repliedTo.some((target) => target.mergeable)) return WAIT;
  }
  // 2. References，从最近的一封往前（最后一次识别时 In-Reply-To 也在这里再看一遍）
  for (const rfcMessageId of [reply.inReplyTo, ...[...reply.references].reverse()]) {
    const found = rfcMessageId ? byMessageId(rfcMessageId) : null;
    if (found) return found;
  }
  // 3. 同一邮箱的同一 Gmail 线程里已归到工单的邮件，取最近的一封
  const inThread = targets
    .filter(
      (target) =>
        target.mailbox === reply.mailbox &&
        target.gmailThreadId === reply.gmailThreadId &&
        ticketOf.has(target.id),
    )
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  return inThread[0] ? ticketOf.get(inThread[0].id)! : null;
}

/** 找不到工单：记下这封回复与它回复的 Message-ID、线程，等对应的来信归并 */
async function waitForInbound(tx: Tx, reply: OutboundMessage): Promise<void> {
  await tx.db
    .insert(pendingReply)
    .values({
      channelMessageId: reply.id,
      mailbox: reply.mailbox,
      gmailThreadId: reply.gmailThreadId,
      replyTo: [reply.inReplyTo, ...reply.references].filter((id) => id !== null),
      waitingSince: tx.now,
    })
    .onConflictDoNothing({ target: pendingReply.channelMessageId });
}

/** 识别一封我方回复（「我方发信已同步」与「重新识别等着的回复」的处理器；系统操作，不受店铺范围限制） */
export async function attributeReply(
  { messageId, final = false }: { messageId: string; final?: boolean },
  { runtime, logger }: JobContext,
): Promise<void> {
  const reply = await findOutboundMessage(runtime.db, SYSTEM_STORE_SCOPE, messageId);
  if (!reply) throw new Error(`没有这封我方发信：${messageId}`);
  const { storeId } = reply;
  if (reply.direction !== 'outbound' || reply.duplicateOfId || !storeId) {
    logger.warn({ messageId }, '不是要识别的我方发信，跳过');
    return;
  }
  if (await transaction(runtime, (tx) => alreadyLinked(tx, messageId))) return;

  await transaction(runtime, async (tx) => {
    await lockReplyLinks(tx, {
      messageIds: [reply.inReplyTo, ...reply.references],
      mailbox: reply.mailbox,
      gmailThreadId: reply.gmailThreadId,
    });
    if (await alreadyLinked(tx, messageId)) return;
    // 候选在取锁之后读：取锁前刚入库并归并完的来信（那次归并还看不到这封回复在等）也要在这里看到
    const targets = await listReplyTargets(tx.db, SYSTEM_STORE_SCOPE, reply);
    const ticketId = await matchTicket(
      tx,
      SYSTEM_STORE_SCOPE,
      { ...reply, storeId },
      targets,
      final,
    );
    if (ticketId === null && final) {
      logger.info({ messageId }, '我方回复等了 24 小时仍找不到对应的工单，不再等');
      return;
    }
    if (ticketId === null || ticketId === WAIT) {
      await waitForInbound(tx, reply);
      logger.info({ messageId }, '我方回复还找不到对应的来信，等来信归并（最多 24 小时）');
      return;
    }
    const [current] = await tx.db
      .select()
      .from(ticket)
      .where(eq(ticket.id, ticketId))
      .for('update');
    if (!current) throw new Error(`工单 ${ticketId} 不在了`);
    await tx.db.insert(ticketMessage).values({
      ticketId,
      channelMessageId: messageId,
      direction: 'outbound',
      receivedAt: reply.receivedAt,
      autoReply: reply.autoReply,
      createdAt: tx.now,
    });
    await tx.db.delete(pendingReply).where(eq(pendingReply.channelMessageId, messageId));
    if (reply.autoReply) {
      logger.info({ messageId, ticket: current.number }, '自动回复已归到工单，不算回复');
      return;
    }
    await endTimersBefore(tx, ticketId, reply.receivedAt);
    // 6.1：待回复 · 识别到我方回复，且该回复之后没有未回复来信 → 等客户
    if (current.status === 'awaiting_reply' && !(await hasUnrepliedInbound(tx, ticketId))) {
      await applyTransition(tx, current, 'reply_detected', systemActor, { messageId });
    }
    logger.info({ messageId, ticket: current.number }, '我方回复已归到工单');
  });
}

/**
 * 一封来信归并后（同一事务里，调用方已按它取了 lockReplyLinks）：找等着它的我方回复——回复的 In-Reply-To / References
 * 里有它的 Message-ID，或在同一邮箱的同一 Gmail 线程里——排任务重新识别
 */
export async function retryWaitingReplies(
  tx: Tx,
  inbound: {
    readonly mailbox: string;
    readonly gmailThreadId: string;
    readonly rfcMessageId: string | null;
  },
): Promise<void> {
  const waiting = await tx.db
    .select({ channelMessageId: pendingReply.channelMessageId })
    .from(pendingReply)
    .where(
      or(
        and(
          eq(pendingReply.mailbox, inbound.mailbox),
          eq(pendingReply.gmailThreadId, inbound.gmailThreadId),
        ),
        inbound.rfcMessageId
          ? sql`${inbound.rfcMessageId} = ANY(${pendingReply.replyTo})`
          : undefined,
      ),
    );
  for (const { channelMessageId } of waiting) {
    await tx.enqueue(attributeReplyJob, { messageId: channelMessageId });
  }
}

/** 每分钟扫描：等了满 24 小时的回复移出等待表、排最后一次识别（找不到就放弃），返回几封 */
export async function expireWaitingReplies(tx: Tx, now: Date, logger: Logger): Promise<number> {
  const cutoff = new Date(now.getTime() - toMilliseconds({ hours: REPLY_WAIT_HOURS }));
  const expired = await tx.db
    .delete(pendingReply)
    .where(lte(pendingReply.waitingSince, cutoff))
    .returning({ channelMessageId: pendingReply.channelMessageId });
  for (const { channelMessageId } of expired) {
    await tx.enqueue(attributeReplyJob, { messageId: channelMessageId, final: true });
  }
  if (expired.length > 0) {
    logger.info(
      { messages: expired.map((row) => row.channelMessageId) },
      '我方回复等了 24 小时，最后识别一次（不再等 In-Reply-To 指向的来信）',
    );
  }
  return expired.length;
}
