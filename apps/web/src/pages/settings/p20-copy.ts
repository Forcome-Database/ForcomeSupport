/*
 * P20 设置 · 团队与权限的界面文案（PRD P20「第一阶段」；原型第一期参照页 design/spec/phase1/P20_SettingsTeam.dc.html、
 * 状态板 StatesAdmin 的 K6、K17 与 GlobalStates 的 G7、G8）。文案逐字照原型，p20-copy.test.ts 直接读原型生成物核对。
 * 原型没画、实现时补的文案（抽屉、格子的编辑、冲突横幅等）按待办 06 向协调者确认的写法，确认后回写原型并纳入核对。
 * 校验与接口的报错在 contracts 的 teamMessages。
 */

/** 页头标题与说明（P20「第一阶段」：页头不显示备用审批人） */
export const PAGE_TITLE = '团队与权限';
export const PAGE_DESCRIPTION =
  '成员与部门来自钉钉通讯录；在这里分配角色与店铺数据范围。钉钉离职的成员自动停用。';

/** 页签（原型 team_tabs()：「成员」带人数） */
export const TABS = { members: '成员', permissions: '角色权限' } as const;

/** 「成员」区块：小标题、人数与同步时刻（原型「6 人 · 来自钉钉通讯录，10:00 同步」）、「从钉钉添加」 */
export const MEMBER_SECTION = {
  label: '成员',
  /** synced 是 contracts 的 syncedAtWords（「10:00 同步」「尚未同步」） */
  count: (count: number, synced: string) => `${count} 人 · 来自钉钉通讯录，${synced}`,
  add: '从钉钉添加',
} as const;

/** 成员表：表头（第一阶段没有「语言」列）、当前登录的管理员「（我）」 */
export const MEMBER_TABLE = {
  columns: {
    member: '成员',
    dept: '钉钉部门',
    roles: '角色',
    stores: '数据范围',
    status: '状态',
    lastLogin: '最近登录',
  },
  self: (name: string) => `${name}（我）`,
} as const;

/** 改过的格旁的标记（原型 edited_tag()） */
export const EDITED = '已修改';

/** 格子里的编辑（原型没画，待办 06 照 K6 补的）：数据范围的两个选项、不能取消最后一个角色、已停用的成员不能改 */
export const CELL_EDIT = {
  scopeOptions: { all: '全部店铺（含以后新增的）', some: '指定店铺' },
  lastRole: '至少保留一个角色；不再需要的成员请停用',
} as const;

/** 吸底保存栏（原型 save_bar()；有修改时说明写修改摘要，K6） */
export const SAVE_BAR = {
  clean: '没有未保存的修改',
  note: '角色与数据范围的修改在这里统一保存',
  dirty: (count: number) => `有 ${count} 项未保存修改`,
  discard: '放弃',
  save: '保存',
  noDiscard: '没有需要放弃的修改',
  noSave: '没有需要保存的修改',
  /** 几项修改之间 */
  separator: '；',
} as const;

/** 保存的结果（K6：成功、断网后自动重试；失败浮层的标题由 notify 写成「<动作>失败：原因」） */
export const SAVE_RESULT = {
  savedTitle: '设置已保存',
  savedDescription: (summary: string, who: string, at: string) =>
    `${summary}，已记入审计日志（${who} ${at}）。`,
  offlineTitle: '网络已断开，暂未保存',
  offlineDescription: '修改已保留在页面上。恢复连接后自动重试保存，无需手动操作。',
  waiting: '等待网络恢复…',
  retriedTitle: '已自动重试并保存',
  retriedDescription: (at: string, summary: string) =>
    `${at} 网络恢复后重试成功：${summary}，已记入审计日志。`,
  failedAction: '保存',
  failedDescription: '修改已保留在页面上。',
} as const;

/**
 * 摘要里一项修改的写法（照 K6「产品咨询 置信度阈值 80% → 85%」，字段写法同 P27「店铺范围：Forcome Direct → 全部店铺」；
 * 2026-10-06 用户确认）：「赵倩 店铺范围：Forcome Direct → 全部店铺」
 */
export const CHANGE_LINE = (who: string, field: string, before: string, after: string) =>
  `${who} ${field}：${before} → ${after}`;

/** 修改摘要与冲突说明里的字段名（同 P27 成员记录的字段名） */
export const FIELD_NAMES = { roles: '角色', stores: '店铺范围', status: '状态' } as const;

