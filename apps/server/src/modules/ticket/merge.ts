import { isTicketSource } from '@forcome/contracts';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { findInboundMessage } from '../channel';
import {
  advisoryLock,
  nextBusinessNumber,
  storeScopeCondition,
  SYSTEM_STORE_SCOPE,
  systemActor,
  transaction,
  updateWithVersion,
  type JobContext,
  type StoreScope,
  type Tx,
} from '../core';
import { customer, customerIdentity, ticket, ticketMessage } from './schema';
import { applyTransition, createTicket } from './ticket-status';

/*
 * 归并（规格 ticket「归并」，PRD R-TK-02、6.1 第一阶段迁移表；处理 channel 的「来信已接收」）：
 * 无订单号的来信——同一店铺、同一客户渠道身份有未关闭的无订单工单则追加，否则新建「待回复」工单。
 * 客户渠道身份、渠道、站点、来源都在 channel 入库时识别好（亚马逊中转地址、Shopify 联系表单的回复邮箱，待办 10）；
 * 生产厂与其他供应商的来信照常归并、建工单，工单的来源取首封来信的来源，追加不改（11.1 Ticket）。
 * 在事务内按「店铺 + 客户渠道身份」取 pg_advisory_xact_lock 后再查再写，并发到达的同一客户来信不会各建一张；
 * 任务幂等：一封信只归并一次（工单消息按邮件 id 唯一），重跑结果不变。
 * 带订单号的来信按 R-TK-01 追加、重开或新建随 14；未归属店铺的来信进队列随 15。
 */

async function alreadyMerged(tx: Tx, channelMessageId: string): Promise<boolean> {
  const [row] = await tx.db
    .select({ id: ticketMessage.id })
    .from(ticketMessage)
    .where(eq(ticketMessage.channelMessageId, channelMessageId))
    .limit(1);
  return Boolean(row);
}

/**
 * 客户渠道身份对应的客户，没有就建（第一期一个身份就是一个客户）。按身份地址加锁后再查再写：
 * 同一个新客户的几封信同时归并时只建一个客户。
 */
async function customerOf(tx: Tx, sender: { address: string; name: string }): Promise<string> {
  const { address } = sender;
  await advisoryLock(tx, `ticket.customer:${address}`);
  const [identity] = await tx.db
    .select({ customerId: customerIdentity.customerId })
    .from(customerIdentity)
    .where(eq(customerIdentity.address, address))
    .limit(1);
  if (identity) return identity.customerId;
  const [created] = await tx.db
    .insert(customer)
    .values({ name: sender.name || address, createdAt: tx.now })
    .returning({ id: customer.id });
  if (!created) throw new Error('客户创建失败');
  await tx.db
    .insert(customerIdentity)
    .values({ customerId: created.id, address, createdAt: tx.now });
  return created.id;
}

/** R-TK-02：同店铺同客户的未关闭无订单工单（取最近来信的一张），锁住它再追加 */
async function openTicketWithoutOrder(
  tx: Tx,
  scope: StoreScope,
  storeId: string,
  customerId: string,
): Promise<typeof ticket.$inferSelect | null> {
  const [open] = await tx.db
    .select()
    .from(ticket)
    .where(
      and(
        storeScopeCondition(scope, ticket.storeId),
        eq(ticket.storeId, storeId),
        eq(ticket.customerId, customerId),
        isNull(ticket.orderNumber),
        ne(ticket.status, 'closed'),
      ),
    )
    .orderBy(desc(ticket.lastInboundAt))
    .limit(1)
    .for('update');
  return open ?? null;
}

/** 把一封来信归并成工单（「来信已接收」的处理器；系统操作，不受店铺范围限制） */
export async function mergeInbound(
  { messageId }: { messageId: string },
  { runtime, logger }: JobContext,
): Promise<void> {
  const mail = await findInboundMessage(runtime.db, SYSTEM_STORE_SCOPE, messageId);
  if (!mail) throw new Error(`没有这封来信：${messageId}`);
  if (mail.direction !== 'inbound' || mail.duplicateOfId) {
    logger.warn({ messageId }, '不是要归并的来信，跳过');
    return;
  }
  const { storeId, recognition } = mail;
  if (!storeId || !recognition) {
    // 未归属店铺的来信队列随 15 号待办
    logger.warn({ messageId }, '来信没有识别出店铺，暂不归并');
    return;
  }
  const { channel, site, source, sender } = recognition;
  if (!isTicketSource(source)) {
    // channel 不会为归档的来信发「来信已接收」；万一收到也不建工单
    logger.warn({ messageId, source }, '平台通知或营销邮件已归档，不归并');
    return;
  }
  // 客户渠道身份：亚马逊中转地址、Shopify 联系表单的回复邮箱，其余为发件地址（channel 识别，R-TK-08）
  if (!sender.address) {
    logger.warn({ messageId }, '来信没有客户渠道身份（发件地址），无法确定客户，暂不归并');
    return;
  }

  await transaction(runtime, async (tx) => {
    if (await alreadyMerged(tx, messageId)) return;
    const customerId = await customerOf(tx, sender);
    await advisoryLock(tx, `ticket.merge:${storeId}:customer:${sender.address}`);
    // 加锁后再查一次：同一封信的归并任务可能被重复执行
    if (await alreadyMerged(tx, messageId)) return;

    const open = await openTicketWithoutOrder(tx, SYSTEM_STORE_SCOPE, storeId, customerId);
    let target: { id: string; number: string };
    if (open) {
      // 追加（R-TK-02）：状态按迁移表变化（待回复保持待回复），最近来信取较晚的一封（来信可能乱序到达）
      const current = await applyTransition(tx, open, 'inbound', systemActor);
      const latest =
        mail.receivedAt > current.lastInboundAt ? mail.receivedAt : current.lastInboundAt;
      target = await updateWithVersion(tx, ticket, current, {
        lastInboundAt: latest,
        updatedAt: tx.now,
      });
    } else {
      const created = await createTicket(
        tx,
        {
          number: await nextBusinessNumber(tx, 'ticket', mail.receivedAt),
          storeId,
          channel,
          site,
          source,
          customerId,
          subject: mail.subject,
          orderNumber: null,
          firstInboundAt: mail.receivedAt,
          lastInboundAt: mail.receivedAt,
        },
        'inbound',
        systemActor,
      );
      target = created;
    }

    await tx.db.insert(ticketMessage).values({
      ticketId: target.id,
      channelMessageId: messageId,
      direction: 'inbound',
      receivedAt: mail.receivedAt,
      createdAt: tx.now,
    });
    logger.info(
      { messageId, ticket: target.number, appended: Boolean(open) },
      open ? '来信已追加到工单' : '来信已新建工单',
    );
  });
}
