import {
  domainOf,
  isArchivedSource,
  slaDueAt,
  ticketSources,
  unassignedNotificationCopy,
  unassignedSlaTarget,
  type Platform,
  type Recipient,
  type Site,
  type UnassignedMail,
} from '@forcome/contracts';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  recordAudit,
  systemActor,
  transaction,
  type Actor,
  type DbExecutor,
  type Logger,
  type Runtime,
  type Tx,
} from '../core';
import { notifyMembers } from '../org';
import { inboundReceivedJob } from './gmail-sync';
import {
  addressesInHeader,
  recipientsOf,
  recognizeInbound,
  storeOfRecipients,
  type MailAddress,
} from './recognition';
import { message, store, storeMailbox } from './schema';
import { loadSenderRules } from './sender-rules';

/*
 * 未归属店铺来信队列（PRD E-13、R-ST-02、P04「第一阶段」、I17、AC-TK-09、AC-TK-11、AC-P1-15、AC-P1-16，待办 15）：
 * - 入队：收件地址都没登记在任何店铺的来信（recognition.ts 的 storeOfRecipients 为空）入库时店铺为空、不发「来信已接收」，
 *   在同一事务里通知客服主管（站内 + 钉钉工作通知，11.4；notifyUnassignedMail）。渠道与来源按发件域暂定（E-13），
 *   平台通知与营销照样归档、不进队列；同一封邮件的其余副本（R-TK-07）本来就不识别店铺，也不进队列。
 * - 队列（listUnassignedMail）：给客服主管看，不受店铺数据范围限制——来信还没有店铺（ADR 0010 修订登记的例外）。
 *   SLA 按原到达时间照常计时，目标按发件域（contracts 的 unassignedSlaTarget）。
 * - 指定店铺（assignStore）：客服主管为一封来信选一个授权店铺（5 秒撤销窗口在前端，窗口结束后才调到这里，D-24）；
 *   自动归位（placeMatchingMail）：管理员新增店铺或给店铺加进线邮箱后（「店铺已变更」），收件地址已登记的来信按同一流程归位。
 *   两者都锁住来信行、确认它还在队列里，按所归店铺重新识别渠道、站点、来源与客户渠道身份（R-ST-02）、写回来信、记审计，
 *   再发「来信已接收」——由 ticket 关联订单并归并成工单，SLA 按原到达时间（来信的 received_at 不变）。
 *   自动归位的在 ticket 归并成工单后通知所归店铺范围内的客服主管（unassigned_mail_placed，只发站内）。
 */

/** 队列里的来信：来信、店铺为空、不是别的邮箱已收过的副本、来源会建工单（客户、生产厂、其他供应商） */
const inQueue = and(
  eq(message.direction, 'inbound'),
  isNull(message.storeId),
  isNull(message.duplicateOfId),
  inArray(message.source, [...ticketSources]),
);

const queueColumns = {
  id: message.id,
  mailbox: message.mailbox,
  fromAddress: message.fromAddress,
  fromName: message.fromName,
  subject: message.subject,
  textBody: message.textBody,
  headers: message.headers,
  receivedAt: message.receivedAt,
  channel: message.channel,
  senderAddress: message.senderAddress,
  senderName: message.senderName,
};

type QueueRow = Awaited<ReturnType<typeof lockQueued>>[number];

/** 客户（I17「来信」一列与通知、审计的写法）：客户渠道身份的显示名，没有写地址 */
function customerOf(
  row: Pick<QueueRow, 'senderAddress' | 'senderName' | 'fromAddress'>,
): MailAddress {
  const address = row.senderAddress ?? row.fromAddress;
  return { address, name: row.senderName || address };
}

/**
 * 识别依据：第一个收件地址与它取自的头字段。入队的来信至少有一个收件地址（没有任何收件地址的信按落到的邮箱识别店铺，
 * 不会入队，见 gmail-sync.ts）；万一没有就写落到的邮箱
 */
