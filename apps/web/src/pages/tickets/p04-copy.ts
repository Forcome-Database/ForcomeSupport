/*
 * P04 工单列表的界面文案（逐字照原型；p04-copy.test.ts 直接读原型生成物核对）：第一期参照页
 * design/spec/phase1/P04_Tickets.dc.html、P04_Tickets_drill.dc.html，状态板 design/StatesInbox.dc.html 的 I10、I16。
 * 状态、渠道、来源、最近来信的叫法在 contracts（ticket.ts、ticket-list.ts）；原型没画的下钻写法照 PRD P04「第一阶段」v2.32
 * （协调者 2026-10-14 决定 Q1–Q4），拼句子在 p04-words.ts。界面上看得见的文字都在这里，组件里不写死。
 */

/** 页头（P04「第一阶段」：标题「工单」，说明「全部渠道 · 全部店铺」；右侧「只读 · 数据变化时自动刷新」） */
export const PAGE_TITLE = '工单';
export const PAGE_DESCRIPTION = '全部渠道 · 全部店铺';
export const LIVE_NOTE = '只读 · 数据变化时自动刷新';

/** 九列（来源的取值叫法在 contracts 的 messageSourceLabels）；SLA 剩余与最近来信可排序（Q2） */
export const COLUMNS = {
  number: '工单号',
  subject: '主题',
  source: '来源',
  channelStore: '渠道与店铺',
  customer: '客户',
  /** 关联的订单号（R-TK-01，待办 14）：亚马逊订单号或 Shopify 订单名，没有关联订单写「—」 */
  orderNumber: '订单号',
  status: '状态',
  sla: 'SLA 剩余',
  lastInbound: '最近来信',
} as const;

/** 可排序表头的箭头（原型 sort_head()：当前排序列主色加 ↑ / ↓，其余可排序列灰色 ↕） */
export const SORT_ARROWS = { asc: '↑', desc: '↓', none: '↕' } as const;

/** SLA 列：等客户写「已回复」，已解决、已关闭与没有应回复来信的待回复写「—」（剩余与已超时的写法在 contracts 的 slaRemainingWords） */
export const SLA_REPLIED = '已回复';

/** 筛选行（原型 p1_filters()）：芯片名，下拉第一项「全部」清除该条件；条件偏离默认时芯片后「清除筛选」（I10） */
export const FILTERS = {
  status: '状态',
  channel: '渠道',
  store: '店铺',
  site: '站点',
  source: '来源',
  inbound: '最近来信',
  clear: '清除筛选',
} as const;

/**
 * 从报表下钻进入（I16 ②、PRD P04「第一阶段」v2.32）：筛选行最前面的「来自报表：条件 ×」芯片与计数行。
 * 拼句子在 p04-words.ts
 */
export const DRILL = {
  chip: '来自报表',
  remove: '移除这条筛选',
  /** 按事件计（工单量）：「09-10 新建或重开 · 客户来信」；按封计（首响、SLA）：「09-10 到达 · 亚马逊来信 · 未达标」 */
  triggered: '新建或重开',
  arrived: '到达',
  customerLetter: '客户来信',
  /** 按封计时被计数的来信带渠道：「亚马逊来信」「Shopify 与邮件来信」 */
  letterOf: (channel: string) => `${channel}来信`,
  /** 报表图例的两组渠道 */
  channels: { amazon: '亚马逊', shopify_email: 'Shopify 与邮件' },
  letterStates: { replied: '已回复', met: '达标', missed: '未达标', pending: '未到期' },
  /** 日期：单天「09-10」，区间「09-04 至 09-10」 */
  range: (from: string, to: string) => `${from} 至 ${to}`,
  /** 计数行左侧（事件数等于工单数时「共 73 条」） */
  count: (tickets: number) => `共 ${tickets} 条`,
  eventsCount: (events: number, tickets: number) => `共 ${events} 次新建或重开 · ${tickets} 张工单`,
  lettersCount: (letters: number, tickets: number) => `共 ${letters} 封来信 · ${tickets} 张工单`,
  /** 计数行的说明：「条件与报表「每日工单量」09-10 的柱同口径：客户来信触发的新建或重开 09-10」 */
  note: (origin: string, condition: string) => `条件与报表${origin}同口径：${condition}`,
  triggeredCondition: '客户来信触发的新建或重开',
  /** 出处（地址栏的 origin 枚举键 → 文字） */
  origins: {
    dailyBar: (day: string) => `「每日工单量」${day} 的柱`,
    dailyLegend: (channel: string) => `「每日工单量」图例「${channel}」`,
    daily: '「每日工单量」',
    volume: '指标「工单量」',
    firstResponse: '指标「首响中位数」',
    sla: '指标「SLA 达标率（亚马逊）」',
  },
} as const;

