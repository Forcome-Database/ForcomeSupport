import {
  isArchivedSource,
  type MessageDirection,
  type MessageSource,
  type Site,
  type TicketChannel,
} from '@forcome/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { storeScopeCondition, type DbExecutor, type StoreScope } from '../core';
import { extractOrderNumbers } from './order-numbers';
import type { MailAddress, Recognition } from './recognition';
import { message, store } from './schema';

/*
 * 收取的邮件对外的读服务（ADR 0005：别的模块只经 index.ts 读 channel 的数据）：
 * ticket 归并时取一封来信的识别结果（系统操作，SYSTEM_STORE_SCOPE），工单详情取消息摘要（成员的店铺范围），
 * 核对与排查时列出收取的邮件（含归档的平台通知与营销）。
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

/** 工单详情里一封消息的摘要（正文、我方回复等随 09、17） */
export interface MessageSummary {
  readonly id: string;
  readonly direction: MessageDirection;
  readonly mailbox: string;
  /** 识别结果（客户渠道身份、来源等）；工单里的来信都识别过 */
  readonly recognition: Recognition | null;
  readonly subject: string;
  readonly receivedAt: Date;
  /** 同一封邮件同时发到的其他店铺邮箱（R-TK-07） */
  readonly alsoSentTo: readonly string[];
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
      ...recognitionColumns,
      subject: message.subject,
      receivedAt: message.receivedAt,
      alsoSentTo: message.alsoSentTo,
    })
    .from(message)
    .where(and(inArray(message.id, [...ids]), storeScopeCondition(scope, message.storeId)));
  return rows.map((row) => ({
    id: row.id,
    direction: row.direction,
    mailbox: row.mailbox,
    recognition: recognitionOf(row),
    subject: row.subject,
    receivedAt: row.receivedAt,
    alsoSentTo: row.alsoSentTo,
  }));
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
