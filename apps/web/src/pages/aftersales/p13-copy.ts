import { registrationMessages, type OwnerNote } from '@forcome/contracts';

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
 * 台账的列（最简列表；费用合计、FSH / 工厂承担、行尾「更多」随 21、22 加在原型的位置上，快递单号的「待回填」与补登随 21）。
 * 金额三列只给有财务权限的角色（坐席看不到），写冻结的美元值，非美元另起一行写原币与汇率日期（待办 20）。
 */
export const COLUMNS = {
  number: '售后单号',
  customer: '客户',
  storeSite: '店铺与站点',
  method: '处理方式',
  responsibility: '责任',
  status: '状态',
  trackingNumber: '快递单号',
} as const;
export const FINANCE_COLUMNS = {
  productCost: '产品成本',
  freight: '运费',
  compensation: '额外赔偿',
} as const;

/**
 * 非美元金额（原型 p1_comp()、S13、R-FL-06）：美元值下方一行写原币与汇率日期（例「MX$889.00 · 汇率 09-10」），
 * 悬停说明汇率怎么来的——按来源区分（S14 补充小样之二，PRD v2.17）：欧洲央行与备用源（数据同样来自欧洲央行）写取汇率的口径，
 * 售后负责人手工修改的写明是手工修改的汇率
 */
