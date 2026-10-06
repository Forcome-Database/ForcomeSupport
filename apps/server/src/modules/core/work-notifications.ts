import { businessDateTime } from '@forcome/calendar';
import type { NotificationContent } from '@forcome/contracts';
import { and, asc, eq, inArray, isNull, lte, min, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineJob, type JobContext } from './jobs';
import type { Runtime, Tx } from './runtime';
import { workNotification } from './schema';
import { WORK_NOTIFICATION_COPY } from './work-notification-copy';

/*
 * 钉钉工作通知（规格 core「钉钉工作通知发送」、ADR 0010「钉钉通知」，待办 05）：
 * - 排入：queueWorkNotifications 在业务事务里给每个接收人写一行待发（11.4 渠道里有钉钉的类型，org 的 notifyMembers 一并排入）；
 *   历史回放（tx.replay）里不排；
 * - 合并发送：每分钟的任务找出「最早一条待发已等满 5 分钟」的人，把他的全部待发合成一条发出——同一人 5 分钟内的几条
 *   合成一条（第一条最多晚 5 分钟到）；
 * - 内容带对象编号与时间：钉钉对「同一员工一天内容相同的通知」只送达一条，带上编号与时刻就不会被吞掉。
 * 真正发送的是钉钉客户端（integration），由入口交给任务处理器（core 不依赖 integration，同汇率来源）。
 */

/** 同一人在这么长的时间里收到的工作通知合成一条 */
export const WORK_NOTIFICATION_MERGE_MS = 5 * 60_000;
/** 一个人的一批发送失败这么多次后不再重试（记下放弃时间、写错误日志） */
export const WORK_NOTIFICATION_MAX_ATTEMPTS = 5;
/** 钉钉文本消息的上限是 2048 字节 */
const MAX_TEXT_BYTES = 2048;
const { brand: BRAND, merged, more } = WORK_NOTIFICATION_COPY;

/** 发工作通知的一方（integration 的钉钉客户端实现它） */
export interface WorkNotificationSender {
  sendWorkNotification(input: {
    readonly userIds: readonly string[];
    readonly text: string;
  }): Promise<{ taskId: string }>;
}

/** 一位接收人：成员 ID 与他的钉钉用户 ID */
export interface WorkNotificationRecipient {
  readonly memberId: string;
  readonly dingtalkUserId: string;
}

export interface WorkNotificationDraft extends Omit<NotificationContent, 'storeId'> {
  readonly recipients: readonly WorkNotificationRecipient[];
}

/** 在业务事务里排入工作通知（每个接收人一条待发，时间取 tx.now）；回放模式下不排 */
export async function queueWorkNotifications(tx: Tx, draft: WorkNotificationDraft): Promise<void> {
  if (tx.replay || draft.recipients.length === 0) return;
  const unique = new Map(draft.recipients.map((r) => [r.memberId, r]));
  await tx.db.insert(workNotification).values(
    [...unique.values()].map((recipient) => ({
      recipientId: recipient.memberId,
      dingtalkUserId: recipient.dingtalkUserId,
      type: draft.type,
      title: draft.title,
      body: draft.body,
      objectType: draft.object.type,
      objectId: draft.object.id,
      objectLabel: draft.object.label,
      createdAt: tx.now,
    })),
  );
}

// ---------------------------------------------------------------- 内容

/** 一条待发的内容 */
export interface WorkNotificationItem {
  readonly title: string;
  readonly body: string;
  readonly objectLabel: string;
  readonly createdAt: Date;
}

/** 「09-11 10:05」：北京时间的月-日 时:分 */
function shortTime(at: Date): string {
  return businessDateTime(at).slice(5, 16);
}

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * 一个人的一批待发写成一条文本（按时间先后）：
 * - 一条：「【Forcome Support】标题」/ 说明 /「对象 · 月-日 时:分」；
 * - 几条：「【Forcome Support】N 条新通知」，之后每条一行「· 标题：说明（对象 · 月-日 时:分）」；
 *   超过钉钉的 2048 字节时截掉后面的，末行写「· 另有 M 条，请在系统里查看」。
 */
