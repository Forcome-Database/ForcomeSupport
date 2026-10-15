import {
  isArchivedSource,
  type AdapterMode,
  type MailProvider,
  type MessageDirection,
  type Platform,
  type Site,
} from '@forcome/contracts';
import { and, eq, isNull, not, sql } from 'drizzle-orm';
import type { Address, Email } from 'postal-mime';
import { advisoryLock, transaction, type DbExecutor, type Logger, type Runtime } from '../core';
import { ClientNotConfiguredError, ExternalServiceError } from '../integration';
import { inboundReceivedJob, outboundSyncedJob } from './events';
import { listening, recordMailboxFailure, type SyncedMail } from './mailbox-health';
import {
  provisionalStore,
  recipientsOf,
  recognizeInbound,
  storeForMail,
  type MailAddress,
  type SenderRule,
} from './recognition';
import { mailboxSync, message, store, storeMailbox } from './schema';
import { customerOf, mailboxStores, notifyUnassignedMail, type PlacementStore } from './unassigned';

/*
 * 收信的公共部分（规格 channel「去重」「店铺与站点识别」，ADR 0015）：服务商只到「取信」为止——Gmail（gmail-sync.ts）与
 * 163 企业邮箱 IMAP（imap-sync.ts）取到的每封信的原文（RFC 822）都在这里解析后的同一段路径入库：去重 → 店铺与来源识别 →
 * 「来信已接收」/「我方发信已同步」事件（或未归属店铺队列、归档）。之后的归并、回复识别、SLA、时限扫描与报表不知道信来自哪个服务商。
 * 同步失败记进同步记录（mailbox-health.ts）的口径两边相同。
 */

/** 一个进线邮箱与它所属的店铺（按店铺的数据来源取客户端）；163 企业邮箱另有 IMAP 服务器与端口 */
export interface MailboxTarget {
  readonly address: string;
  readonly provider: MailProvider;
  readonly imapHost: string | null;
  readonly imapPort: number | null;
  readonly storeId: string;
  readonly adapterMode: AdapterMode;
  readonly platform: Platform;
  readonly defaultSite: Site;
}

const mailboxTargetColumns = {
  address: storeMailbox.address,
  provider: storeMailbox.provider,
  imapHost: storeMailbox.imapHost,
  imapPort: storeMailbox.imapPort,
  storeId: store.id,
  adapterMode: store.adapterMode,
  platform: store.platform,
  defaultSite: store.defaultSite,
};

/**
 * 进线邮箱与所属店铺（按地址排序）：可只取某个地址、某种服务商，或只取已开始监听 / 还没开始监听的
 */
export async function mailboxTargets(
  db: DbExecutor,
  filter: {
    readonly address?: string;
    readonly provider?: MailProvider;
    readonly watched?: boolean;
  } = {},
): Promise<MailboxTarget[]> {
  const watched =
    filter.watched === undefined ? undefined : filter.watched ? listening : not(listening);
  return db
    .select(mailboxTargetColumns)
    .from(storeMailbox)
    .innerJoin(store, eq(store.id, storeMailbox.storeId))
    .leftJoin(mailboxSync, eq(mailboxSync.address, storeMailbox.address))
    .where(
      and(
        filter.address ? eq(storeMailbox.address, filter.address) : undefined,
        filter.provider ? eq(storeMailbox.provider, filter.provider) : undefined,
        watched,
      ),
    )
    .orderBy(storeMailbox.address);
}

export async function mailboxTarget(
  db: DbExecutor,
  address: string,
): Promise<MailboxTarget | null> {
  return (await mailboxTargets(db, { address }))[0] ?? null;
}

/**
 * 外部调用的失败记进同步记录（连续 3 次为连接异常）。我们自己的错误不算；没配置凭据也不算（还没接通，6.9 的「未连接」）。
 * 记录本身出错只记日志，不盖掉原来的错误（调用方照常抛原错误）
 */
export async function noteFailure(
  runtime: Runtime,
  target: Pick<MailboxTarget, 'address' | 'provider'>,
  error: unknown,
  logger: Logger,
): Promise<void> {
  if (!(error instanceof ExternalServiceError) || error instanceof ClientNotConfiguredError) {
    return;
  }
  try {
    const failures = await recordMailboxFailure(runtime, target.address, target.provider, error);
    logger.warn(
      { err: error, mailbox: target.address, provider: target.provider, failures },
      '邮箱调用失败，已记入同步记录',
    );
  } catch (recordError) {
    logger.error({ err: recordError, mailbox: target.address }, '记同步失败时出错');
  }
}

/** 地址列表展开成小写地址（含地址组的成员） */
function addressesOf(list: readonly Address[] | undefined): string[] {
  return (list ?? []).flatMap((a) =>
    a.group ? a.group.map((m) => m.address.toLowerCase()) : [a.address.toLowerCase()],
  );
}

