/*
 * P04 工单列表的界面文案（逐字照原型；p04-copy.test.ts 直接读原型生成物核对）：第一期参照页
 * design/spec/phase1/P04_Tickets.dc.html，状态板 design/StatesInbox.dc.html 的 I10。状态与渠道的叫法在 contracts 的 ticket.ts。
 * 界面上看得见的文字都在这里，组件里不写死。
 */

/** 页头（P04「第一阶段」：标题「工单」，说明「全部渠道 · 全部店铺」） */
export const PAGE_TITLE = '工单';
export const PAGE_DESCRIPTION = '全部渠道 · 全部店铺';

/** 已有的八列（SLA 剩余随 18 加在原型的位置上）；来源的取值叫法在 contracts 的 messageSourceLabels */
export const COLUMNS = {
  number: '工单号',
  subject: '主题',
  source: '来源',
  channelStore: '渠道与店铺',
  customer: '客户',
  /** 关联的订单号（R-TK-01，待办 14）：亚马逊订单号或 Shopify 订单名，没有关联订单写「—」 */
  orderNumber: '订单号',
  status: '状态',
  lastInbound: '最近来信',
} as const;

/**
 * 列表为空：I10「筛选无结果」的标题。08 还没有筛选（随 18），只显示标题，不显示「当前筛选」与「清除筛选」
 * （10-05 协调者确认：沿用 I10、不新增文案；18 加上默认「近 30 天」筛选后补全为完整的 I10）
 */
export const EMPTY_TITLE = '没有符合条件的工单';

/** 没有值的单元格（原型「—」） */
export const EMPTY_VALUE = '—';

/** 只给读屏器的说明（原型不画、不核对） */
export const A11Y = { table: '工单列表' } as const;

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
