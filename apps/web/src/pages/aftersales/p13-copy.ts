import { formatMoney, type Currency, type OwnerNote } from '@forcome/contracts';

/*
 * P13 登记台账与新建登记抽屉的界面文案（逐字照原型；p13-copy.test.ts 直接读原型生成物核对）：第一期参照页
 * design/spec/phase1/P13_AfterSalesLog(.dc.html、_agent)，状态板 design/StatesAfterSales.dc.html 的 S10、S14（及其补充小样）。
 * 取值的叫法（状态、处理方式、责任类型、发货方、索赔、费用项、比例组）与报错在 contracts 的 aftersales.ts。
 * 界面上看得见的文字都在这里，组件里不写死。
 */

/** 页头（P13「第一阶段」：只有标题，没有「售后单」「内部结算」页签） */
export const PAGE_TITLE = '登记台账';
export const PAGE_DESCRIPTION = {
  /** 客服主管、售后负责人 */
  finance: '售后单的处理方式、费用与承担比例 · 第一阶段由客服主管、售后负责人手工登记',
  /** 坐席只读 */
  readOnly: '售后单的处理方式与寄件登记 · 只读，不含财务字段',
} as const;

/** 右上「新建登记」（客服主管、售后负责人） */
export const NEW_REGISTRATION = '新建登记';

/**
 * 台账的列（待办 19 的最简列表；快递单号、费用合计、FSH / 工厂承担、更多随 21、22 加在原型的位置上）。
 * 金额三列只给有财务权限的角色（坐席看不到）。
 */
export const COLUMNS = {
  number: '售后单号',
  customer: '客户',
  storeSite: '店铺与站点',
  method: '处理方式',
  responsibility: '责任',
  status: '状态',
} as const;
export const FINANCE_COLUMNS = {
  productCost: '产品成本',
  freight: '运费',
  compensation: '额外赔偿',
} as const;

/** 店铺与站点（原型 store_site()：「Forcome Direct · US」） */
export function storeSite(store: string, site: string | null): string {
  return site ? `${store} · ${site}` : store;
}

/** 没有值的单元格（原型 na()） */
export const EMPTY_VALUE = '—';

/** 列表为空：S10 的标题（筛选随 22，在那之前只显示标题，同 P04 在 08 的做法） */
export const EMPTY_TITLE = '没有符合条件的售后单';

/** 新建登记抽屉（S14） */
export const DRAWER = {
  createTitle: '新建登记',
  description: '按处理方式列出适用字段（R-AS-08），不适用的不显示；保存时校验全部',
  sections: {
    method: '处理方式',
    methodNote: '按 R-AS-08 只列适用字段',
    basic: '基本信息',
    responsibility: '责任与承担比例',
    shipping: '寄件',
    shippingNote: '进行中可后填；完成时缺失计入「待回填」',
    fees: '费用（原币）',
    feeTotal: (total: string) => `费用合计 ${total}`,
  },
  /** 处理方式的三张卡片：标题与说明 */
  methods: {
    adjust_installation: '不寄东西',
    send_parts: '含换新、整机补发',
    refund_or_compensation: '款项记在额外赔偿',
  },
  labels: {
    storeId: '店铺',
    site: '站点',
    orderNumber: '订单号',
    customerName: '客户',
    sourceTicket: '来源工单',
    feeDate: '费用发生日',
    ownerId: '负责人',
    responsibility: '责任类型',
    factory: '生产厂',
    responsibilityReason: '责任理由',
    claimTarget: '索赔对象',
    claimStatus: '索赔状态',
    ratios: '承担比例（三组）',
    partSku: '配件',
    partQuantity: '数量',
    shipper: '发货方',
    carrier: '承运方式',
    shipDate: '寄出日期',
    trackingNumber: '快递单号',
  },
  sourceTicketNote: '可不填',
  /** 负责人旁的灰字（D-24、AC-P1-18） */
  ownerNotes: {
    only: '该店铺唯一的售后负责人，已默认',
    self: '已默认为你本人',
    choose: '只列有该店铺数据范围的售后负责人',
    none: '只列有该店铺数据范围的售后负责人',
    no_store: '',
  } satisfies Record<OwnerNote, string>,
  /** 没选店铺时负责人下拉不可用，悬停说明 */
  ownerNeedsStore: '先选店铺',
  ownerOption: (name: string) => `${name}（售后负责人）`,
  /** 生产厂旁的灰字：寄配件按配件预填；其余写什么时候必填 */
  factoryFromPart: (sku: string) => `按配件 ${sku} 预填`,
  factoryRequired: '工厂比例大于 0 时必填',
  reasonPlaceholder: '责任为「其他」时说明依据，例如双方分摊的原因',
  reasonCounter: (length: number, max: number) => `${length} / ${max}`,
  partOption: (name: string, sku: string) => `${name} ${sku}`,
  quantitySuffix: '件 · 1–10',
  afterShipping: '寄出后填写',
  placeholder: '请选择',
  ratioNote: '按责任类型默认值预填，可改；改一侧另一侧自动补足 100',
  ratioHeaders: {
    group: '费用组',
    amount: '金额',
    fsh: 'FSH %',
    factory: '工厂 %',
    fshShare: 'FSH 承担',
    factoryShare: '工厂承担',
  },
  ratioTotal: (fsh: string, factory: string) => `FSH 合计 ${fsh} · 工厂合计 ${factory}`,
  ratioTotalError: '有比例错误，合计暂不计算',
  feesHint:
    '没有发生的填 0。每项可选 USD / CAD / MXN，非美元时下方即时显示折算美元与汇率日期（R-FL-06）',
  footerNote: '保存后状态为「进行中」，记入审计日志',
  footerNoteWithErrors: '保存按钮保持可点，点击后定位到第一个错误',
  cancel: '取消',
  save: '保存登记',
  errorsTitle: (count: number) => `有 ${count} 项需要修改`,
  errorsDescription: (first: string) => `已滚动到第一个错误「${first}」；改完后再点「保存登记」。`,
} as const;

/** 保存的结果浮层（G5；成功写单号与客户，失败同 P18） */
export const SAVE_RESULT = {
  savedTitle: '登记已保存',
  savedDescription: (number: string, customer: string) =>
    `${number} · ${customer}，状态「进行中」，已记入审计日志。`,
  failedAction: '保存',
  failedDescription: '填写的内容已保留在抽屉里。',
} as const;

/** 关闭抽屉时还有未保存的输入（G8，新建的写法同 P18） */
export const LEAVE = '「新建登记」填写的内容还没保存，放弃后不保留。';

/** 金额：原币写法（「$3.20」「MX$889.00」）；美元折算与汇率日期随待办 20 */
export function money(amount: string, currency: Currency): string {
  return formatMoney(amount, currency);
}

/** 只给读屏器的说明（原型不画、不核对） */
export const A11Y = {
  table: '登记台账',
  currency: (field: string) => `${field}的币种`,
  ratio: (group: string, side: string) => `${group} ${side}`,
} as const;