/** 地址列表里的第一个（地址组取第一个成员），地址小写；没有为空串 */
export function firstMailbox(address: Address | undefined): MailAddress {
  const mailbox = address?.group ? address.group[0] : address;
  return { name: mailbox?.name.trim() ?? '', address: mailbox?.address.trim().toLowerCase() ?? '' };
}

/** 地址列表展开成「地址 + 显示名」（含地址组的成员；Reply-To 用） */
function mailboxesOf(list: readonly Address[] | undefined): MailAddress[] {
  return (list ?? []).flatMap((a) => (a.group ?? [a]).map((m) => firstMailbox(m)));
}

/** References 等头里的 Message-ID 列表（各自带尖括号） */
function messageIds(value: string | undefined): string[] {
  return value?.match(/<[^<>\s]+>/g) ?? [];
}

/** 头里的第一个 Message-ID（带尖括号）；没有为 null */
export function messageIdOf(value: string | undefined): string | null {
  return messageIds(value)[0] ?? null;
}

/** 一封邮件入库的结果：新的一封、别的邮箱已收过的同一封（只记「同时发送到」）、同一邮箱里重复投递的（丢弃） */
export type IngestResult = 'created' | 'copy' | 'duplicate';

/**
 * 一封邮件取原文、解析、入库的结果：入库了（见 IngestResult，带方向与到达时间），或没有入库——库里已有（stored，重复投递；
 * 163 企业邮箱还包括 UIDVALIDITY 变了以后重新取到的同一封）、服务商那里已不存在（gone）、草稿或垃圾邮件（skipped）
 */
export type MailOutcome =
  | {
      readonly result: IngestResult;
      readonly direction: MessageDirection;
      readonly internalDate: Date;
    }
  | { readonly result: 'stored' | 'gone' | 'skipped' };

/** 服务商取到的一封信：服务商的消息标识、线程（只有 Gmail 有）、到达时间 */
export interface FetchedMail {
  readonly providerMessageId: string;
  readonly threadId: string | null;
  readonly internalDate: Date;
}

/** 这一封（按「邮箱 + 服务商消息标识」）是否已经入库 */
export async function isStored(
  db: DbExecutor,
  mailbox: string,
  providerMessageId: string,
): Promise<boolean> {
  const [stored] = await db
    .select({ id: message.id })
    .from(message)
    .where(and(eq(message.mailbox, mailbox), eq(message.providerMessageId, providerMessageId)))
    .limit(1);
  return stored !== undefined;
}

/**
 * 一封邮件入库（规格 channel「去重」，R-TK-07、E-15），返回是否新入库：
 * - 同一邮箱里同一个服务商消息标识只入库一次（唯一约束，冲突即视为重复、丢弃并记日志）；
 * - 同方向、Message-ID 相同的信已在别的店铺邮箱入库：只记「同时发送到」，不识别店铺、不发事件；
 * - 来信：按收件地址识别店铺（recognition.ts 的 storeForMail，R-ST-02：写给落到的店铺邮箱的按它，否则 Delivered-To、To、Cc 里
 *   第一个登记过的进线邮箱，一个收件地址都没有的信按落到的邮箱），
 *   识别渠道、站点、来源与客户渠道身份（recognition.ts）；来源是平台通知或营销的只入库归档（PRD 1.4），
 *   其余识别出店铺的在同一事务里发出「来信已接收」，识别不出的进未归属店铺队列并通知客服主管（E-13，unassigned.ts）；
 * - 我方发出（「已发送」）：店铺就是发件邮箱的店铺，不识别来源；在同一事务里发出「我方发信已同步」（ticket 识别回复，16）。
 */
