import {
  NO_REPLY_UNDO_SECONDS,
  noReplyMessages,
  slaResultOf,
  type AuditSnapshot,
  type NoReplyAction,
  type TicketStatus,
} from '@forcome/contracts';
import { and, eq } from 'drizzle-orm';
import {
  AccessDeniedError,
  recordAudit,
  toMilliseconds,
  transaction,
  UNDO_GRACE,
  type Actor,
  type Runtime,
  type Tx,
} from '../core';
import { ticketsChanged } from './changes';
import { noReplyEvent, ticket, ticketMessage } from './schema';
import { hasUnrepliedInbound } from './sla';
import { applyTransition } from './ticket-status';

/*
 * 「标记无需回复」与撤销（PRD P05「第一阶段」、6.1 第一阶段迁移表、AC-P1-01，待办 17；P05 唯一的写操作）：
 * - 坐席、客服主管（能力 ticket.mark_no_reply，由接口把关）对未关闭工单中的未回复来信立即标记：记操作人与时刻，应回复来信的 SLA 结果
 *   改为无需回复（不计入 SLA）；标记后工单里没有未回复来信了、且工单是待回复，按迁移表转已解决（all_marked_no_reply）。
 * - 5 秒内由标记的人撤销（界面倒计时从收到结果才开始数，撤销请求还要一段网络时间，服务端多留 5 秒，同台账「设为已完成」的撤销）：
 *   清掉标记，SLA 结果按 slaResultOf 恢复；工单是已解决、撤销后又有未回复来信时按迁移表回到待回复（undo_mark_no_reply）。
 * - 每次标记、撤销记一行经过（no_reply_event，P05 的事件行；撤销不删原来那行），记审计（工单对象，前后值为来信、无需回复与工单状态）。
 * 一张工单的标记与撤销串行：事务里先锁工单行再锁这封来信。
 */

type MemberActor = Extract<Actor, { kind: 'member' }>;

