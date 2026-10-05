import type { MessageDirection, Site, TicketChannel } from '@forcome/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { storeScopeCondition, type DbExecutor, type StoreScope } from '../core';
import { message } from './schema';

/*
 * 收取的邮件对外的读服务（ADR 0005：别的模块只经 index.ts 读 channel 的数据）：
 * ticket 归并时取一封来信的识别结果（系统操作，SYSTEM_STORE_SCOPE），工单详情取消息摘要（成员的店铺范围）。
 * 都带店铺范围（ADR 0010）；店铺为空的邮件（未归属店铺，15）只在不受限的范围里看得到。
 */

/** 归并要用的一封来信：识别出的店铺、渠道、站点与发件人 */
export interface InboundMessage {
  readonly id: string;
  readonly direction: MessageDirection;
  /** 识别出的店铺；未归属店铺（15）为空 */
  readonly storeId: string | null;
  readonly channel: TicketChannel | null;
  readonly site: Site | null;
  /** 客户渠道身份（发件地址，小写）；Shopify 联系表单取表单里的回复邮箱随 10 */
  readonly fromAddress: string;
  readonly fromName: string;
  readonly subject: string;
  /** 到达时间（Gmail internalDate） */
  readonly receivedAt: Date;
  /** 同一封邮件已在别的邮箱收到时指向准的那封（不归并） */
  readonly duplicateOfId: string | null;
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
      channel: message.channel,
      site: message.site,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      subject: message.subject,
      receivedAt: message.receivedAt,
      duplicateOfId: message.duplicateOfId,
    })
    .from(message)
    .where(and(eq(message.id, id), storeScopeCondition(scope, message.storeId)))
    .limit(1);
  return row ?? null;
}

/** 工单详情里一封消息的摘要（正文、我方回复等随 09、17） */
export interface MessageSummary {
  readonly id: string;
  readonly direction: MessageDirection;
  readonly mailbox: string;
  readonly fromAddress: string;
  readonly fromName: string;
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
  return db
    .select({
      id: message.id,
      direction: message.direction,
      mailbox: message.mailbox,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      subject: message.subject,
      receivedAt: message.receivedAt,
      alsoSentTo: message.alsoSentTo,
    })
    .from(message)
    .where(and(inArray(message.id, [...ids]), storeScopeCondition(scope, message.storeId)));
}