/**
 * 列表为空：I10「筛选无结果」——标题、「当前筛选：…」、清除筛选。清除后（默认的近 30 天、其余不选）一张都没有时
 * 不写「查看全部 N 张」，照 P13 的写法「换个条件试试。」
 */
export const EMPTY_TITLE = '没有符合条件的工单';
export const EMPTY = {
  filter: (label: string, value: string) => `${label} ${value}`,
  description: (filters: readonly string[], clearable: boolean, total: number) =>
    `当前筛选：${filters.join(' · ')}。` +
    (!clearable
      ? ''
      : total > 0
        ? `换个条件，或清除筛选后查看全部 ${total} 张。`
        : '换个条件试试。'),
} as const;

/** 表下的分页（原型「共 16 条 · 每页 20 条 · 已超时在前…」「上一页 1 / 1 下一页」，禁用时悬停写原因） */
export const PAGER = {
  summary: (total: number, pageSize: number) => `共 ${total} 条 · 每页 ${pageSize} 条`,
  /** 默认排序时接在条数后面的说明（按最近来信或反向排序时不写） */
  defaultOrder:
    '已超时在前，其后按 SLA 剩余升序，再按 待回复 → 等客户 → 已解决 → 已关闭，组内按最近来信倒序',
  prev: '上一页',
  next: '下一页',
  position: (page: number, pages: number) => `${page} / ${pages}`,
  first: '已是第一页',
  last: (total: number, pageSize: number) => `已是最后一页（共 ${total} 条，每页 ${pageSize} 条）`,
} as const;

/** 没有值的单元格（原型「—」） */
export const EMPTY_VALUE = '—';

/** 只给读屏器的说明（原型不画、不核对） */
export const A11Y = {
  table: '工单列表',
  customRange: '自定义最近来信',
} as const;

/**
 * 未归属店铺来信队列（I17 与补充小样③–⑥，第一期参照页 P04_Tickets_unassigned、P04_Tickets_unassigned_empty；
 * 待办 15，协调者 2026-10-07 决定）。识别依据的头字段写法、SLA 目标的写法在 contracts 的 unassigned-mail.ts
 */
export const UNASSIGNED = {
  /** 筛选行右侧的入口：说明与按钮（按钮后是计数） */
  entryHint: '仅客服主管可见',
  entry: '未归属店铺',
  title: '未归属店铺',
  scope: '仅客服主管可见 · 不受店铺数据范围限制',
  noteTitle: (n: number) => `${n} 封来信识别不出店铺`,
  noteDescription: 'SLA 按原到达时间照常计时 · 管理员登记新店铺后，收件地址匹配的来信会自动归位',
  columns: {
    mail: '来信',
    basis: '识别依据',
    arrivedAt: '到达',
    sla: 'SLA',
    store: '指定店铺（只列你的授权店铺）',
  },
  unregistered: '未登记',
  fromDomain: (domain: string) => `发件域 ${domain}`,
  storePlaceholder: '选择店铺',
  assign: '指定',
  /** 「指定」在还没选店铺时置灰，悬停写原因（Q7） */
  assignDisabled: '先选择店铺',
  /** 队列为空（④） */
  empty: '没有识别不出店铺的来信',
  /** 点「指定」后的撤销浮层（②） */
  undoTitle: (store: string) => `已归入 ${store}`,
  undoDescription: '5 秒后归并成工单',
  /** 窗口结束提交失败（⑤⑥，Q8）：标题「指定店铺失败：原因」 */
  failedAction: '指定店铺',
  stillQueued: '来信仍在未归属店铺队列里',
  taken: '这封来信已被指定或已自动归位',
} as const;