export async function ingestMessage(
  runtime: Runtime,
  target: MailboxTarget,
  rules: readonly SenderRule[],
  mail: FetchedMail,
  parsed: Email,
  direction: MessageDirection,
  logger: Logger,
): Promise<IngestResult> {
  const rfcMessageId = messageIdOf(parsed.messageId);
  const from = firstMailbox(parsed.from);
  const headers = parsed.headers.map((h) => ({ key: h.key, value: h.value }));
  return transaction(runtime, async (tx) => {
    if (rfcMessageId) {
      // 同一封邮件的几份副本可能同时在几个邮箱入库：按 Message-ID 串行，最早入库的一封为准
      await advisoryLock(tx, `channel.rfc_message_id:${rfcMessageId}`);
    }
    const [canonical] = rfcMessageId
      ? await tx.db
          .select({ id: message.id, mailbox: message.mailbox, alsoSentTo: message.alsoSentTo })
          .from(message)
          .where(
            and(
              eq(message.direction, direction),
              eq(message.rfcMessageId, rfcMessageId),
              isNull(message.duplicateOfId),
            ),
          )
          .limit(1)
      : [];
    // 同一封邮件的其余副本不识别（R-TK-07：只按最早收到的一封识别店铺并归并）；我方发出的不识别来源
    const inbound = !canonical && direction === 'inbound';
    // Delivered-To 里落到的邮箱自己不算收件地址（Gmail 可能把同步的邮箱写进去，寄到别名、群组或转发地址的信就认不出来了）
    const recipients = recipientsOf(headers, target.address);
    // 进线邮箱在事务里读：管理员刚登记的邮箱，这一轮同步后面的信就能认出来
    const mailboxes = inbound ? await mailboxStores(tx.db) : new Map<string, PlacementStore>();
    // 店铺按收件地址（recognition.ts 的 storeForMail）
    const own = { id: target.storeId, platform: target.platform, defaultSite: target.defaultSite };
    const recognizedStore: Pick<PlacementStore, 'id' | 'platform' | 'defaultSite'> | null = inbound
      ? storeForMail(recipients, { address: target.address, store: own }, mailboxes)
      : null;
    const recognized = inbound
      ? recognizeInbound(
          { from, replyTo: mailboxesOf(parsed.replyTo), text: parsed.text ?? null, headers },
          // 未归属店铺：渠道与来源按发件域暂定（E-13），站点等有了店铺再定
          recognizedStore ?? provisionalStore(from),
          rules,
        )
      : null;
    const [row] = await tx.db
      .insert(message)
      .values({
        mailbox: target.address,
        providerMessageId: mail.providerMessageId,
        threadId: mail.threadId,
        direction,
        rfcMessageId,
        inReplyTo: messageIdOf(parsed.inReplyTo),
        references: messageIds(parsed.references),
        fromAddress: from.address,
        fromName: from.name,
        toAddresses: addressesOf(parsed.to),
        subject: parsed.subject?.trim() ?? '',
        textBody: parsed.text ?? null,
        htmlBody: parsed.html ?? null,
        headers,
        receivedAt: mail.internalDate,
        storeId:
          recognizedStore?.id ?? (direction === 'outbound' && !canonical ? target.storeId : null),
        channel: recognized?.channel ?? null,
        site: recognizedStore ? (recognized?.site ?? null) : null,
        source: recognized?.source ?? null,
        senderAddress: recognized?.sender.address ?? null,
        senderName: recognized?.sender.name ?? null,
        duplicateOfId: canonical?.id ?? null,
        createdAt: tx.now,
      })
      .onConflictDoNothing({ target: [message.mailbox, message.providerMessageId] })
      .returning({ id: message.id });
    if (!row) {
      logger.info(
        { mailbox: target.address, providerMessageId: mail.providerMessageId },
        '重复消息，已丢弃（E-15）',
      );
      return 'duplicate';
    }
    if (canonical) {
      const seen = [canonical.mailbox, ...canonical.alsoSentTo];
      if (!seen.includes(target.address)) {
        await tx.db
          .update(message)
          .set({ alsoSentTo: sql`array_append(${message.alsoSentTo}, ${target.address})` })
          .where(eq(message.id, canonical.id));
      }
      logger.info(
        { mailbox: target.address, rfcMessageId, canonicalId: canonical.id },
        '同一封邮件已在别的邮箱收到，只记「同时发送到」（R-TK-07）',
      );
      return 'copy';
    }
    if (direction === 'outbound') {
      await tx.enqueue(outboundSyncedJob, { messageId: row.id });
      logger.info({ mailbox: target.address, messageId: row.id }, '「已发送」的我方回信已入库');
      return 'created';
    }
    if (recognized && isArchivedSource(recognized.source)) {
      logger.info(
        { mailbox: target.address, messageId: row.id, source: recognized.source },
        '平台通知或营销邮件，已归档，不建工单',
      );
      return 'created';
    }
    if (recognized && !recognizedStore) {
      await notifyUnassignedMail(tx, {
        id: row.id,
        customer: customerOf(recognized.sender),
        basis: recipients[0]!,
      });
      logger.info(
        { mailbox: target.address, messageId: row.id, recipient: recipients[0]?.address },
        '收件地址都没登记在店铺，进未归属店铺队列（E-13）',
      );
      return 'created';
    }
    await tx.enqueue(inboundReceivedJob, { messageId: row.id });
    return 'created';
  });
}

/** 累计这次同步新入库的来信（几封、到达时间的起止），恢复通知与审计写「补拉 N 封来信」 */
export class SyncedMailTally {
  #count = 0;
  #from: Date | null = null;
  #to: Date | null = null;

  /** 记一封的结果：新入库的来信（含归档的平台通知）才算，别的邮箱已收过的副本不算 */
  add(outcome: MailOutcome): void {
    if (outcome.result !== 'created' || outcome.direction !== 'inbound') return;
    const at = outcome.internalDate;
    this.#count += 1;
    if (!this.#from || at < this.#from) this.#from = at;
    if (!this.#to || at > this.#to) this.#to = at;
  }

  get synced(): SyncedMail {
    return { count: this.#count, from: this.#from, to: this.#to };
  }
}
