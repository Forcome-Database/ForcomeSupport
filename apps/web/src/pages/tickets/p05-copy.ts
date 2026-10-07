/*
 * P05 工单详情的界面文案（逐字照原型；p05-copy.test.ts 直接读原型生成物核对）：第一期参照页
 * design/spec/phase1/P05_TicketDetail*.dc.html（已解决、待回复、等客户、已关闭），状态板 design/StatesInbox.dc.html 的 I18
 * 与补充小样③–⑧（待办 17，协调者 2026-10-07 决定 Q1–Q6）。状态、渠道、来源、关闭原因的叫法在 contracts 的 ticket.ts。
 * 界面上看得见的文字都在这里，组件里不写死；拼句子的写法在 p05-words.ts。
 */

/** 元信息（标题下一行）：「T-… · 客户 Oliver Grant · 订单 204-… · 自动关闭」 */
export const META = {
  customer: (name: string) => `客户 ${name}`,
  order: (number: string) => `订单 ${number}`,
} as const;

/** 全程记录卡片：标题与分段筛选 */
export const TIMELINE = {
  title: '全程记录',
  filters: { all: '全部', messages: '仅消息', events: '仅事件' },
} as const;

/** 来信卡头的渠道写法（Q6 a）：「亚马逊买家消息 · 10:12」 */
export const INBOUND_VIA = {
  amazon: '亚马逊买家消息',
  shopify: 'Shopify 联系表单',
  email: '邮件',
} as const;

/** 我方发出的消息：只在亚马逊工单写「经亚马逊买家消息」；带 Auto-Submitted 的为灰色「自动回复 · 不算回复」 */
export const OUTBOUND = {
  sender: '我方',
  viaAmazon: '经亚马逊买家消息',
  autoReply: '自动回复 · 不算回复',
} as const;

/** 来信卡右上：未回复来信的按钮、被标记后的写法「无需回复 · 李婷 · 09:05」、生产厂与其他供应商不计 */
export const LETTER = {
  /** 直邮来信正文顶部的邮件头小字（I18 ②）：「发件人 qc@fqd-forcome.com → support@forcome.com」 */
  mailHeader: (from: string, to: string) => `发件人 ${from} → ${to}`,
  mark: '标记无需回复',
  marked: (by: string, at: string) => `无需回复 · ${by} · ${at}`,
  notCounted: (source: string) => `不计（${source}）`,
} as const;

/** 事件行的执行者标识（原型 who()） */
export const ACTOR_TAG = { system: '系统', member: '人工' } as const;

/** 事件行（Q6 e）：系统事件与标记、撤销 */
export const EVENT = {
  created: (to: string) => `新建工单，状态「${to}」`,
  inbound: (to: string) => `新来信，回到「${to}」`,
  reopened: (to: string) => `同一订单来信，重开为「${to}」`,
  replyDetected: (to: string) => `识别到我方回复，转「${to}」`,
  idle7: (reason: string) => `7 天无来信，关闭（${reason}）`,
  idle14: (reason: string) => `14 天无新来信，关闭（${reason}）`,
  marked: (actor: string) => `${actor}标记无需回复`,
  markedTo: (actor: string, to: string) => `${actor}标记无需回复，转「${to}」`,
  undone: (actor: string) => `${actor}撤销标记无需回复`,
  undoneTo: (actor: string, to: string) => `${actor}撤销标记无需回复，回到「${to}」`,
} as const;

/** 右栏：工单信息 */
export const INFO = {
  title: '工单信息',
  store: '店铺',
  site: '站点',
  channel: '渠道',
  source: '来源',
  mailbox: '进线邮箱',
  orderNumber: '订单号',
} as const;

/** 右栏：订单卡（Q1、Q2） */
export const ORDER = {
  title: '订单',
  synced: (at: string) => `平台镜像 · 最近同步 ${at}`,
  updated: (day: string) => `更新于 ${day}`,
  items: '商品',
  amount: '金额',
  fulfillment: '履约方式',
  promise: '承诺送达',
  shipTo: '收件城市',
  carrier: '承运商',
  none: '未关联订单',
} as const;

/** 右栏：SLA 结果（Q6 b、c） */
export const SLA = {
  title: 'SLA 结果',
  target: { platform: '亚马逊 24 小时', internal: '内部目标 24 小时' },
  arrival: (at: string) => `${at} 来信`,
  firstReply: (duration: string) => `首次回复 ${duration}`,
  remaining: (left: string) => `剩 ${left}`,
  noReply: (by: string) => `无需回复 · ${by}`,
  notCounted: '不计',
  fromSource: (source: string) => `${source}来信`,
  results: { met: '达标', missed: '未达标', pending: '未到期' },
} as const;

/** 右栏：状态流转（Q6 d、e）：每步「触发方 · 事件」，最后一步写预计关闭或实际关闭 */
export const FLOW = {
  title: '状态流转',
  rule: (status: string, rule: string) => `${status} ${rule}自动关闭`,
  step: (actor: string, event: string) => `${actor} · ${event}`,
  closedStep: (actor: string, event: string, reason: string) => `${actor} · ${event}（${reason}）`,
  planned: (at: string) => `预计 ${at}`,
  events: {
    created: '新建',
    inbound: '新来信',
    reopened: '重开',
    replyDetected: '识别到我方回复',
    marked: '标记无需回复',
    undone: '撤销标记无需回复',
    idle7: '7 天无来信',
    idle14: '14 天无新来信',
  },
} as const;

/** 自动关闭的规则（6.1）：待回复 14 天、等客户与已解决 7 天 */
export const CLOSE_RULE = {
  awaiting_reply: '14 天无新来信',
  awaiting_customer: '7 天无来信',
  resolved: '7 天无来信',
} as const;

/** 元信息里的自动关闭（PRD P05「第一阶段」例句；Q6 d）：待回复不写状态前缀，已关闭写实际关闭时刻 */
export const AUTO_CLOSE = {
  planned: (rule: string, at: string, reason: string) => `${rule}将于 ${at} 自动关闭（${reason}）`,
  plannedWithStatus: (status: string, rule: string, at: string, reason: string) =>
    `${status} · ${rule}将于 ${at} 自动关闭（${reason}）`,
  closed: (at: string, reason: string) => `已关闭 · ${at} 自动关闭（${reason}）`,
} as const;

/** 标记与撤销的浮层（I18 ① 与补充小样⑦） */
export const MARK_RESULT = {
  done: '已标记无需回复',
  doneResolved: '已标记无需回复 · 工单转已解决',
  failedAction: '标记无需回复',
  undoFailedAction: '撤销',
  stillUnmarked: '这封来信仍未标记',
  refreshed: '已刷新为最新内容。',
} as const;

/** G2（其他店铺的工单，Q5）与 G3（第一阶段只有「返回工单列表」） */
export const MISSING = {
  forbiddenTitle: '没有访问权限',
  forbidden: (number: string, scope: string, contact: string) =>
    `工单 ${number} 不在你的店铺范围内。你的店铺范围是 ${scope}，如需开通请${contact}。`,
  home: '返回首页',
  notFoundTitle: '找不到这张工单',
  notFound: (number: string) => `工单 ${number} 不存在，请检查编号或链接是否完整。`,
  backToList: '返回工单列表',
} as const;

/** 没有值（原型「—」） */
export const EMPTY_VALUE = '—';

/** 只给读屏器的说明（原型不画、不核对） */
export const A11Y = {
  filters: '全程记录的筛选',
} as const;