export const FOREIGN_AMOUNT = {
  /** 原币与汇率日期之间（窄的金额列里在这里换行） */
  separator: ' · ',
  rateDate: (date: string) => `汇率 ${date}`,
  /** 欧洲央行、备用源 */
  publishedTitle: '汇率取费用发生日的欧洲央行日汇率；售后负责人可修改并记审计',
  /** 手工修改（rate 是两位小数的写法，如「17.50」） */
  manualTitle: (rate: string, currency: string) =>
    `汇率为手工修改：1 USD = ${rate} ${currency}（售后负责人修改，已记入审计日志）`,
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
  /** 非美元金额框下的折算（S14 编辑登记小图「≈ $49.39 · 汇率 09-10（1 USD = 18.00 MXN）」） */
  feeConversion: (usd: string, rateDate: string, rate: string, currency: string) =>
    `≈ ${usd} · 汇率 ${rateDate}（1 USD = ${rate} ${currency}）`,
  /** 费用发生日及之前没有汇率（同保存时的报错，contracts 的 registrationMessages.noRate） */
  feeNoRate: registrationMessages.noRate,
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

/**
 * 抽屉里的查询失败（接口出错，不是查无结果）：来源工单与费用发生日的汇率，G5 失败浮层「查询失败：原因」+「立即重试」
 */
export const LOOKUP = { failedAction: '查询' } as const;

/** 关闭抽屉时还有未保存的输入（G8，新建的写法同 P18） */
export const LEAVE = '「新建登记」填写的内容还没保存，放弃后不保留。';

/**
 * 页头的当月登记完整率（原型 build_ledger.completion()，S13；当月没有已完成的单写「—」、不可点，S15 补充小样）
 */
export const COMPLETION = {
  label: (month: number) => `${month} 月登记完整率`,
  empty: '—',
  ratio: (complete: number, completed: number) => `${complete} / ${completed}`,
  target: '· 目标 ≥ 98%',
  filter: (count: number) => `筛出缺字段的 ${count} 单`,
  allComplete: '无缺字段的单',
  title:
    '已完成售后单中适用字段齐全的比例，按完成时间归月，历史导入不计（R-AS-08）。点击筛出缺字段的已完成单',
} as const;

/** 点完整率后的筛选芯片（S15 补充小样：选中态，带 ×，右侧「清除筛选」） */
export const MISSING_FILTER = {
  label: '缺字段的已完成单：',
  month: (month: number) => `${month} 月`,
  remove: '移除这条筛选',
  clear: '清除筛选',
} as const;

/** 已完成的单缺适用字段（S13：单元格标黄「待回填」、售后单号下标「缺 N 项」，悬停列出缺的字段；S15 ③ 行内补登） */
export const MISSING = {
  badge: (count: number) => `缺 ${count} 项`,
  title: (labels: readonly string[]) => `缺：${labels.join('、')}（含隐藏列里的字段）`,
  pending: '待回填',
  backfill: '补登',
  save: '保存',
  /** 行内补登时快递单号为空，「保存」禁用的原因 */
  saveNeedsValue: '先填写快递单号',
} as const;

/** 补登的结果浮层（S15 ③；抽屉里补登几项写字段名，S14 补充小样之三） */
export const BACKFILL_RESULT = {
  title: '已补登 · 已记入审计日志',
  inline: (number: string, tracking: string) => `${number} 快递单号 ${tracking}`,
  drawer: (number: string, labels: readonly string[]) => `${number} 补登了 ${labels.join('、')}`,
  failedAction: '补登',
} as const;

/** 行尾「更多」（S15 ①；改派负责人随待办 23）与不可用时悬停的原因（S15 补充小样） */
export const MORE = {
  complete: '设为已完成',
  cancel: '取消售后单',
  reasons: {
    completed: '这张单已完成',
    cancelled: '这张单已取消',
    notEditor: '只有登记人或负责人可以设为已完成',
    cancelCompleted: '已完成的单不能取消',
  },
} as const;

/** 设为已完成的撤销浮层（S15 ①：缺字段时第二行写「缺 N 项，已标黄待回填」，不缺只写标题）与失败浮层 */
export const COMPLETE_RESULT = {
  title: (number: string) => `${number} 已完成`,
  missing: (count: number) => `缺 ${count} 项，已标黄待回填`,
  failedAction: '设为已完成',
  undoFailedAction: '撤销',
} as const;

/** 操作时这张单刚被别人改过（409）：失败浮层的说明（设为已完成、取消、补登同理），台账随之刷新 */
export const STALE = '已刷新为最新内容，请核对后再操作。';

/** 取消售后单的二次确认（S15 ②；原型说明里的「默认焦点在「取消」」是给人看的规格，不做进界面） */
export const CANCEL = {
  title: (number: string) => `取消 ${number}？`,
  description: (customer: string, method: string, responsibility: string) =>
    `${customer} · ${method} · ${responsibility}`,
  reason: '取消原因',
  reasonPlaceholder: '例如：客户撤回售后申请、改为退款处理',
  fees: '已登记费用 · 勾选取消后保留的已产生部分',
  feesDefault: '默认全部保留',
  keptTotal: (feeDate: string) => `保留合计 · 按费用发生日 ${feeDate} 计入售后成本`,
  notes: [
    '已取消的单不能恢复；保留的费用照常计入售后成本。',
    '未勾选的项不计入售后成本，登记值与取消原因记入审计日志。',
  ],
  dismiss: '取消',
  confirm: '取消售后单',
  doneTitle: (number: string) => `已取消售后单 ${number}`,
  doneDescription: '已记入审计日志。',
  failedAction: '取消售后单',
} as const;

/**
 * 编辑登记抽屉（S14「编辑登记 · S-…」与补充小样之三）：同新建登记的抽屉，标题、说明、顶部状态行、底部按钮与「修改汇率」
 */
export const EDIT = {
  title: (number: string) => `编辑登记 · ${number}`,
  description:
    '进行中：登记人或负责人可改全部字段；已完成：只有售后负责人补登缺失字段；已取消：只读',
  summary: (customer: string, storeSite: string, method: string) =>
    `${customer} · ${storeSite} · ${method}`,
  owner: (name: string) => `· 负责人 ${name}`,
  rateLink: '修改汇率',
  rateNote: '取费用发生日的欧洲央行日汇率；只有售后负责人可改，记入审计日志',
  rateDenied: '只有售后负责人可以修改汇率',
  ratePrefix: '1 USD =',
  footerNote: '修改记入审计日志',
  save: '保存修改',
  close: '关闭',
  errorsDescription: (first: string) => `已滚动到第一个错误「${first}」；改完后再点「保存修改」。`,
  savedTitle: '登记已保存',
  savedDescription: (number: string, customer: string) =>
    `${number} · ${customer}，已记入审计日志。`,
  /** 编辑时有未保存的修改就关闭（G8 编辑的写法） */
  leave: (count: number) => `「编辑登记」有 ${count} 项未保存的修改。放弃后恢复为上次保存的值。`,
} as const;

/** 只给读屏器的说明（原型不画、不核对） */
export const A11Y = {
  table: '登记台账',
  currency: (field: string) => `${field}的币种`,
  ratio: (group: string, side: string) => `${group} ${side}`,
  more: (number: string) => `${number} 的更多操作`,
  open: (number: string) => `打开 ${number} 的登记`,
  rate: (field: string) => `${field}的汇率`,
  tracking: (number: string) => `${number} 的快递单号`,
  keep: (field: string) => `保留${field}`,
} as const;
