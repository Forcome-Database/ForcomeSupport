import { addDays, businessDate } from '@forcome/calendar';
import {
  isTicketSource,
  siteSchema,
  unassignedNotificationCopy,
  type Site,
} from '@forcome/contracts';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { findInboundMessage, findOrderStore, type InboundMessage } from '../channel';
import {
  advisoryLock,
  nextBusinessNumber,
  storeScopeCondition,
  SYSTEM_STORE_SCOPE,
  systemActor,
  transaction,
  updateWithVersion,
  type JobContext,
  type Runtime,
  type StoreScope,
  type Tx,
} from '../core';
import { ExternalServiceError, type IntegrationClients } from '../integration';
import { notifyMembers } from '../org';
import {
  findOrder,
  findOrdersByEmail,
  orderNumberOf,
  type MirroredOrder,
  type OrderStore,
} from '../order';
import { ticketsChanged } from './changes';
import { lockReplyLinks, retryWaitingReplies } from './replies';
import { customer, customerIdentity, ticket, ticketMessage } from './schema';
import { firstReplyAfter, inboundSlaColumns } from './sla';
import { applyTransition, closedTimes, createTicket } from './ticket-status';

/*
 * 归并（规格 ticket「归并」，PRD R-TK-01、R-TK-02、R-ST-02、6.1 第一阶段迁移表；处理 channel 的「来信已接收」）：
 * 1. 关联订单（事务外，可能要去平台补拉）：channel 按店铺平台从主题与正文抽出候选订单号（亚马逊 3-7-7、Shopify 订单名），
 *    逐个交 order 在该店铺内校验，镜像没有时按需补拉；第一个查得到的即这封信的订单。查不到的候选不算，按抽不到处理
 *    （协调者 2026-10-07 决定）。抽不到时 Shopify 店铺按客户渠道身份（邮箱）在该店铺反查镜像，唯一命中才关联；亚马逊读不到买家邮箱，不反查。
 * 2. 有订单（R-TK-01）：同店铺同订单有未关闭工单则追加；有 30 天内关闭的则重开为待回复（取最近关闭的那张）；否则新建。
 *    无订单（R-TK-02）：同店铺同客户渠道身份有未关闭的无订单工单则追加，否则新建。
 * 3. 新建的工单站点：Shopify 店铺关联到订单时按订单收件国家（不是 US / CA / MX 时取识别出的站点，即店铺默认站点）；
 *    其余取 channel 识别出的站点（亚马逊按发件域）。工单的来源取首封来信，追加与重开都不改（11.1 Ticket）。
 * 4. 回复与 SLA（R-SL-08，16）：来信记来源、渠道与首次回复，应回复来信（来源为客户）另记 SLA 截止与结果（sla.ts）。
 *    晚到的来信若早于工单里已归属的我方回复，按 internalDate 判为已被该回复结束计时：它不是未回复来信，追加时状态不变；
 *    其余追加按迁移表（等客户、已解决 → 待回复）。状态变更记下触发的来信（工单量只计客户来信触发的新建与重开）。
 *    归并后找等着这封来信的我方回复（回复先于来信入库），排任务重新识别（replies.ts）。
 * 在事务内先取客户身份锁（建客户），再按「店铺 + 订单号」或「店铺 + 客户渠道身份」取 pg_advisory_xact_lock，再取回复识别的
 * 咨询锁（这封信的 Message-ID 与线程，与回复识别互斥），最后锁工单行，加锁后再查再写；顺序固定、不会互相等死；
 * 同一订单或同一客户的几封信同时归并只建一张工单。
 * 任务幂等：一封信只归并一次（工单消息按邮件 id 唯一），重跑结果不变。补拉的外部调用失败时任务失败、稍后重试；
 * 最后一次尝试仍失败就不再等这个候选（按查不到处理），照常归并——来信不能因订单平台连不上而一直不成工单。
 * 未归属店铺的来信（E-13）由 channel 留在队列里、不发「来信已接收」；客服主管指定店铺或登记新店铺自动归位后（待办 15），channel
 * 已按所归店铺重新识别并发出「来信已接收」，这里照常归并（R-ST-02），SLA 按来信原到达时间。自动归位的（autoPlaced）归并后在同一事务里
 * 通知所归店铺范围内的客服主管（11.4「登记新店铺后来信自动归位」，只发站内），任务重跑时已归并的直接返回、不会重复通知。
 */

/** R-TK-01、R-TK-05：关闭后 30 天内（按北京时间的日期，关闭日之后的第 30 天整天都算）同一订单来信重开，超过新建 */
const REOPEN_WITHIN_DAYS = 30;

type TicketRow = typeof ticket.$inferSelect;

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

/** 新建工单的站点（R-ST-02）：Shopify 店铺按订单收件国家，收件国家不是我们的站点时取识别出的站点 */
function siteOf(store: OrderStore, order: MirroredOrder | null, recognized: Site): Site {
  if (store.platform !== 'shopify' || !order?.shipCountry) return recognized;
  const country = siteSchema.safeParse(order.shipCountry.toUpperCase());
  return country.success ? country.data : recognized;
}

