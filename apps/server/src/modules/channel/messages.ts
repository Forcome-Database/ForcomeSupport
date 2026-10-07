import {
  isArchivedSource,
  type MessageDirection,
  type MessageSource,
  type Site,
  type TicketChannel,
} from '@forcome/contracts';
import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { storeScopeCondition, type DbExecutor, type StoreScope } from '../core';
import { autoReplyHeader, isAutoReply } from './auto-reply';
import { displayBody } from './body';
import { extractOrderNumbers } from './order-numbers';
import type { MailAddress, Recognition } from './recognition';
import { message, store } from './schema';

/*
 * 收取的邮件对外的读服务（ADR 0005：别的模块只经 index.ts 读 channel 的数据）：
 * ticket 归并时取一封来信的识别结果、回复识别时取一封我方发信与它可能回复的邮件（系统操作，SYSTEM_STORE_SCOPE），
 * 工单详情取消息摘要（成员的店铺范围），核对与排查时列出收取的邮件（含归档的平台通知与营销）。
 * 都带店铺范围（ADR 0010）；店铺为空的邮件（未归属店铺，15）只在不受限的范围里看得到。
 */

const recognitionColumns = {
  channel: message.channel,
  site: message.site,
  source: message.source,
  senderAddress: message.senderAddress,
  senderName: message.senderName,
};

interface RecognitionColumns {
  readonly channel: TicketChannel | null;
  readonly site: Site | null;
  readonly source: MessageSource | null;
  readonly senderAddress: string | null;
  readonly senderName: string | null;
}

/** 入库时的识别结果（recognition.ts）；同一封邮件的其余副本不识别，为空 */
function recognitionOf(row: RecognitionColumns): Recognition | null {
  const { channel, site, source, senderAddress, senderName } = row;
  if (channel === null || site === null || source === null || senderAddress === null) return null;
  return { channel, site, source, sender: { address: senderAddress, name: senderName ?? '' } };
}

/** 归并要用的一封来信：识别出的店铺与识别结果（渠道、站点、来源、客户渠道身份）、抽出的候选订单号 */
export interface InboundMessage {
  readonly id: string;
  readonly direction: MessageDirection;
  /** 收到它的店铺邮箱与 Gmail 线程、RFC Message-ID：归并后据此找先到的我方回复（回复识别的乱序，16） */
  readonly mailbox: string;
  readonly gmailThreadId: string;
  readonly rfcMessageId: string | null;
  /** 识别出的店铺；未归属店铺（15）与同一封邮件的其余副本为空 */
  readonly storeId: string | null;
  /** 识别结果；同一封邮件的其余副本（duplicateOfId 不为空）为空。平台通知与营销已归档，不会发「来信已接收」 */
  readonly recognition: Recognition | null;
  readonly subject: string;
  /** 到达时间（Gmail internalDate） */
  readonly receivedAt: Date;
  /** 同一封邮件已在别的邮箱收到时指向准的那封（不归并） */
  readonly duplicateOfId: string | null;
  /**
   * 按店铺平台从主题与正文抽出的候选订单号（order-numbers.ts，待办 14）：读的时候按当前的店铺抽，指定店铺（15）后照样能抽；
   * 没有店铺时为空。候选要由归并交 order 校验
   */
  readonly orderNumbers: readonly string[];
}

export async function findInboundMessage(
  db: DbExecutor,
  scope: StoreScope,
  id: string,
): Promise<InboundMessage | null> {
  const [row] = await db
    .select({
      id: message.id,
      direction: message.direction,
      mailbox: message.mailbox,
      gmailThreadId: message.gmailThreadId,
      rfcMessageId: message.rfcMessageId,
      storeId: message.storeId,
      ...recognitionColumns,
      subject: message.subject,
      textBody: message.textBody,
      htmlBody: message.htmlBody,
      receivedAt: message.receivedAt,
      duplicateOfId: message.duplicateOfId,
      platform: store.platform,
    })
    .from(message)
    .leftJoin(store, eq(store.id, message.storeId))
    .where(and(eq(message.id, id), storeScopeCondition(scope, message.storeId)))
    .limit(1);
  if (!row) return null;
  const { id: messageId, direction, storeId, subject, receivedAt, duplicateOfId, platform } = row;
  return {
    id: messageId,
    direction,
    mailbox: row.mailbox,
    gmailThreadId: row.gmailThreadId,
    rfcMessageId: row.rfcMessageId,
    storeId,
    recognition: recognitionOf(row),
    subject,
    receivedAt,
    duplicateOfId,
    orderNumbers: platform
      ? extractOrderNumbers(platform, { subject, text: row.textBody, html: row.htmlBody })
      : [],
  };
}

