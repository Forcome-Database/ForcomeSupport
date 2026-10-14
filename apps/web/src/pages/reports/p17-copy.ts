/*
 * P17 报表（工单部分）的界面文案（逐字照原型；p17-copy.test.ts 直接读原型生成物核对）：第一期参照页
 * design/spec/phase1/P17_Reports.dc.html，状态板 design/StatesAdmin.dc.html 的 K19（含补充小样①–⑤：对比、没有可比值、未归属的
 * 未达标来信、第一阶段的 K4 与 K3）。原型没画的写法照 PRD P17「第一阶段」v2.34（协调者 2026-10-14 决定 Q1–Q7），拼句子在
 * p17-words.ts。界面上看得见的文字都在这里，组件里不写死。售后成本卡与「导出」随待办 25。
 */

/** 页头（原型 p17_p1()：标题「报表」，说明「数据来源：…· 更新于 10:12」，其下两条注） */
export const PAGE_TITLE = '报表';
export const SOURCES = '数据来源：工单（Gmail）、平台订单、登记台账';
export const UPDATED = {
  /** 「更新于 10:12」（今天写时分，跨天「09-10 10:12」，不在今年带年份；从没同步成功过写「—」，Q6） */
  at: (time: string) => `更新于 ${time}`,
  never: '—',
} as const;
export const NOTES = {
  /** Q-26：第一阶段回复不经本系统发出 */
  replies: '只统计经店铺邮箱发出的回复',
  /** Shopify 订单回补不足 90 天时（待办 13） */
  backfill: (days: number) =>
    `Shopify 订单只回补了 ${days} 天，更早的 Shopify 来信可能关联不到订单`,
} as const;

/** 筛选行（原型 p17_p1()：近 7 天 · 本月 · 自定义 | 起止 | 店铺 · 站点；时间的叫法在 contracts 的 reportPeriodLabels） */
export const FILTERS = {
  store: '店铺',
  site: '站点',
  clear: '清除筛选',
  /** K3：筛选后「正在加载 · 更新于 10:12」 */
  loading: '正在加载',
} as const;

/** 三张指标（原型 p17_p1_kpis()） */
export const KPI = {
  volume: '工单量',
  firstResponse: '首响中位数',
  sla: 'SLA 达标率（亚马逊）',
  /** 工单量的副标题：「近 7 天 · 客户来信新建或重开」，期间随筛选（本月、起止，Q7） */
  volumeSub: (period: string) => `${period} · 客户来信新建或重开`,
  firstResponseSub: '来信到首次回复 · 按来信到达归期',
  /** 「未达标 11 封」；店铺为全部且有未归属的未达标来信时「未达标 11 封 · 其中 2 封未归属店铺」（Q4） */
  slaSub: (missed: number) => `未达标 ${missed} 封`,
  slaUnassigned: (count: number) => `其中 ${count} 封未归属店铺`,
  /** 无数据（K4）：数值「—」，副标题「所选范围无数据」 */
  none: '—',
  noData: '所选范围无数据',
} as const;

/** 与上一周期的对比（Q2）：前缀随期间，「持平」，SLA 写「个百分点」 */
export const COMPARE = {
  week: '较前 7 天',
  month: '较上月同期',
  days: (n: number) => `较前 ${n} 天`,
  flat: '持平',
  points: '个百分点',
} as const;

/** 每日工单量（原型 p17_p1_daily()） */
export const DAILY = {
  title: '每日工单量',
  /** 「按渠道堆叠 · 近 7 天 · 点柱下钻」；不可下钻时没有「· 点柱下钻」 */
  sub: (period: string, drillable: boolean) =>
    `按渠道堆叠 · ${period}${drillable ? ' · 点柱下钻' : ''}`,
  detail: '查看明细',
  /** 图例与悬停的两组渠道（同 P04 下钻芯片的叫法） */
  amazon: '亚马逊',
  shopifyEmail: 'Shopify 与邮件',
  /** 管理员（没有工单页权限）：卡头右侧 */
  noDrill: '没有工单页权限 · 不可下钻',
  /** 悬停：「09-10 · 73 单」「亚马逊 52 · Shopify 与邮件 21」「点击查看明细 → P04 工单（09-10 新建或重开 · 客户来信）」 */
  tipTitle: (day: string, total: number) => `${day} · ${total} 单`,
  tipSplit: (amazon: number, others: number) => `亚马逊 ${amazon} · Shopify 与邮件 ${others}`,
  tipDrill: (condition: string) => `点击查看明细 → P04 工单（${condition}）`,
} as const;

/** 无数据（K4 第一阶段，补充小样④）：「每日工单量」的位置换成空状态 */
export const EMPTY = {
  title: '所选范围没有数据',
  /** 「近 7 天 Forcome Direct 没有工单。调整时间、店铺或站点后再看。」；没选店铺写「全部店铺」，选了站点在店铺后写「 · US」 */
  description: (period: string, scope: string) =>
    `${period} ${scope} 没有工单。调整时间、店铺或站点后再看。`,
  allStores: '全部店铺',
  adjust: '调整筛选',
  clear: '清除筛选',
} as const;

/** 读屏用的名字（原型里没有画出的文字） */
export const A11Y = {
  period: '时间',
  customRange: '自定义时间',
  kpiDrill: (label: string) => `${label}：查看明细`,
  legendDrill: (label: string) => `${label}：查看明细`,
  chart: '每日工单量柱状图',
} as const;
