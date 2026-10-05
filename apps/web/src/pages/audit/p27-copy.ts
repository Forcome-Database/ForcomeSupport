import {
  auditPeriodLabels,
  AUDIT_PAGE_SIZE,
  type AuditPeriod,
  type AuditRange,
} from '@forcome/contracts';

/*
 * P27 审计日志的界面文案（PRD P27、K18、K5；参照图 design/spec/shots/phase1/P27_AuditLog.png 与 StatesAdmin 的 K18 及其补充小样：
 * 第一阶段几种记录、列表为空、导出、自定义时间）。逐字照原型（p27-copy.test.ts 直接读原型核对）。后端写出的摘要、前后值与
 * 「当前筛选」里时间以外的各项在 contracts（audit-describe.ts、audit-log.ts 的 auditConditionWords），同一个测试一并对照原型。
 */

export const PAGE_TITLE = '审计日志';
export const PAGE_DESCRIPTION = '全部操作记录 · 保留不少于 2 年';

/** 右上「导出」（K5：按当前筛选与字段权限同步生成，生成中转圈并写「正在生成，约 3 秒」，完成后浮层） */
export const EXPORT = {
  button: '导出',
  busy: '正在生成，约 3 秒',
  done: (fileName: string) => `已导出 ${fileName} · 已记入审计日志`,
  failedAction: '导出',
} as const;

/** 时间筛选（今天 · 近 7 天 · 自定义） */
export const PERIODS: Readonly<Record<AuditPeriod, string>> = auditPeriodLabels;

/** 筛选行 */
export const FILTERS = {
  actor: '操作人',
  type: '对象类型',
  action: '动作',
  search: '搜索对象编号',
  urlNote: '筛选条件写在地址栏',
  clear: '清除筛选',
} as const;

/** 只能看自己的角色（K18 ①）：页头下的横幅与锁定的操作人芯片 */
export const OWN_ONLY = {
  title: '你只能看到自己的操作记录',
  description: '操作人筛选已锁定为本人；客服主管与管理员可查看全部（10.2）。',
} as const;

/** 能看全部、但没有财务权限的角色（K18 ②，管理员） */
export const NO_FINANCE =
  '你的角色没有财务权限：成本、承担比例、结算金额的前后值显示「已隐藏」，其他字段照常显示。';

const monthDay = (date: string) => date.slice(5);

/**
 * 表头上方的时间（原型「09-11 今天」）：今天写「月-日 今天」，近 7 天写「起 至 止 近 7 天」，自定义写起止
 * （有一端不在今年时两端都写全年份）
 */
export function rangeHead(range: AuditRange, today: string): string {
  const thisYear = [range.from, range.to].every((date) => date.slice(0, 4) === today.slice(0, 4));
  const day = (date: string) => (thisYear ? monthDay(date) : date);
  if (range.period === 'today') return `${monthDay(range.from)} ${PERIODS.today}`;
  const span = range.from === range.to ? day(range.from) : `${day(range.from)} 至 ${day(range.to)}`;
  return range.period === 'week' ? `${span} ${PERIODS.week}` : span;
}

/** 表头上方的计数与图例 */
export const LIST_HEAD = {
  count: (total: number, denied: number) =>
    `共 ${total} 条 · 越权访问 ${denied} 条 · 点行展开完整前后值`,
  denied: '越权访问被拒',
  deniedNote: 'E-24，红色标出',
  finance: '财务字段：无财务权限的角色看到「已隐藏」',
} as const;

export const COLUMNS = {
  time: '时间',
  actor: '操作人',
  object: '对象',
  action: '动作',
  summary: '变更摘要',
  ip: '来源 IP',
} as const;

/** 系统操作的操作人与角色（原型「系统」，展开的说明行「系统 · 系统」） */
export const SYSTEM = { avatar: '系', name: '系统' } as const;
/** 没有值（系统操作没有来源 IP） */
export const NONE = '—';

/** 变更摘要后的「等 N 项」 */
export const MORE = (count: number) => ` 等 ${count} 项`;

/** 行展开：两栏对照完整前后值 */
export const EXPAND = {
  before: '变更前',
  after: '变更后',
  hidden: '已隐藏',
  /** 说明行（原型「09-11 10:14 · 系统 · 系统 · 来源 IP —」） */
  meta: (time: string, name: string, role: string, ip: string) =>
    `${time} · ${name} · ${role} · 来源 IP ${ip}`,
} as const;

/** 表下的分页（原型「共 5 条 · 每页 10 条」「上一页 1 / 1 下一页」，禁用时悬停写原因） */
export const PAGER = {
  summary: (total: number) => `共 ${total} 条 · 每页 ${AUDIT_PAGE_SIZE} 条`,
  prev: '上一页',
  next: '下一页',
  position: (page: number, pages: number) => `${page} / ${pages}`,
  first: '已是第一页',
  last: '已是最后一页',
} as const;

/** 列表为空（照 P13 与 I10 的写法：标题、当前筛选、清除筛选） */
export const EMPTY = {
  title: '没有符合条件的操作记录',
  description: (filters: readonly string[], clearable: boolean) =>
    `当前筛选：${filters.join(' · ')}。${clearable ? '换个条件试试，或清除筛选。' : ''}`,
} as const;

/** 读屏用的说明 */
export const A11Y = {
  expand: (label: string) => `展开 ${label} 的前后值`,
  collapse: (label: string) => `收起 ${label} 的前后值`,
  period: '时间',
  customRange: '自定义的起止',
} as const;
