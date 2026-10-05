/*
 * P18 渠道与店铺的界面文案（逐字照原型；p18-copy.test.ts 直接读原型生成物核对，原型改了而这里没跟上就失败）：
 * 第一期参照页 design/spec/phase1/P18_Settings.dc.html，状态板 design/StatesAdmin.dc.html 的 K8（含补充小样）与 K20，
 * 全局状态 design/GlobalStates.dc.html 的 G8。表单校验与接口的报错文案、平台与连接状态的叫法在 contracts 的 channel.ts，
 * 菜单项的页面名在 lib/pages.ts，同一个测试一并核对。界面上看得见的文字都在这里，组件里不写死。
 */

/** 页头标题与说明（P18「第一阶段」） */
export const PAGE_TITLE = '渠道与店铺';
export const PAGE_DESCRIPTION =
  '订单由平台直读；客户来信统一经 Gmail 收取。店铺决定订单匹配与数据权限。';

/** 设置菜单的标题与底注（第一阶段；菜单项的名字取 lib/pages.ts 的页面名） */
export const MENU_TITLE = '设置';
export const MENU_NOTE = '第一阶段只开放这两项设置';

/** 「渠道连接」区块：小标题与 ⓘ 的短标题 */
export const CHANNEL_SECTION = { label: '渠道连接', ruleLabel: '卡片状态按店铺计算' } as const;

/** 「渠道连接」旁 ⓘ 的说明 */
export const RULE_CARD_STATE =
  '卡片显示该渠道下最差的状态，并列出异常的邮箱或店铺；店铺表「状态」列显示该店铺各连接的状态。' +
  '同步延迟按数据源阈值：Gmail、订单 10 分钟，钉钉 2 小时；连续 3 次失败为连接异常。' +
  '钉钉例外：异常只在钉钉卡显示、只提醒管理员，不出全站横幅（6.9）。';

/** 店铺表「进线识别」ⓘ 的说明（第一阶段版，与 PRD D-26 一致；10-05 用户确认） */
export const RULE_ROUTE =
  '亚马逊按买家消息的收件邮箱与发件域名（amazon.com / .ca / .com.mx）识别店铺和站点；Shopify 按客服邮箱。' +
  '一个店铺可以登记多个进线邮箱（含别名）。识别不出的来信进入「未归属店铺」队列，由客服主管指定店铺。';

/** 渠道卡的卡名与按数据写的说明行（K20：「2 个店铺 · 订单经 SP-API 准实时同步」「4 个邮箱：2 个亚马逊买家消息、2 个 Shopify 客服」） */
export const CHANNEL_CARDS = {
  amazon: {
    name: '亚马逊 SP-API',
    stores: (count: number) => `${count} 个店铺 · 订单经 SP-API 准实时同步`,
  },
  shopify: {
    name: 'Shopify Admin API',
    stores: (count: number) => `${count} 个店铺 · 订单经 Admin API 准实时同步`,
  },
  gmail: {
    name: 'Gmail',
    /** 邮箱数；某一类没有就不写 */
    mailboxes: (amazon: number, shopify: number) => {
      const parts = [
        amazon > 0 ? `${amazon} 个亚马逊买家消息` : null,
        shopify > 0 ? `${shopify} 个 Shopify 客服` : null,
      ].filter(Boolean);
      const total = amazon + shopify;
      return parts.length > 0 ? `${total} 个邮箱：${parts.join('、')}` : `${total} 个邮箱`;
    },
  },
  dingtalk: { name: '钉钉' },
} as const;

/** 渠道卡的固定说明行 */
export const CARD_LINES = {
  gmailSent: '收件与「已发送」：识别到我方回复即转等客户',
  dingtalk: ['通讯录：成员与部门每小时同步', '工作通知推送；扫码登录'],
} as const;

/** 页头右上（原型 btn('查看审计日志', 'secondary', 'md', 'history')）：进入 P27，管理员另一个入口（PRD P27） */
export const VIEW_AUDIT_LOG = '查看审计日志';

/** 卡头：接模拟数据时的标签、最近同步时间、未连接时的副标题（K20 小样） */
export const SIMULATED = '模拟数据';
export const LAST_SYNC = (at: string) => `最近同步 ${at}`;
export const NOT_AUTHORIZED = '尚未授权';