function basisOf(row: Pick<QueueRow, 'headers' | 'mailbox'>): Recipient {
  return recipientsOf(row.headers)[0] ?? { header: 'to', address: row.mailbox };
}

/** 入队时通知客服主管（11.4：站内 + 钉钉工作通知，按角色发给全部在职客服主管，来信没有店铺）；回放模式下 notifyMembers 不发 */
export async function notifyUnassignedMail(
  tx: Tx,
  mail: { readonly id: string; readonly customer: MailAddress; readonly basis: Recipient },
): Promise<void> {
  const copy = unassignedNotificationCopy.arrived;
  await notifyMembers(tx, {
    type: 'unassigned_mail',
    title: copy.title,
    body: copy.body(mail.customer.name, mail.basis.address),
    object: { type: 'message', id: mail.id, label: copy.label },
  });
}

/**
 * 队列（I17）：按到达时间倒序（新到的在上，同原型的 10:02 在 09:47 之上）。不按成员的店铺范围过滤——来信还没有店铺，
 * 只给有「指定店铺」能力的接口用（ADR 0010 修订登记的例外）
 */
export async function listUnassignedMail(db: DbExecutor): Promise<UnassignedMail[]> {
  const rows = await db
    .select(queueColumns)
    .from(message)
    .where(inQueue)
    .orderBy(desc(message.receivedAt), desc(message.id));
  return rows.map((row) => ({
    id: row.id,
    customer: customerOf(row),
    subject: row.subject,
    basis: basisOf(row),
    fromDomain: domainOf(row.fromAddress),
    receivedAt: row.receivedAt.toISOString(),
    sla: {
      target: unassignedSlaTarget(row.fromAddress),
      dueAt: slaDueAt(row.receivedAt).toISOString(),
    },
  }));
}

/** 来信归入的店铺：识别要的平台与默认站点，审计与通知写的店铺名 */
export interface PlacementStore {
  readonly id: string;
  readonly name: string;
  readonly platform: Platform;
  readonly defaultSite: Site;
}

const placementStoreColumns = {
  id: store.id,
  name: store.name,
  platform: store.platform,
  defaultSite: store.defaultSite,
};

/** 全部进线邮箱（地址小写）→ 所属店铺：按收件地址识别店铺（入库与自动归位） */
export async function mailboxStores(db: DbExecutor): Promise<Map<string, PlacementStore>> {
  const rows = await db
    .select({ address: storeMailbox.address, ...placementStoreColumns })
    .from(storeMailbox)
    .innerJoin(store, eq(store.id, storeMailbox.storeId));
  return new Map(rows.map(({ address, ...rest }) => [address, rest]));
}

/** 锁住队列里的这些来信（还在队列里的才返回；别人先指定了、已自动归位的不在） */
async function lockQueued(tx: Tx, ids?: readonly string[]) {
  return tx.db
    .select(queueColumns)
    .from(message)
    .where(and(inQueue, ids ? inArray(message.id, [...ids]) : undefined))
    .orderBy(message.receivedAt, message.id)
    .for('update');
}

/**
 * 把一封队列里的来信归入店铺：按所归店铺重新识别（R-ST-02）并写回，记审计，发「来信已接收」交 ticket 归并
 * （重新识别后成了平台通知或营销的只归档，不发）
 */
