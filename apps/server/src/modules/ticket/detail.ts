import { businessDate } from '@forcome/calendar';
import {
  isTicketSource,
  slaTargetOf,
  usdOf,
  type OrderCard,
  type TicketDetail,
  type TicketEvent,
  type TicketMessage,
  type TicketStatusStep,
  type TicketTimelineEvent,
} from '@forcome/contracts';
import { asc, eq } from 'drizzle-orm';
import { findOrderStore, listMessageSummaries, storeNamesById } from '../channel';
import { exchangeRateOn, toMilliseconds, type DbExecutor, type StoreScope } from '../core';
import { findMirroredOrder, type MirroredOrder } from '../order';
import { transition } from './lifecycle';
import { pendingSla, toListItem, type TicketRow } from './queries';
import { noReplyEvent, ticketMessage } from './schema';
import { listStatusChanges } from './ticket-status';
import { IDLE_LIMITS } from './time-limits';

/*
 * P05 工单详情（PRD P05「第一阶段」、I18，待办 17；规格 ticket「查询接口」）：工单、消息（正文、首次回复、SLA、无需回复标记）、
 * 全程记录的事件行、状态流转、自动关闭预计与订单卡。一律按查看者的店铺范围读（ADR 0010）。
 * 时刻取业务时刻（ADR 0008「待办 17 落地」修订）：由来信或我方回复引起的状态变更（新建、新来信、重开、识别到回复）取那封邮件的时间，
 * 按时关闭取关闭时存下的到期时刻（关闭时最近一封来信 + 7 / 14 天，待办 33：不在读取时重算），标记与撤销取操作时刻。处理时刻在实时运行时与它们只差几秒，
 * 但 Gmail 中断后补拉、示例回放把几天的邮件压在几秒内处理时对不上邮件时间，状态流转会全挤在处理的那一刻。
 */

/** 由成员「标记无需回复」引起的迁移：事件行按 no_reply_event 写一行（带它引起的状态），不另写 */
const MARK_EVENTS: ReadonlySet<TicketEvent> = new Set([
  'all_marked_no_reply',
  'undo_mark_no_reply',
]);

type MessageLink = {
  readonly channelMessageId: string;
  readonly receivedAt: Date;
  readonly direction: 'inbound' | 'outbound';
};

/** 状态变更的业务时刻（见文件头） */
function businessTimeOf(
  change: Awaited<ReturnType<typeof listStatusChanges>>[number],
  links: readonly MessageLink[],
): Date {
  const cause = change.channelMessageId
    ? links.find((link) => link.channelMessageId === change.channelMessageId)
    : undefined;
  if (cause) return cause.receivedAt;
  return change.dueAt ?? change.occurredAt;
}

/** 订单卡：工单关联订单的镜像；非美元金额按下单日的汇率折算（当天没有取此前最近一天，E-20） */
async function orderCardOf(
  db: DbExecutor,
  scope: StoreScope,
  row: TicketRow,
): Promise<OrderCard | null> {
  if (!row.orderNumber) return null;
  const store = await findOrderStore(db, scope, row.storeId);
  const order: MirroredOrder | null = store
    ? await findMirroredOrder(db, scope, store, { name: row.orderNumber })
    : null;
  // 工单上的订单号是归并时在镜像里校验过的（镜像只增不删），读不到说明数据不一致：报错，不悄悄写「未关联订单」
  if (!order) throw new Error(`工单 ${row.number} 的订单 ${row.orderNumber} 在订单镜像里读不到`);
  const total = order.total;
  const rate =
    total && total.currency !== 'USD'
      ? await exchangeRateOn(db, total.currency, businessDate(order.placedAt))
      : null;
  return {
    number: row.orderNumber,
    platform: order.platform,
    status: order.status,
    cancelled: order.cancelledAt !== null,
    updatedAt: order.platformUpdatedAt.toISOString(),
    syncedAt: order.syncedAt.toISOString(),
    items: order.lineItems.map((item) => ({ title: item.title, quantity: item.quantity })),
    total: total ? { amount: total.amount, currency: total.currency } : null,
    usd: total && rate ? usdOf(total.amount, rate.rate) : null,
    fulfillmentChannel: order.fulfillmentChannel,
    promisedDeliveryBy: order.promisedDeliveryBy?.toISOString() ?? null,
    shipTo: order.shipAddress
      ? {
          city: order.shipAddress.city,
          province: order.shipAddress.province,
          country: order.shipAddress.country,
        }
      : null,
    tracking: order.tracking.map((t) => ({ company: t.company, number: t.number })),
  };
}