/**
 * 「已发送」里的一封我方邮件（回复识别，R-SL-08，待办 16）：发件的店铺邮箱与店铺、Gmail 线程、它回复的 Message-ID
 * （In-Reply-To 与 References，按出现顺序）、发出时间与是否自动回复（auto-reply.ts，读的时候按头字段判断）
 */
export interface OutboundMessage {
  readonly id: string;
  readonly direction: MessageDirection;
  readonly mailbox: string;
  /** 发件邮箱所属的店铺；同一封邮件的其余副本为空 */
  readonly storeId: string | null;
  readonly gmailThreadId: string;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
  /** 发出时间（Gmail internalDate） */
  readonly receivedAt: Date;
  readonly duplicateOfId: string | null;
  /** 带 Auto-Submitted 或自动回复标记：不算回复 */
  readonly autoReply: boolean;
}

export async function findOutboundMessage(
  db: DbExecutor,
  scope: StoreScope,
  id: string,
): Promise<OutboundMessage | null> {
  const [row] = await db
    .select({
      id: message.id,
      direction: message.direction,
      mailbox: message.mailbox,
      storeId: message.storeId,
      gmailThreadId: message.gmailThreadId,
      inReplyTo: message.inReplyTo,
      references: message.references,
      receivedAt: message.receivedAt,
      duplicateOfId: message.duplicateOfId,
      headers: message.headers,
    })
    .from(message)
    .where(and(eq(message.id, id), storeScopeCondition(scope, message.storeId)))
    .limit(1);
  if (!row) return null;
  const { headers, ...rest } = row;
  return { ...rest, autoReply: isAutoReply(headers) };
}

/** 一封我方回复可能回复的邮件：按 Message-ID 或同一 Gmail 线程找到的已入库邮件（不论方向） */
export interface ReplyTarget {
  readonly id: string;
  readonly direction: MessageDirection;
  /** 来信会归并成工单（不是归档的平台通知与营销）：还没归到工单时，回复识别要等它 */
  readonly mergeable: boolean;
  readonly rfcMessageId: string | null;
  readonly mailbox: string;
  readonly gmailThreadId: string;
  readonly receivedAt: Date;
}

/**
 * 回复识别的候选（R-SL-08）：Message-ID 在给定的 In-Reply-To / References 里的邮件，与同一邮箱同一 Gmail 线程里的邮件
 * （不含这封回复自己）。同一封邮件发到几个邮箱时只取准的那封（其余副本不归并、不在工单里）。
 * 按哪一种先匹配、归到哪张工单由 ticket 决定
 */
export async function listReplyTargets(
  db: DbExecutor,
  scope: StoreScope,
  reply: Pick<OutboundMessage, 'id' | 'mailbox' | 'gmailThreadId' | 'inReplyTo' | 'references'>,
): Promise<ReplyTarget[]> {
  const ids = [...new Set([reply.inReplyTo, ...reply.references].filter((x) => x !== null))];
  const rows = await db
    .select({
      id: message.id,
      direction: message.direction,
      source: message.source,
      rfcMessageId: message.rfcMessageId,
      mailbox: message.mailbox,
      gmailThreadId: message.gmailThreadId,
      receivedAt: message.receivedAt,
    })
    .from(message)
    .where(
      and(
        ne(message.id, reply.id),
        isNull(message.duplicateOfId),
        storeScopeCondition(scope, message.storeId),
        or(
          ids.length > 0 ? inArray(message.rfcMessageId, ids) : undefined,
          and(eq(message.mailbox, reply.mailbox), eq(message.gmailThreadId, reply.gmailThreadId)),
        ),
      ),
    )
    .orderBy(asc(message.receivedAt), asc(message.id));
  return rows.map(({ source, ...row }) => ({
    ...row,
    // 未归属店铺的来信（15）还没识别来源，指定店铺后照样归并
    mergeable: row.direction === 'inbound' && (source === null || !isArchivedSource(source)),
  }));
}