export function workNotificationText(items: readonly WorkNotificationItem[]): string {
  const [first] = items;
  if (!first) throw new Error('没有要发的工作通知');
  if (items.length === 1) {
    return [
      `${BRAND}${first.title}`,
      ...(first.body ? [first.body] : []),
      `${first.objectLabel} · ${shortTime(first.createdAt)}`,
    ].join('\n');
  }
  const lines = [`${BRAND}${merged(items.length)}`];
  for (const [index, item] of items.entries()) {
    const line = `· ${item.title}${item.body ? `：${item.body}` : ''}（${item.objectLabel} · ${shortTime(item.createdAt)}）`;
    const remaining = items.length - index - 1;
    const tail = remaining > 0 ? `\n${more(remaining)}` : '';
    if (bytes([...lines, line].join('\n') + tail) > MAX_TEXT_BYTES) {
      lines.push(more(items.length - index));
      break;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 发送

/**
 * 每分钟发一次到期的工作通知：最早一条待发已等满 5 分钟的人，合成一条发出。同时最多一个在排队、一个在跑；
 * 失败的留着下一分钟再试（发送失败的不重试任务本身，免得与下一分钟的叠在一起）。
 */
export const sendWorkNotificationsJob = defineJob(
  'core.send_work_notifications',
  z.object({}),
  { policy: 'stately', retryLimit: 0 },
  { cron: '* * * * *', tz: 'Asia/Shanghai' },
);

export interface WorkNotificationSendReport {
  /** 这次发出的人数与合并前的条数 */
  readonly sent: number;
  readonly items: number;
  readonly failed: number;
}

/** 发出到期的工作通知；一个人发送失败不影响其他人，失败的记一次失败、下一分钟再试 */
export async function sendDueWorkNotifications(
  runtime: Runtime,
  sender: WorkNotificationSender,
  context: Pick<JobContext, 'logger'>,
): Promise<WorkNotificationSendReport> {
  const now = runtime.clock.now();
  const pending = and(isNull(workNotification.sentAt), isNull(workNotification.failedAt));
  const due = await runtime.db
    .select({ dingtalkUserId: workNotification.dingtalkUserId })
    .from(workNotification)
    .where(pending)
    .groupBy(workNotification.dingtalkUserId)
    .having(
      lte(min(workNotification.createdAt), new Date(now.getTime() - WORK_NOTIFICATION_MERGE_MS)),
    );

  let sent = 0;
  let items = 0;
  let failed = 0;
  for (const { dingtalkUserId } of due) {
    const rows = await runtime.db
      .select()
      .from(workNotification)
      .where(and(pending, eq(workNotification.dingtalkUserId, dingtalkUserId)))
      .orderBy(asc(workNotification.createdAt), asc(workNotification.id));
    const ids = rows.map((row) => row.id);
    let taskId: string;
    try {
      ({ taskId } = await sender.sendWorkNotification({
        userIds: [dingtalkUserId],
        text: workNotificationText(rows),
      }));
    } catch (error) {
      failed += 1;
      const attempts = Math.max(...rows.map((row) => row.attempts)) + 1;
      const gaveUp = attempts >= WORK_NOTIFICATION_MAX_ATTEMPTS;
      await runtime.db
        .update(workNotification)
        .set({
          attempts: sql`${workNotification.attempts} + 1`,
          ...(gaveUp ? { failedAt: now } : {}),
        })
        .where(inArray(workNotification.id, ids));
      context.logger[gaveUp ? 'error' : 'warn'](
        { err: error, dingtalkUserId, items: rows.length, attempts },
        gaveUp ? '钉钉工作通知多次发送失败，不再重试' : '钉钉工作通知发送失败，下一分钟再试',
      );
      continue;
    }
    // 发出去了才记已发；这一步写库失败时任务报错，下一分钟会重发一次（宁可重复，不漏）
    await runtime.db
      .update(workNotification)
      .set({ sentAt: now, taskId })
      .where(inArray(workNotification.id, ids));
    sent += 1;
    items += rows.length;
  }
  return { sent, items, failed };
}
