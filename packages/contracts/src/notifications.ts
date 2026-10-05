import { businessDateTime } from '@forcome/calendar';
import { z } from 'zod';
import type { AuditObjectType } from './audit';
import { auditTimeWords } from './audit-log';
import type { Role } from './roles';

/*
 * 站内通知（PRD 11.1 Notification、11.4「通知」、全局状态 G10，待办 31）：通知类型与接收人、接口的输出，以及铃铛面板的写法。
 * 写入与查询在后端 core（接收人由 org 按这里的角色取在职成员），面板在前端外壳。
 */

// ---------------------------------------------------------------- 通知类型（11.4）

/**
 * 第一期的通知类型：11.4 中阶段为「一起」的行（「未归属店铺来信；登记新店铺后来信自动归位」一行是两种）。
 * 面板只出现当前阶段已上线的类型（D-27）；第二期的类型（审批、SLA 超时、售后进展等）随第二期加进来，
 * 它们的接收人多是按对象定的（工单负责人、发起人、审批人），到时在定义里另加接收人的取法。
 */
export const notificationTypes = [
  'channel_disconnected',
  'channel_recovered',
  'dingtalk_sync_failed',
  'unassigned_mail',
  'unassigned_mail_placed',
  'reassign_queue',
] as const;
export const notificationTypeSchema = z.enum(notificationTypes);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export interface NotificationTypeDefinition {
  /** PRD 11.4 的「事件」（单元测试按它对表） */
  readonly event: string;
  /** 接收人（11.4「接收人」）：有这些角色之一的在职成员 */
  readonly recipients: readonly Role[];
  /** 11.4「渠道」里有钉钉工作通知：站内通知之外由调用方另行发送（钉钉工作通知随待办 05） */
  readonly dingtalk: boolean;
  /**
   * 关联对象属于某个店铺，只发给店铺范围包含该店铺的接收人（R-ST-06）；写入时必须给出店铺。
   * 渠道连接、钉钉同步与未归属来信按角色发给全部（渠道异常本来就是全站横幅，未归属来信没有店铺）
   */
  readonly storeScoped: boolean;
}

export const notificationTypeDefinitions: Record<NotificationType, NotificationTypeDefinition> = {
  // E-01、E-02：Gmail、SP-API、Shopify 连续 3 次失败（6.9）；钉钉同步异常另是 dingtalk_sync_failed（E-32）
  channel_disconnected: {
    event: '渠道连接异常（钉钉除外）',
    recipients: ['admin', 'supervisor'],
    dingtalk: true,
    storeScoped: false,
  },
  channel_recovered: {
    event: '渠道连接恢复（钉钉除外）',
    recipients: ['admin', 'supervisor'],
    dingtalk: false,
    storeScoped: false,
  },
  dingtalk_sync_failed: {
    event: '钉钉同步失败（E-32）',
    recipients: ['admin'],
    dingtalk: false,
    storeScoped: false,
  },
  unassigned_mail: {
    event: '未归属店铺来信（E-13）；登记新店铺后来信自动归位',
    recipients: ['supervisor'],
    dingtalk: true,
    storeScoped: false,
  },
  // AC-P1-16：管理员登记新店铺或进线邮箱后，队列里收件地址匹配的来信自动归位成工单
  unassigned_mail_placed: {
    event: '未归属店铺来信（E-13）；登记新店铺后来信自动归位',
    recipients: ['supervisor'],
    dingtalk: false,
    storeScoped: true,
  },
  // AC-ST-05：钉钉离职自动停用后，其进行中的售后单进入客服主管的改派队列（第一期只有售后单）。
  // 按店铺发：一位成员的单跨几个店铺时，按店铺各发一条（每条只说该店铺的单），店铺范围受限的客服主管只收到自己店铺的
  reassign_queue: {
    event: '成员停用后其工单与售后单进入改派队列',
    recipients: ['supervisor'],
    dingtalk: false,
    storeScoped: true,
  },
};

/**
 * 关联对象的类型（PRD 11.1 Notification「关联对象」；与审计的对象类型同一套叫法）：渠道（id 为渠道，如 gmail、dingtalk）、
 * 来信、工单（id 为工单号）、售后单（id 为售后单号）、成员、店铺
 */
