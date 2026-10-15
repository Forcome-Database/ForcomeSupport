/*
 * P17 报表（工单部分）的界面文案（逐字照原型；p17-copy.test.ts 直接读原型生成物核对）：第一期参照页
 * design/spec/phase1/P17_Reports.dc.html，状态板 design/StatesAdmin.dc.html 的 K19（含补充小样①–⑤：对比、没有可比值、未归属的
 * 未达标来信、第一阶段的 K4 与 K3；⑥–⑧：未登记责任、本月没有售后成本、导出）。原型没画的写法照 PRD P17「第一阶段」v2.34、
 * v2.35（协调者 2026-10-14 决定：待办 24 的 Q1–Q7、待办 25 的 Q1–Q5），拼句子在 p17-words.ts。界面上看得见的文字都在这里，
 * 组件里不写死。
 */

/** 页头（原型 p17_p1()：标题「报表」，说明「数据来源：…· 更新于 10:12」，其下两条注） */
export const PAGE_TITLE = '报表';
export const SOURCES = '数据来源：工单（店铺邮箱）、平台订单、登记台账';
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

import { REPORT_COST, reportChannelGroupLabels } from '@forcome/contracts';

/** 三张指标（原型 p17_p1_kpis()）与对比（Q2）：画面与导出共用，在 contracts 的 report-words.ts */
export { REPORT_COMPARE as COMPARE, REPORT_KPI as KPI } from '@forcome/contracts';

/** 每日工单量（原型 p17_p1_daily()） */
export const DAILY = {
  title: '每日工单量',
  /** 「按渠道堆叠 · 近 7 天 · 点柱下钻」；不可下钻时没有「· 点柱下钻」 */
  sub: (period: string, drillable: boolean) =>
    `按渠道堆叠 · ${period}${drillable ? ' · 点柱下钻' : ''}`,
  detail: '查看明细',
  /** 图例与悬停的两组渠道（同 P04 下钻芯片的叫法） */
  amazon: reportChannelGroupLabels.amazon,
  shopifyEmail: reportChannelGroupLabels.shopify_email,
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
  costChart: '售后成本按责任类型条形图',
  costDrill: (label: string) => `${label}：查看明细`,
} as const;

/**
 * 售后成本按责任类型（原型 p17_p1_cost()、K19 补充小样⑥⑦，PRD P17「第一阶段」v2.35，待办 25）：本月、随店铺不随时间与站点；
 * 卡头总额即售后成本；悬停与原型 Reports 的 drill_tip() 一致；责任类型为空的单列「未登记责任」、不可点（悬停没有下钻那一行）
 */
export const COST = {
  /** 标题、带锁的标签、副标题与来源说明：画面与导出共用（contracts 的 REPORT_COST） */
  title: REPORT_COST.title,
  tag: REPORT_COST.tag,
  sub: REPORT_COST.sub,
  detail: '查看明细',
  /** 卡头总额旁：「售后成本 · 12 单 · 来自登记台账，不含待确认 · 点条下钻」；没有可点的条时没有「· 点条下钻」 */
  totalNote: (count: number, drillable: boolean) =>
    `售后成本 · ${count} 单 · ${REPORT_COST.source}${drillable ? ' · 点条下钻' : ''}`,
  /** 本月没有时（补充小样⑦） */
  empty: '本月还没有登记的售后成本',
  /** 悬停：「产品质量问题 · $118.89」「本月登记台账，不含待确认」「点击查看明细 → P13 登记台账（已按责任筛选）」 */
  tipTitle: (name: string, amount: string) => `${name} · ${amount}`,
  tipSource: '本月登记台账，不含待确认',
  tipDrill: '点击查看明细 → P13 登记台账（已按责任筛选）',
  /** 未登记责任的悬停第二行（补充小样⑥）：「3 单 · 责任类型未登记」 */
  tipUnregistered: (count: number) => `${count} 单 · 责任类型未登记`,
} as const;

/** 导出（K5、K19 补充小样⑧）：页头右侧「导出」，生成中「正在生成，约 3 秒」，完成浮层「已导出 报表_近7天_0905-0911.xlsx · 已记入审计日志」 */
export const EXPORT = {
  button: '导出',
  busy: '正在生成，约 3 秒',
  done: (fileName: string) => `已导出 ${fileName}`,
  doneDescription: '已记入审计日志',
  /** 失败浮层「导出失败：原因」+「立即重试」（G5，同 P13） */
  failedAction: '导出',
} as const;
