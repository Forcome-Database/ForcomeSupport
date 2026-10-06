import { CONNECTION_FAILURE_LIMIT } from '@forcome/contracts';

/*
 * 亚马逊订单同步连接异常与恢复的站内通知（PRD 11.4「渠道连接异常」「渠道连接恢复」，E-01）与审计对象的写法：
 * 原型只画了 Gmail（G10、AUDIT_LOG），亚马逊照 Shopify 的写法（协调者 2026-10-06 决定，待办 12 Q4、Q5，套用待办 09 用户确认的写法），
 * 已回写原型（data.py 的 AMAZON_NOTICES、AMAZON_AUDIT）；amazon-copy.test.ts 读原型生成物逐字核对。
 * 接收人按角色（管理员、客服主管），连接异常另发钉钉工作通知（org 的 notifyMembers 按 11.4 自动排）。
 */
export const AMAZON_CONNECTION_NOTICES = {
  disconnected: {
    title: '亚马逊 SP-API 连接异常',
    body: (storeName: string) =>
      `${storeName} 连续 ${CONNECTION_FAILURE_LIMIT} 次失败，订单暂停同步`,
  },
  recovered: {
    title: '亚马逊 SP-API 已恢复',
    /** 写这次补拉了几笔订单（一笔也没有时照写「补拉 0 笔订单」） */
    body: (storeName: string, backfilled: number) =>
      `${storeName} 已重新连接，补拉 ${backfilled} 笔订单`,
  },
  /** 对象是 P18 的亚马逊 SP-API 卡（对象 id 用 contracts 的 channelKinds，待办 31 留言） */
  object: { type: 'channel', id: 'amazon', label: 'P18 · 亚马逊 SP-API' },
} as const;

/** 审计对象（P27「对象」列「亚马逊 SP-API · Forcome Auto」）：ID 为 amazon:<店铺 ID> */
export const amazonAuditObject = (store: { readonly id: string; readonly name: string }) => ({
  objectId: `amazon:${store.id}`,
  objectLabel: `亚马逊 SP-API · ${store.name}`,
});
