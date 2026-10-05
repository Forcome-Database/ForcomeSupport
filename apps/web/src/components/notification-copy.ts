/*
 * 站内通知面板的界面文案（全局状态 G10，原型 design/spec/build_ds.py 的 notif_panel()，状态板 GlobalStates）。
 * 逐字照原型（notification-copy.test.ts 直接读原型核对）；每条通知的标题、说明与对象由写通知的业务模块给出。
 */

export const NOTIFICATION_COPY = {
  /** 铃铛按钮的读屏名（原型是图标按钮，没有文字） */
  bell: '站内通知',
  title: '通知',
  markAll: '全部已读',
  /** 「全部已读」不可用时的悬停说明（设计规范：禁用要悬停说明原因） */
  markAllDisabled: '没有未读通知',
  tabs: { all: '全部', unread: '未读' },
  footer: '点一条即跳到对应对象并标为已读',
  empty: {
    title: '暂无通知',
    /** 第一期没有审批类通知（11.4 审批类都是「二起」），去掉原型完整版的「审批、」（待协调者确认，见待办 31 Comments） */
    description: '渠道异常、未归属店铺来信等需要你知道的事会出现在这里。',
  },
  /** 失败浮层（G5）的动作：「标为已读失败：原因」「全部已读失败：原因」 */
  failed: { read: '标为已读', readAll: '全部已读' },
} as const;