/**
 * 在该店铺内按一个候选订单号找订单（order 的 findOrder：先查镜像，没有时按需补拉）。补拉的外部调用失败照常抛出、任务稍后重试；
 * 最后一次尝试时不再抛，记日志后按查不到处理
 */
async function verifiedOrder(
  runtime: Runtime,
  clients: IntegrationClients,
  store: OrderStore,
  candidate: string,
  { lastAttempt, logger }: Pick<JobContext, 'lastAttempt' | 'logger'>,
): Promise<MirroredOrder | null> {
  try {
    return await findOrder(runtime, clients, SYSTEM_STORE_SCOPE, store, { name: candidate });
  } catch (error) {
    if (!(error instanceof ExternalServiceError) || !lastAttempt) throw error;
    logger.warn(
      { err: error, store: store.name, candidate },
      '订单平台一直连不上，最后一次尝试不再等这个订单号，按查不到处理',
    );
    return null;
  }
}

/** 这封信关联的订单（见文件头第 1 点）；没有为 null */
async function linkedOrder(
  runtime: Runtime,
  clients: IntegrationClients,
  store: OrderStore,
  mail: InboundMessage & { readonly recognition: NonNullable<InboundMessage['recognition']> },
  context: Pick<JobContext, 'lastAttempt' | 'logger'>,
): Promise<MirroredOrder | null> {
  for (const candidate of mail.orderNumbers) {
    const order = await verifiedOrder(runtime, clients, store, candidate, context);
    if (order) return order;
  }
  if (store.platform !== 'shopify') return null;
  const byEmail = await findOrdersByEmail(runtime.db, SYSTEM_STORE_SCOPE, {
    storeId: store.id,
    email: mail.recognition.sender.address,
  });
  return byEmail.length === 1 ? byEmail[0]! : null;
}

/** 归并到哪：追加到未关闭的工单、重开 30 天内关闭的工单，或新建 */
type Target =
  | { readonly kind: 'append'; readonly ticket: TicketRow }
  | { readonly kind: 'reopen'; readonly ticket: TicketRow }
  | { readonly kind: 'create' };

/** R-TK-01：同店铺同订单的工单（锁住）→ 追加、重开或新建 */
async function targetForOrder(
  tx: Tx,
  scope: StoreScope,
  storeId: string,
  orderNumber: string,
  receivedAt: Date,
): Promise<Target> {
  const rows = await tx.db
    .select()
    .from(ticket)
    .where(
      and(
        storeScopeCondition(scope, ticket.storeId),
        eq(ticket.storeId, storeId),
        eq(ticket.orderNumber, orderNumber),
      ),
    )
    .orderBy(desc(ticket.lastInboundAt), desc(ticket.number))
    .for('update');
  const open = rows.find((row) => row.status !== 'closed');
  if (open) return { kind: 'append', ticket: open };
  const closedAt = await closedTimes(tx, rows);
  let latest: { row: TicketRow; at: Date } | null = null;
  for (const row of rows) {
    const at = closedAt.get(row.id)!;
    if (!latest || at > latest.at) latest = { row, at };
  }
  // 按到达日期与关闭日期（北京时间，规格「日界按 Asia/Shanghai」）比：关闭日之后第 30 天当天任何时刻到的都重开。
  // 来信也可能在关闭前到达、晚于关闭才同步进来，同样重开
  if (latest && businessDate(receivedAt) <= addDays(businessDate(latest.at), REOPEN_WITHIN_DAYS)) {
    return { kind: 'reopen', ticket: latest.row };
  }
  return { kind: 'create' };
}

/** R-TK-02：同店铺同客户的未关闭无订单工单（取最近来信的一张，锁住）→ 追加或新建 */
async function targetForCustomer(
  tx: Tx,
  scope: StoreScope,
  storeId: string,
  customerId: string,
): Promise<Target> {
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
  return open ? { kind: 'append', ticket: open } : { kind: 'create' };
}

const MERGED_LOG: Record<Target['kind'], string> = {
  append: '来信已追加到工单',
  reopen: '来信已重开工单',
  create: '来信已新建工单',
};