/** 保存时有人已被别人改过（G7，照 g7_occ 的写法；对象是成员表里的人） */
export const CONFLICT = {
  /** 几个人同时冲突、或不知道是谁改的时 */
  someone: '他人',
  title: (names: readonly string[], who: string | null, at: string | null) =>
    names.length > 1 || who === null
      ? `${names[0]}${names.length > 1 ? `等 ${names.length} 人` : ''}刚被他人修改`
      : `${names[0]}刚被${who}修改（${at}）`,
  description: (who: string | null, fields: readonly string[]) =>
    `${who !== null && fields.length > 0 ? `${who}改了：${fields.join('、')}。` : ''}你的修改还没保存，已保留在表格中；可先查看最新内容再改，或用你的内容覆盖。`,
} as const;

/** 有未保存的修改时离开本页（G8，照「编辑店铺」的写法） */
export const LEAVE = {
  page: (count: number) => `「团队与权限」有 ${count} 项未保存的修改。放弃后恢复为上次保存的值。`,
  drawer: '「从钉钉添加成员」填写的内容还没保存，放弃后不保留。',
} as const;

/** 「从钉钉添加」抽屉（原型没画，用 K8 同款抽屉拼；待办 06 向协调者确认的写法） */
export const DRAWER = {
  title: '从钉钉添加成员',
  description: '从钉钉通讯录选人并分配角色与店铺数据范围，分配后才能登录；保存记入审计日志。',
  labels: { member: '成员', roles: '角色', stores: '数据范围' },
  memberPlaceholder: '请选择',
  memberSearch: '搜索姓名或邮箱',
  noCandidates: '钉钉通讯录里的人都已分配角色',
  /** 搜索没有匹配的人 */
  noMatch: '没有匹配的人',
  rolesHint: '可多选，权限取并集',
  cancel: '取消',
  save: '保存',
} as const;

/** 添加成员的结果（失败浮层的标题由 notify 写成「<动作>失败：原因」） */
export const ADD_RESULT = {
  addedTitle: '已添加成员',
  addedDescription: (name: string, roles: string, who: string, at: string) =>
    `${name} · ${roles}，已记入审计日志（${who} ${at}）。`,
  failedAction: '保存',
  failedDescription: '填写的内容已保留在抽屉里。',
} as const;

/** 「角色权限」页签（K17 第一阶段）：小标题、说明、图例、表头 */
export const PERMISSIONS = {
  label: '角色权限',
  note: '只读 · 第一阶段只显示已上线的能力',
  legend: {
    full: '有权限',
    own: '只能看自己发起或负责的',
    none: '无权限',
    partial: '文字：部分能力',
  },
  columns: { group: '分组', capability: '能力' },
  none: '—',
} as const;

/** 成员行尾「更多」（K10 第一阶段补充小样 ⑤）：只有「停用」；不可用的原因是 contracts 的 disableMessages */
export const MEMBER_MENU = { disable: '停用' } as const;

/**
 * 停用成员的二次确认（K10 第一阶段补充小样，协调者 2026-10-14 决定 Q1–Q4）：只检查进行中售后单；没人可接手时的原因与怎么办是
 * contracts 的 disableMessages
 */
export const DISABLE = {
  title: (name: string) => `停用成员${name}？`,
  note: (name: string) =>
    `停用后${name}不能登录，现有会话立即失效；历史记录与操作日志保留。改派与停用记入审计日志。`,
  cases: '进行中售后单',
  count: (count: number) => `${count} 张`,
  noCases: '没有进行中的售后单，无需改派',
  owner: '接手人',
  ownerForStore: (store: string) => `接手人 · ${store}`,
  hint: '只列有该店铺范围的售后负责人',
  placeholder: '请选择',
  none: '没有可选的售后负责人',
  option: (name: string) => `${name}（售后负责人）`,
  dismiss: '取消',
  confirm: '改派并停用',
  doneTitle: (name: string) => `已停用 ${name}`,
  doneReassigned: (count: number, owners: readonly string[]) =>
    `${count} 张售后单已改派给 ${owners.join('、')}，已记入审计日志。`,
  doneNone: '已记入审计日志。',
  failedAction: '停用',
  /** 成员或他的售后单刚被别人改过（G7）：关掉弹窗、成员表刷新 */
  stale: '已刷新为最新内容，请核对后再操作。',
} as const;

/** 只给读屏器的说明（原型上不画，测试不核对） */
export const A11Y = {
  membersRegion: MEMBER_SECTION.label,
  permissionsRegion: PERMISSIONS.label,
  editRoles: (name: string) => `修改${name}的角色`,
  editStores: (name: string) => `修改${name}的数据范围`,
  saveBar: '保存修改',
  stores: '店铺',
  more: (name: string) => `${name} 的更多操作`,
} as const;
