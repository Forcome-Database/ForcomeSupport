import {
  CONNECTION_FAILURE_LIMIT,
  mailProviderLabels,
  type MailProvider,
} from '@forcome/contracts';

/*
 * 进线邮箱连接异常与恢复的站内通知（PRD 11.4「渠道连接异常」「渠道连接恢复」、原型 G10 与 K20 补充小样的示例通知）与审计对象的写法
 * （原型 AUDIT_LOG、K20 补充小样），按服务商取名称（D-28，待办 35）：Gmail 写「Gmail 连接异常」「P18 · Gmail」「Gmail · 邮箱」，
 * 163 企业邮箱写「163 企业邮箱连接异常」「P18 · 163 企业邮箱」「163 企业邮箱 · 邮箱」，其余同一种写法。
 * mailbox-copy.test.ts 读原型生成物逐字核对。接收人按角色（管理员、客服主管），连接异常另发钉钉工作通知（org 的 notifyMembers 按 11.4 自动排）。
 */
/** 名称后接中文：以西文结尾的名称（Gmail）后空一格，以中文结尾的（163 企业邮箱）直接接（原型的写法） */
function titled(name: string, text: string): string {
  return /[A-Za-z0-9]$/.test(name) ? `${name} ${text}` : `${name}${text}`;
}

export function mailboxConnectionNotices(provider: MailProvider) {
  const name = mailProviderLabels[provider];
  return {
    disconnected: {
      title: titled(name, '连接异常'),
      body: (mailbox: string) => `${mailbox} 连续 ${CONNECTION_FAILURE_LIMIT} 次失败，来信暂存`,
    },
    recovered: {
      title: titled(name, '已恢复'),
      /** 写这次补拉了几封来信（一封也没有时照写「补拉 0 封来信」，E1） */
      body: (mailbox: string, backfilled: number) =>
        `${mailbox} 已重新连接，补拉 ${backfilled} 封来信`,
    },
    /** 对象是 P18 上该服务商的渠道卡 */
    object: { type: 'channel', id: provider, label: `P18 · ${name}` },
  } as const;
}

/** 审计对象（P27「对象」列，原型「Gmail · support@forcome.mx」「163 企业邮箱 · amz-auto@forcome.com」）：ID 为 <服务商>:<邮箱> */
export const mailboxAuditObject = (provider: MailProvider, mailbox: string) => ({
  objectId: `${provider}:${mailbox}`,
  objectLabel: `${mailProviderLabels[provider]} · ${mailbox}`,
});
