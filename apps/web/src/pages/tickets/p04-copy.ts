/*
 * P04 工单列表的界面文案（逐字照原型；p04-copy.test.ts 直接读原型生成物核对）：第一期参照页
 * design/spec/phase1/P04_Tickets.dc.html，状态板 design/StatesInbox.dc.html 的 I10。状态与渠道的叫法在 contracts 的 ticket.ts。
 * 界面上看得见的文字都在这里，组件里不写死。
 */

/** 页头（P04「第一阶段」：标题「工单」，说明「全部渠道 · 全部店铺」） */
export const PAGE_TITLE = '工单';
export const PAGE_DESCRIPTION = '全部渠道 · 全部店铺';

/** 待办 08 的六列（来源、订单号、SLA 剩余随 10、14、16、18 加在原型的位置上） */
export const COLUMNS = {
  number: '工单号',
  subject: '主题',
  channelStore: '渠道与店铺',
  customer: '客户',
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
export const A11Y = {
  table: '工单列表',
  loading: '正在加载工单',
} as const;