async function place(
  tx: Tx,
  row: QueueRow,
  target: PlacementStore,
  how: {
    readonly actor: Actor;
    readonly action: 'message.assign_store' | 'message.auto_place';
    readonly autoPlaced: boolean;
  },
  logger: Logger,
): Promise<void> {
  const rules = await loadSenderRules(tx.db);
  const recognized = recognizeInbound(
    {
      from: { address: row.fromAddress, name: row.fromName },
      replyTo: addressesInHeader(row.headers, 'reply-to'),
      text: row.textBody,
      headers: row.headers,
    },
    target,
    rules,
  );
  await tx.db
    .update(message)
    .set({
      storeId: target.id,
      channel: recognized.channel,
      site: recognized.site,
      source: recognized.source,
      senderAddress: recognized.sender.address,
      senderName: recognized.sender.name,
    })
    .where(eq(message.id, row.id));
  const basis = basisOf(row);
  const shared = { recipient: basis.address, recipientHeader: basis.header, subject: row.subject };
  await recordAudit(tx, how.actor, {
    action: how.action,
    objectType: 'message',
    objectId: row.id,
    objectLabel: `${customerOf(row).name} · ${basis.address}`,
    storeId: target.id,
    before: { storeId: null, site: null, channel: row.channel, ...shared },
    after: { storeId: target.id, site: recognized.site, channel: recognized.channel, ...shared },
  });
  if (isArchivedSource(recognized.source)) {
    logger.info(
      { messageId: row.id, store: target.name, source: recognized.source },
      '归入店铺后按该店铺识别为平台通知或营销，已归档，不建工单',
    );
    return;
  }
  await tx.enqueue(inboundReceivedJob, {
    messageId: row.id,
    ...(how.autoPlaced ? { autoPlaced: true } : {}),
  });
}

/**
 * 指定店铺的结果：归入的店铺；来信已不在队列里（别人先指定了、已自动归位，或没有这封）为 not_in_queue，带它已归入的店铺；
 * 没有这个店铺为 unknown_store
 */
export type AssignStoreOutcome =
  | { readonly kind: 'placed'; readonly store: PlacementStore }
  | { readonly kind: 'not_in_queue'; readonly storeName: string | null }
  | { readonly kind: 'unknown_store' };

export async function assignStore(
  runtime: Runtime,
  input: { readonly actor: Actor; readonly messageId: string; readonly storeId: string },
  logger: Logger,
): Promise<AssignStoreOutcome> {
  return transaction(runtime, async (tx) => {
    const [target] = await tx.db
      .select(placementStoreColumns)
      .from(store)
      .where(eq(store.id, input.storeId))
      .limit(1);
    if (!target) return { kind: 'unknown_store' };
    const [row] = await lockQueued(tx, [input.messageId]);
    if (!row) {
      // 别人先指定了或已自动归位：告诉客服主管它归入了哪个店铺
      const [placed] = await tx.db
        .select({ storeName: store.name })
        .from(message)
        .leftJoin(store, eq(store.id, message.storeId))
        .where(eq(message.id, input.messageId))
        .limit(1);
      return { kind: 'not_in_queue', storeName: placed?.storeName ?? null };
    }
    await place(
      tx,
      row,
      target,
      { actor: input.actor, action: 'message.assign_store', autoPlaced: false },
      logger,
    );
    logger.info({ messageId: row.id, store: target.name }, '未归属来信已指定店铺');
    return { kind: 'placed', store: target };
  });
}

/**
 * 自动归位（「店铺已变更」的处理器，AC-P1-16）：队列里收件地址已登记为进线邮箱的来信，按收件地址识别出的店铺归位
 * （同 storeOfRecipients：第一个登记过的收件地址）。不只看这次新登记的地址——漏处理过的事件也能在下一次变更时补上
 */
export async function placeMatchingMail(runtime: Runtime, logger: Logger): Promise<number> {
  return transaction(runtime, async (tx) => {
    const rows = await lockQueued(tx);
    if (rows.length === 0) return 0;
    const stores = await mailboxStores(tx.db);
    let placed = 0;
    for (const row of rows) {
      const hit = storeOfRecipients(recipientsOf(row.headers), stores);
      if (!hit) continue;
      await place(
        tx,
        row,
        hit.store,
        { actor: systemActor, action: 'message.auto_place', autoPlaced: true },
        logger,
      );
      placed += 1;
      logger.info(
        { messageId: row.id, store: hit.store.name, address: hit.address },
        '未归属来信已自动归位',
      );
    }
    return placed;
  });
}