/** 工单详情里一封消息的摘要（P05 全程记录） */
export interface MessageSummary {
  readonly id: string;
  readonly direction: MessageDirection;
  readonly mailbox: string;
  /** From 头：我方发出的消息显示发件邮箱（来信看识别出的客户渠道身份） */
  readonly from: MailAddress;
  /** 识别结果（客户渠道身份、来源等）；工单里的来信都识别过 */
  readonly recognition: Recognition | null;
  readonly subject: string;
  readonly receivedAt: Date;
  /** 同一封邮件同时发到的其他店铺邮箱（R-TK-07） */
  readonly alsoSentTo: readonly string[];
  /** 显示的正文（body.ts：纯文本优先，只有 HTML 时转成文字，Shopify 联系表单只取留言；17） */
  readonly body: string;
  /** 我方自动回复带的标记头（「Auto-Submitted: auto-replied」，P05 灰色卡上写，17）；来信与不是自动回复的为 null */
  readonly autoReplyHeader: string | null;
}

export async function listMessageSummaries(
  db: DbExecutor,
  scope: StoreScope,
  ids: readonly string[],
): Promise<MessageSummary[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: message.id,
      direction: message.direction,
      mailbox: message.mailbox,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      ...recognitionColumns,
      subject: message.subject,
      receivedAt: message.receivedAt,
      alsoSentTo: message.alsoSentTo,
      textBody: message.textBody,
      htmlBody: message.htmlBody,
      headers: message.headers,
    })
    .from(message)
    .where(and(inArray(message.id, [...ids]), storeScopeCondition(scope, message.storeId)));
  return rows.map((row) => {
    const recognition = recognitionOf(row);
    return {
      id: row.id,
      direction: row.direction,
      mailbox: row.mailbox,
      from: { address: row.fromAddress, name: row.fromName },
      recognition,
      subject: row.subject,
      receivedAt: row.receivedAt,
      alsoSentTo: row.alsoSentTo,
      body: displayBody({
        text: row.textBody,
        html: row.htmlBody,
        // 渠道为亚马逊、Shopify 的来信就是经买家消息、联系表单中转的（R-TK-08）
        relay:
          row.direction === 'inbound' && recognition && recognition.channel !== 'email'
            ? recognition.channel
            : undefined,
      }),
      autoReplyHeader: row.direction === 'outbound' ? autoReplyHeader(row.headers) : null,
    };
  });
}

/** 收取的一封邮件（含归档的平台通知与营销，不丢信） */
export interface ReceivedMail {
  readonly id: string;
  readonly mailbox: string;
  /** 来信 inbound；「已发送」里我方发出的 outbound */
  readonly direction: MessageDirection;
  /** From 头（Shopify 联系表单通知是 mailer@shopify.com，客户渠道身份在识别结果里） */
  readonly from: MailAddress;
  readonly subject: string;
  readonly receivedAt: Date;
  readonly storeId: string | null;
  readonly recognition: Recognition | null;
  /** 来源是平台通知或营销：只入库，不建工单（PRD 1.4） */
  readonly archived: boolean;
  readonly duplicateOfId: string | null;
}

/**
 * 收取的邮件，按到达时间先后（可按收件邮箱筛选）：核对与排查用——归档的邮件不进工单，在这里仍能查到
 * （协调者 10-05：归档的消息完整入库可查）。测试工具 t.receivedMail() 经它核对；查看页面第一期没有。
 */
export async function listReceivedMail(
  db: DbExecutor,
  scope: StoreScope,
  filter: { readonly mailbox?: string } = {},
): Promise<ReceivedMail[]> {
  const rows = await db
    .select({
      id: message.id,
      mailbox: message.mailbox,
      direction: message.direction,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      subject: message.subject,
      receivedAt: message.receivedAt,
      storeId: message.storeId,
      ...recognitionColumns,
      duplicateOfId: message.duplicateOfId,
    })
    .from(message)
    .where(
      and(
        storeScopeCondition(scope, message.storeId),
        filter.mailbox ? eq(message.mailbox, filter.mailbox.toLowerCase()) : undefined,
      ),
    )
    .orderBy(asc(message.receivedAt), asc(message.id));
  return rows.map((row) => {
    const recognition = recognitionOf(row);
    return {
      id: row.id,
      mailbox: row.mailbox,
      direction: row.direction,
      from: { address: row.fromAddress, name: row.fromName },
      subject: row.subject,
      receivedAt: row.receivedAt,
      storeId: row.storeId,
      recognition,
      archived: recognition !== null && isArchivedSource(recognition.source),
      duplicateOfId: row.duplicateOfId,
    };
  });
}
