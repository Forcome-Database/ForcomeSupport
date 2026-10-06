/*
 * 钉钉工作通知的固定写法（PRD 11.4「钉钉工作通知」v2.23，2026-10-06 用户确认；work-notification-copy.test.ts 读 PRD 逐字核对）。
 * 原型没有画钉钉里的消息，写法以 PRD 为准。标题、说明、对象来自各通知（同站内通知）。
 */
export const WORK_NOTIFICATION_COPY = {
  /** 每条消息的开头 */
  brand: '【Forcome Support】',
  /** 同一人 5 分钟内的几条合成一条时的第一行（接在 brand 后面） */
  merged: (count: number | string) => `${count} 条新通知`,
  /** 超出钉钉的长度上限时的末行 */
  more: (count: number | string) => `· 另有 ${count} 条，请在系统里查看`,
} as const;