/** 第一阶段尚未接入的渠道（灰色虚线卡） */
export const PHASE2_CARDS = {
  badge: '第二阶段接入',
  subtitle: '暂不连接',
  jijia: { name: '积加 ERP', description: '亚马逊订单收件人、库存、售后出库单、单号与运费。' },
  yicang: {
    name: '易仓海外仓',
    description: '库存与售后出库单经积加读写，本系统不直连易仓接口。',
  },
} as const;

/** 「店铺」区块：小标题、店铺数、ⓘ 的短标题与「新增店铺」 */
export const STORE_SECTION = {
  label: '店铺',
  count: (count: number) => `${count} 个`,
  ruleLabel: '进线识别',
  create: '新增店铺',
} as const;

/** 店铺表：表头、行尾「编辑」、站点悬停（默认站点）、状态列的连接名（订单连接取 contracts 的 platformTerms.ordersApi） */
export const STORE_TABLE = {
  columns: {
    store: '店铺',
    sites: '站点（加粗为默认）',
    mailboxes: '进线邮箱',
    platformId: '平台标识',
    status: '状态',
  },
  edit: '编辑',
  defaultSiteTitle: (site: string) => `默认站点 ${site}`,
  gmail: 'Gmail',
  /** 站点之间、状态列各连接之间的分隔 */
  separator: ' · ',
} as const;

/** 店铺表为空（生产环境上线初期，K8 补充小样） */
export const EMPTY_STORES = {
  title: '还没有店铺',
  description: '新增店铺并登记进线邮箱后，来信才能识别店铺、匹配订单。',
} as const;

/** 新增 / 编辑店铺抽屉（K8） */
export const DRAWER = {
  createTitle: '新增店铺',
  editTitle: '编辑店铺',
  description: '保存记入审计日志；未归属队列中收件地址与新店铺进线邮箱匹配的来信自动归位。',
  labels: {
    platform: '平台',
    name: '店铺名',
    sites: '站点（多选）',
    defaultSite: '默认站点',
    mailboxes: '进线邮箱（可填多个，含别名）',
    platformId: '平台标识',
    dataSource: '数据来源',
  },
  defaultSiteHint: '无订单的来信按它归站点',
  mailboxHint: '每个地址都用来识别店铺；寄到这些地址的未归属来信保存后自动归位',
  dataSourceBadge: '仅开发测试环境',
  dataSourceOptions: { real: '真实接口', fake: '模拟数据' },
  dataSourceNote: '生产环境不显示此项；接模拟数据时渠道卡头标「模拟数据」。',
  /** 下拉没选时的占位（原型 select_box() 的默认占位） */
  placeholder: '请选择',
  cancel: '取消',
  save: '保存',
} as const;

/** 保存结果浮层（K8 补充小样；失败浮层的标题由 notify 写成「<动作>失败：原因」） */
export const SAVE_RESULT = {
  savedTitle: '店铺已保存',
  savedDescription: (storeName: string, who: string, at: string) =>
    `${storeName}，已记入审计日志（${who} ${at}）。`,
  failedAction: '保存',
  failedDescription: '填写的内容已保留在抽屉里。',
} as const;

/** 有未保存的输入时关闭抽屉（G8；新增的写法见 K8 补充小样，编辑照 G8 的「有 N 项未保存的修改」） */
export const LEAVE = {
  create: '「新增店铺」填写的内容还没保存，放弃后不保留。',
  edit: (count: number) => `「编辑店铺」有 ${count} 项未保存的修改。放弃后恢复为上次保存的值。`,
} as const;

/**
 * 只给读屏器的说明（原型上不画，测试不核对）：区块名、设置菜单、复制与移除按钮、编辑链接、表头的操作列。
 * 界面上看得见的文字一律在上面各组里。
 */
export const A11Y = {
  channelsRegion: CHANNEL_SECTION.label,
  storesRegion: STORE_SECTION.label,
  settingsNav: MENU_TITLE,
  copy: (value: string) => `复制 ${value}`,
  copied: '已复制',
  edit: (storeName: string) => `${STORE_TABLE.edit} ${storeName}`,
  removeMailbox: (mailbox: string) => `移除 ${mailbox}`,
  actionsColumn: '操作',
} as const;