export const notificationObjectTypes = [
  'channel',
  'message',
  'ticket',
  'aftersales',
  'member',
  'store',
] as const satisfies readonly AuditObjectType[];
export const notificationObjectTypeSchema = z.enum(notificationObjectTypes);
export type NotificationObjectType = z.infer<typeof notificationObjectTypeSchema>;

/** 关联对象（PRD 11.1 Notification「关联对象」）：类型、ID 与面板里显示的编号或页面 */
export const notificationObjectSchema = z.object({
  type: notificationObjectTypeSchema,
  id: z.string().min(1),
  /** 对象编号或页面（原型「P18 · Gmail」「P04 · 未归属店铺」「AP-20260911-004」） */
  label: z.string().min(1),
});

/**
 * 一条通知的内容（接收人另给）：类型、标题与说明、关联对象，以及对象所属店铺。写通知的业务模块给出它
 * （后端 core 的写入、org 的 notifyMembers），开发登录环境的示例通知接口也收它
 */
export const notificationContentSchema = z.object({
  type: notificationTypeSchema,
  /** 标题（原型「Gmail 连接异常」） */
  title: z.string().min(1),
  /** 说明（原型「support@forcome.mx 连续 3 次失败，来信暂存」） */
  body: z.string(),
  object: notificationObjectSchema,
  /**
   * 关联对象所属店铺；没有店铺属性的不填。按店铺发的类型（storeScoped）必须给；查询时按接收人当前的店铺范围过滤（R-ST-06）
   */
  storeId: z.uuid().nullable().optional(),
});
export type NotificationContent = z.infer<typeof notificationContentSchema>;

// ---------------------------------------------------------------- 接口

/** 面板一次列出的条数：最近的这么多条（未读页签为最近的这么多条未读），更早的不再列出 */
export const NOTIFICATION_LIST_LIMIT = 50;

/** 面板的页签（G10「全部 · 未读」） */
export const notificationViews = ['all', 'unread'] as const;
export const notificationViewSchema = z.enum(notificationViews);
export type NotificationView = z.infer<typeof notificationViewSchema>;

export const notificationQuerySchema = z.object({
  view: notificationViewSchema.optional(),
});
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

/** 面板里的一条（G10：类型图标、标题、说明、对象编号与时间，未读带圆点）；店铺只用于过滤，不输出 */
export const notificationSchema = notificationContentSchema.omit({ storeId: true }).extend({
  id: z.string(),
  /** ISO 时刻 */
  createdAt: z.string(),
  read: z.boolean(),
});
export type Notification = z.infer<typeof notificationSchema>;

/** GET /api/notifications：这一页签的通知（新的在前，最多 NOTIFICATION_LIST_LIMIT 条）与未读总数 */
export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unread: z.number().int().nonnegative(),
  /** 服务端的当前时刻（ISO）：时间按它判断是不是当天（notificationTimeWords），不看浏览器的时钟 */
  now: z.string(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

/** GET /api/notifications/unread-count：铃铛的未读数 */
export const notificationUnreadSchema = z.object({
  unread: z.number().int().nonnegative(),
});
export type NotificationUnread = z.infer<typeof notificationUnreadSchema>;

/**
 * 示例通知（POST /api/dev/notifications，同开发登录只在非生产环境存在）：请求体是一条通知的内容，按 11.4 发给该类型的接收人，
 * 走与业务调用方相同的写入；返回发给了谁（成员 ID）。第一期产生通知的业务（渠道连接 09/11/12、钉钉同步 05、未归属来信 15、
 * 改派队列 23）上线前，演示与 Playwright 用它产生通知
 */
export const devNotificationResponseSchema = z.object({ recipients: z.array(z.string()) });

// ---------------------------------------------------------------- 写法

/** 通知的时间（北京时间）：当天只写「时:分」（原型「10:14」），之前的写「月-日 时:分」，不在今年的写全年份（同 P27 时间列） */
export function notificationTimeWords(at: Date | string, now: Date): string {
  const today = businessDateTime(now).slice(0, 10);
  const day = businessDateTime(typeof at === 'string' ? new Date(at) : at).slice(0, 10);
  return auditTimeWords(at, { withDate: day !== today, year: today.slice(0, 4) });
}