/** 标记或撤销被拒（400 不能这样做 · 404 没有这封来信 · 409 已被别人标记）；说法见 contracts 的 noReplyMessages */
export class NoReplyRefusedError extends Error {
  override name = 'NoReplyRefusedError';
  readonly status: 400 | 404 | 409;
  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

/** 要标记或撤销的工单（接口经 access.findOwned 按店铺范围取出） */
export interface NoReplyTarget {
  readonly id: string;
  readonly number: string;
  readonly storeId: string;
  readonly customerName: string;
}

type TicketRow = typeof ticket.$inferSelect;
type LetterRow = typeof ticketMessage.$inferSelect;

/** 锁住工单与它里面的这封来信；不是这张工单的来信（或是我方发出的）为 404 */
async function lockLetter(
  tx: Tx,
  target: NoReplyTarget,
  messageId: string,
): Promise<{ current: TicketRow; letter: LetterRow }> {
  const [current] = await tx.db.select().from(ticket).where(eq(ticket.id, target.id)).for('update');
  if (!current) throw new NoReplyRefusedError(404, noReplyMessages.notFound);
  const [letter] = await tx.db
    .select()
    .from(ticketMessage)
    .where(
      and(eq(ticketMessage.ticketId, target.id), eq(ticketMessage.channelMessageId, messageId)),
    )
    .for('update');
  if (!letter || letter.direction !== 'inbound') {
    throw new NoReplyRefusedError(404, noReplyMessages.notFound);
  }
  return { current, letter };
}

type Snapshot = AuditSnapshot<'ticket.mark_no_reply'>;

function snapshotOf(target: NoReplyTarget, letter: LetterRow, status: TicketStatus): Snapshot {
  return {
    message: { name: target.customerName, at: letter.receivedAt.toISOString() },
    noReply:
      letter.noReplyByName && letter.noReplyAt
        ? { name: letter.noReplyByName, at: letter.noReplyAt.toISOString() }
        : null,
    status,
  };
}

/** 记一行经过与一条审计 */
async function record(
  tx: Tx,
  actor: MemberActor,
  target: NoReplyTarget,
  change: {
    readonly action: NoReplyAction;
    readonly messageId: string;
    readonly before: Snapshot;
    readonly after: Snapshot;
    readonly transitioned: boolean;
  },
): Promise<void> {
  await tx.db.insert(noReplyEvent).values({
    ticketId: target.id,
    channelMessageId: change.messageId,
    action: change.action,
    actorId: actor.memberId,
    actorName: actor.name,
    toStatus: change.transitioned ? change.after.status : null,
    occurredAt: tx.now,
  });
  await ticketsChanged(tx);
  await recordAudit(tx, actor, {
    action: change.action === 'mark' ? 'ticket.mark_no_reply' : 'ticket.undo_no_reply',
    objectType: 'ticket',
    objectId: target.id,
    objectLabel: target.number,
    storeId: target.storeId,
    before: change.before,
    after: change.after,
  });
}

/** 标记一封来信无需回复；工单里没有未回复来信了时待回复 → 已解决 */
export function markNoReply(
  runtime: Runtime,
  actor: MemberActor,
  target: NoReplyTarget,
  messageId: string,
): Promise<void> {
  return transaction(runtime, async (tx) => {
    const { current, letter } = await lockLetter(tx, target, messageId);
    if (letter.noReplyByName) {
      throw new NoReplyRefusedError(409, noReplyMessages.marked(letter.noReplyByName));
    }
    if (current.status === 'closed') throw new NoReplyRefusedError(400, noReplyMessages.closed);
    if (letter.firstReplyAt) throw new NoReplyRefusedError(400, noReplyMessages.replied);

    const [marked] = await tx.db
      .update(ticketMessage)
      .set({
        noReplyById: actor.memberId,
        noReplyByName: actor.name,
        noReplyAt: tx.now,
        // 应回复来信不计入 SLA；生产厂、其他供应商的来信本来就不计
        slaResult: letter.slaResult === null ? null : 'not_required',
      })
      .where(eq(ticketMessage.id, letter.id))
      .returning();
    const after =
      current.status === 'awaiting_reply' && !(await hasUnrepliedInbound(tx, current.id))
        ? await applyTransition(tx, current, 'all_marked_no_reply', actor)
        : current;
    await record(tx, actor, target, {
      action: 'mark',
      messageId,
      before: snapshotOf(target, letter, current.status),
      after: snapshotOf(target, marked!, after.status),
      transitioned: after !== current,
    });
  });
}

/** 撤销标记（5 秒内、标记的人）；工单已解决、撤销后又有未回复来信时回到待回复 */
export function undoNoReply(
  runtime: Runtime,
  actor: MemberActor,
  target: NoReplyTarget,
  messageId: string,
): Promise<void> {
  return transaction(runtime, async (tx) => {
    const { current, letter } = await lockLetter(tx, target, messageId);
    if (!letter.noReplyAt) throw new NoReplyRefusedError(400, noReplyMessages.notMarked);
    if (letter.noReplyById !== actor.memberId) {
      throw new AccessDeniedError(noReplyMessages.notYours);
    }
    const limit = toMilliseconds({ seconds: NO_REPLY_UNDO_SECONDS }) + toMilliseconds(UNDO_GRACE);
    if (tx.now.getTime() - letter.noReplyAt.getTime() > limit) {
      throw new NoReplyRefusedError(400, noReplyMessages.undoExpired);
    }

    const [unmarked] = await tx.db
      .update(ticketMessage)
      .set({
        noReplyById: null,
        noReplyByName: null,
        noReplyAt: null,
        // 恢复计时：按首次回复（标记期间可能已被回复）与截止重新判
        slaResult: letter.slaDueAt
          ? slaResultOf({ dueAt: letter.slaDueAt, firstReplyAt: letter.firstReplyAt, now: tx.now })
          : null,
      })
      .where(eq(ticketMessage.id, letter.id))
      .returning();
    const after =
      current.status === 'resolved' && (await hasUnrepliedInbound(tx, current.id))
        ? await applyTransition(tx, current, 'undo_mark_no_reply', actor)
        : current;
    await record(tx, actor, target, {
      action: 'undo',
      messageId,
      before: snapshotOf(target, letter, current.status),
      after: snapshotOf(target, unmarked!, after.status),
      transitioned: after !== current,
    });
  });
}
