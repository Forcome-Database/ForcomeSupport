/*
 * P18 渠道与店铺的界面文案（逐字照原型；p18-copy.test.ts 直接读原型生成物核对，原型改了而这里没跟上就失败）：
 * 第一期参照页 design/spec/phase1/P18_Settings.dc.html，状态板 design/StatesAdmin.dc.html 的 K8（含补充小样）与 K20，
 * 全局状态 design/GlobalStates.dc.html 的 G8。表单校验与接口的报错文案在 contracts 的 channel.ts，同一个测试一并核对。
 */

/** 页头说明（P18「第一阶段」） */
export const PAGE_DESCRIPTION =
  '订单由平台直读；客户来信统一经 Gmail 收取。店铺决定订单匹配与数据权限。';

/** 设置菜单底注（第一阶段） */
export const MENU_NOTE = '第一阶段只开放这两项设置';

/** 「渠道连接」旁 ⓘ 的说明 */
export const RULE_CARD_STATE =
  '卡片显示该渠道下最差的状态，并列出异常的邮箱或店铺；店铺表「状态」列显示该店铺各连接的状态。' +
  '同步延迟按数据源阈值：Gmail、订单 10 分钟，钉钉 2 小时；连续 3 次失败为连接异常。' +
  '钉钉例外：异常只在钉钉卡显示、只提醒管理员，不出全站横幅（6.9）。';

/** 店铺表「进线识别」ⓘ 的说明（第一阶段版，与 PRD D-26 一致；10-05 用户确认） */
export const RULE_ROUTE =
  '亚马逊按买家消息的收件邮箱与发件域名（amazon.com / .ca / .com.mx）识别店铺和站点；Shopify 按客服邮箱。' +
  '一个店铺可以登记多个进线邮箱（含别名）。识别不出的来信进入「未归属店铺」队列，由客服主管指定店铺。';

/** 渠道卡的固定说明行（店铺数、邮箱数那一行按数据写） */
export const CARD_LINES = {
  gmailSent: '收件与「已发送」：识别到我方回复即转等客户',
  dingtalk: ['通讯录：成员与部门每小时同步', '工作通知推送；扫码登录'],
} as const;

/** 未连接时卡头的副标题（K20 小样） */
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
} as const;

/** 保存结果浮层（K8 补充小样；失败浮层的标题由 notify 写成「保存失败：原因」） */
export const SAVE_RESULT = {
  savedTitle: '店铺已保存',
  savedDescription: (storeName: string, who: string, at: string) =>
    `${storeName}，已记入审计日志（${who} ${at}）。`,
  failedDescription: '填写的内容已保留在抽屉里。',
} as const;

/** 有未保存的输入时关闭抽屉（G8；新增的写法见 K8 补充小样，编辑照 G8 的「有 N 项未保存的修改」） */
export const LEAVE = {
  create: '「新增店铺」填写的内容还没保存，放弃后不保留。',
  edit: (count: number) => `「编辑店铺」有 ${count} 项未保存的修改。放弃后恢复为上次保存的值。`,
} as const;