/** 把一封来信归并成工单（「来信已接收」的处理器；系统操作，不受店铺范围限制） */
export async function mergeInbound(
  clients: IntegrationClients,
  { messageId, autoPlaced }: { messageId: string; autoPlaced?: { address: string } | undefined },
  context: JobContext,
): Promise<void> {
  const { runtime, logger } = context;
  const mail = await findInboundMessage(runtime.db, SYSTEM_STORE_SCOPE, messageId);
  if (!mail) throw new Error(`没有这封来信：${messageId}`);
  if (mail.direction !== 'inbound' || mail.duplicateOfId) {
    logger.warn({ messageId }, '不是要归并的来信，跳过');
    return;
  }
  const { storeId, recognition } = mail;
  if (!storeId || !recognition) {
    // 未归属店铺的来信留在队列里（channel 不会为它发「来信已接收」），指定店铺或自动归位后才归并
    logger.warn({ messageId }, '来信没有识别出店铺，暂不归并');
    return;
  }
  // 以上与下面的识别结果、客户渠道身份几条，是 channel 的 listMergeableInboundIds 的条件（按时关闭等「要归并的来信」，待办 33），改一处要改另一处
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
  const store = await findOrderStore(runtime.db, SYSTEM_STORE_SCOPE, storeId);
  if (!store) throw new Error(`来信 ${messageId} 的店铺 ${storeId} 不在了`);
  // 已归并过的（任务重跑）不再去查订单、补拉
  if (await transaction(runtime, (tx) => alreadyMerged(tx, messageId))) return;

  const order = await linkedOrder(runtime, clients, store, { ...mail, recognition }, context);
  const orderNumber = order ? orderNumberOf(order) : null;

  await transaction(runtime, async (tx) => {
    if (await alreadyMerged(tx, messageId)) return;
    const customerId = await customerOf(tx, sender);
    await advisoryLock(
      tx,
      orderNumber
        ? `ticket.merge:${storeId}:order:${orderNumber}`
        : `ticket.merge:${storeId}:customer:${sender.address}`,
    );
    // 加锁后再查一次：同一封信的归并任务可能被重复执行
    if (await alreadyMerged(tx, messageId)) return;
    // 与回复识别互斥（回复先于来信入库时它在等这封信），要在锁工单行之前取
    await lockReplyLinks(tx, {
      messageIds: [mail.rfcMessageId],
      mailbox: mail.mailbox,
      gmailThreadId: mail.gmailThreadId,
    });

    const target = orderNumber
      ? await targetForOrder(tx, SYSTEM_STORE_SCOPE, storeId, orderNumber, mail.receivedAt)
      : await targetForCustomer(tx, SYSTEM_STORE_SCOPE, storeId, customerId);
    const cause = { messageId };
    let merged: { id: string; number: string };
    // 工单里已有、晚于这封信的第一封我方回复（乱序时才有）：有就说明它已被回复，不是未回复来信
    let firstReplyAt: Date | null = null;
    if (target.kind === 'create') {
      merged = await createTicket(
        tx,
        {
          number: await nextBusinessNumber(tx, 'ticket', mail.receivedAt),
          storeId,
          channel,
          site: siteOf(store, order, site),
          source,
          customerId,
          subject: mail.subject,
          orderNumber,
          firstInboundAt: mail.receivedAt,
          lastInboundAt: mail.receivedAt,
        },
        'inbound',
        systemActor,
        cause,
      );
    } else {
      // 追加（待回复保持待回复，等客户、已解决回到待回复）或重开（已关闭 → 待回复）：状态按迁移表变化；
      // 已被回复的晚到来信不是未回复来信（1.4），状态不变——追加不迁移，已关闭的也不重开、只归进这张工单。
      // 最近来信取较晚的一封（来信可能乱序到达）
      firstReplyAt = await firstReplyAfter(tx, target.ticket.id, mail.receivedAt);
      const current = firstReplyAt
        ? target.ticket
        : await applyTransition(
            tx,
            target.ticket,
            target.kind === 'reopen' ? 'inbound_reopen' : 'inbound',
            systemActor,
            cause,
          );
      const latest =
        mail.receivedAt > current.lastInboundAt ? mail.receivedAt : current.lastInboundAt;
      merged = await updateWithVersion(tx, ticket, current, {
        lastInboundAt: latest,
        updatedAt: tx.now,
      });
    }

    await tx.db.insert(ticketMessage).values({
      ticketId: merged.id,
      channelMessageId: messageId,
      direction: 'inbound',
      receivedAt: mail.receivedAt,
      source,
      channel,
      ...inboundSlaColumns({
        source,
        receivedAt: mail.receivedAt,
        firstReplyAt,
        now: tx.now,
      }),
      createdAt: tx.now,
    });
    await ticketsChanged(tx);
    await retryWaitingReplies(tx, mail);
    if (autoPlaced) {
      const copy = unassignedNotificationCopy.placed;
      await notifyMembers(tx, {
        type: 'unassigned_mail_placed',
        title: copy.title,
        body: copy.body(sender.name || sender.address, autoPlaced.address, store.name),
        object: { type: 'ticket', id: merged.number, label: merged.number },
        storeId,
      });
    }
    logger.info(
      {
        messageId,
        ticket: merged.number,
        orderNumber,
        merged: target.kind,
        answered: !!firstReplyAt,
      },
      firstReplyAt ? '已被回复的晚到来信归进工单，状态不变' : MERGED_LOG[target.kind],
    );
  });
}