/** 工单详情；row 已按店铺范围取出 */
export async function ticketDetail(
  db: DbExecutor,
  scope: StoreScope,
  row: TicketRow,
  now: Date,
): Promise<TicketDetail> {
  const links = await db
    .select({
      channelMessageId: ticketMessage.channelMessageId,
      direction: ticketMessage.direction,
      receivedAt: ticketMessage.receivedAt,
      channel: ticketMessage.channel,
      autoReply: ticketMessage.autoReply,
      firstReplyAt: ticketMessage.firstReplyAt,
      slaDueAt: ticketMessage.slaDueAt,
      slaResult: ticketMessage.slaResult,
      noReplyByName: ticketMessage.noReplyByName,
      noReplyAt: ticketMessage.noReplyAt,
    })
    .from(ticketMessage)
    .where(eq(ticketMessage.ticketId, row.id))
    .orderBy(asc(ticketMessage.receivedAt), asc(ticketMessage.createdAt));
  const summaries = await listMessageSummaries(
    db,
    scope,
    links.map((l) => l.channelMessageId),
  );
  const changes = await listStatusChanges(db, row.id);
  const marks = await db
    .select()
    .from(noReplyEvent)
    .where(eq(noReplyEvent.ticketId, row.id))
    .orderBy(asc(noReplyEvent.occurredAt), asc(noReplyEvent.id));
  const order = await orderCardOf(db, scope, row);
  const names = await storeNamesById(db, [row.storeId]);
  const byId = new Map(summaries.map((s) => [s.id, s]));

  const messages: TicketMessage[] = links.map((link) => {
    const s = byId.get(link.channelMessageId);
    // 工单里的消息与工单同一个店铺（归并时取的就是来信识别出的店铺，15 指定店铺时一并回填来信的店铺；
    // 我方回复只归到发件邮箱所属店铺的工单），读不到说明数据不一致：报错，不悄悄少给几封
    if (!s) {
      throw new Error(`工单 ${row.number} 的消息 ${link.channelMessageId} 在当前店铺范围里读不到`);
    }
    const common = {
      id: s.id,
      direction: s.direction,
      mailbox: s.mailbox,
      subject: s.subject,
      arrivedAt: s.receivedAt.toISOString(),
      alsoSentTo: [...s.alsoSentTo],
      autoReply: link.autoReply,
      autoReplyHeader: link.autoReply ? s.autoReplyHeader : null,
      firstReplyAt: link.firstReplyAt?.toISOString() ?? null,
      body: s.body,
      noReply:
        link.noReplyByName && link.noReplyAt
          ? { by: link.noReplyByName, at: link.noReplyAt.toISOString() }
          : null,
    };
    if (s.direction === 'outbound') {
      // 我方回复：发件人是店铺邮箱，没有来源、渠道与 SLA
      return { ...common, from: { ...s.from }, source: null, channel: null, sla: null };
    }
    // 工单里的来信都识别过，来源也不会是归档的平台通知与营销
    const recognized = s.recognition;
    if (!recognized || !isTicketSource(recognized.source)) {
      throw new Error(`工单 ${row.number} 的消息 ${s.id} 没有识别结果`);
    }
    const sla =
      link.slaDueAt && link.slaResult
        ? {
            target: slaTargetOf(link.channel ?? recognized.channel),
            dueAt: link.slaDueAt.toISOString(),
            result: link.slaResult,
          }
        : null;
    return {
      ...common,
      from: { name: recognized.sender.name, address: recognized.sender.address },
      source: recognized.source,
      channel: link.channel ?? recognized.channel,
      sla,
    };
  });

  const statusFlow: TicketStatusStep[] = changes.map((change) => ({
    at: businessTimeOf(change, links).toISOString(),
    event: change.event,
    from: change.fromStatus,
    to: change.toStatus,
    trigger: change.trigger,
    actorName: change.actorName,
    closeReason: change.closeReason,
  }));
  const events: TicketTimelineEvent[] = [
    ...changes
      .map((change, i) => ({ change, step: statusFlow[i]! }))
      .filter(({ change }) => !MARK_EVENTS.has(change.event))
      .map(({ step }) => ({ kind: 'status' as const, ...step })),
    ...marks.map((mark) => ({
      kind: 'no_reply' as const,
      at: mark.occurredAt.toISOString(),
      action: mark.action,
      actorName: mark.actorName,
      messageId: mark.channelMessageId,
      to: mark.toStatus,
    })),
    // 按时刻先后；同一时刻的保持上面的先后（状态变更在前）
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const limit = IDLE_LIMITS[row.status];
  const autoClose = limit
    ? {
        at: new Date(
          row.lastInboundAt.getTime() + toMilliseconds({ days: limit.days }),
        ).toISOString(),
        reason: transition(row.status, limit.event, 'system').closeReason!,
      }
    : null;

  const firstInbound = messages.find((m) => m.direction === 'inbound');
  return {
    ticket: toListItem(row, names, await pendingSla(db, row)),
    mailbox: firstInbound?.mailbox ?? messages[0]?.mailbox ?? '',
    now: now.toISOString(),
    autoClose,
    messages,
    events,
    statusFlow,
    order,
  };
}
