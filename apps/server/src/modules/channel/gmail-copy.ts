import { CONNECTION_FAILURE_LIMIT } from '@forcome/contracts';

/*
 * Gmail 连接异常与恢复的站内通知（PRD 11.4「渠道连接异常」「渠道连接恢复」、原型 G10 的示例通知）与审计对象的写法（原型 AUDIT_LOG）。
 * gmail-copy.test.ts 读原型生成物逐字核对。接收人按角色（管理员、客服主管），连接异常另发钉钉工作通知（org 的 notifyMembers 按 11.4 自动排）。
 */
export const GMAIL_CONNECTION_NOTICES = {
  disconnected: {
    title: 'Gmail 连接异常',
    body: (mailbox: string) => `${mailbox} 连续 ${CONNECTION_FAILURE_LIMIT} 次失败，来信暂存`,
  },
  recovered: {
    title: 'Gmail 已恢复',
    /** 写这次补拉了几封来信（一封也没有时照写「补拉 0 封来信」，E1） */
    body: (mailbox: string, backfilled: number) =>
      `${mailbox} 已重新连接，补拉 ${backfilled} 封来信`,
  },
  /** 对象是 P18 的 Gmail 卡 */
  object: { type: 'channel', id: 'gmail', label: 'P18 · Gmail' },
} as const;

/** 审计对象（P27「对象」列，原型「Gmail · support@forcome.mx」）：ID 为 gmail:<邮箱> */
export const gmailAuditObject = (mailbox: string) => ({
  objectId: `gmail:${mailbox}`,
  objectLabel: `Gmail · ${mailbox}`,
});
