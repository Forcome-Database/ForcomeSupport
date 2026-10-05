import { addDays, businessDateTime } from '@forcome/calendar';
import { z } from 'zod';
import {
  aftersalesOriginLabels,
  aftersalesStatusLabels,
  claimStatusLabels,
  claimTargetLabels,
  feeItemLabels,
  handlingMethodLabels,
  ratiosSchema,
  ratioWords,
  registrationFieldLabels,
  responsibilityLabels,
  shipperLabels,
  feeSchema,
} from './aftersales';
import {
  ACCESS_DENIED_ACTION,
  auditActions,
  auditObjectTypeLabels,
  auditObjectTypeSchema,
  auditSnapshotSchemas,
  isAuditAction,
  loginMethodLabels,
  type AuditObjectType,
  type AuditSnapshotKind,
} from './audit';
import { platformLabels } from './channel';
import { formatRate, formatRateDate } from './exchange-rate';
import { FINANCE_HIDDEN, maskFinanceFields } from './finance';
import { formatMoney } from './money';
import { grantsFor } from './capabilities';
import { roleLabels, roles, type Role } from './roles';

/*
 * P27 审计日志（PRD P27、10.2、K18）：查询条件、接口输出与「一条审计记录怎么写」。
 * 后端按查看者的权限把审计记录写成这里的形状（操作人、对象、动作、变更摘要、两栏对照的前后值），
 * 页面与导出共用同一份写法；财务字段对没有财务权限的角色写「已隐藏」（maskFinanceFields，K18）。
 */

// ---------------------------------------------------------------- 查询条件

/** 时间筛选（P27：今天 · 近 7 天 · 自定义），默认今天 */
export const auditPeriods = ['today', 'week', 'custom'] as const;
export const auditPeriodSchema = z.enum(auditPeriods);
export type AuditPeriod = z.infer<typeof auditPeriodSchema>;
export const auditPeriodLabels: Record<AuditPeriod, string> = {
  today: '今天',
  week: '近 7 天',
  custom: '自定义',
};

/** 近 7 天含今天 */
const WEEK_DAYS = 7;
/** 每页条数（原型「共 5 条 · 每页 10 条」） */
export const AUDIT_PAGE_SIZE = 10;
/** 对象编号搜索的最长字数 */
export const AUDIT_SEARCH_MAX = 60;

/** 操作人筛选里的「系统」 */
export const SYSTEM_ACTOR = 'system';

/**
 * 筛选条件（地址栏与接口共用）：时间、操作人（成员 ID 或 system）、对象类型、动作（叫法，叫法相同的动作是同一项）、
 * 对象编号搜索；列表另带页码。只能看自己的角色，操作人由后端锁定为本人（10.2）。
 */
export const auditLogFilterSchema = z.object({
  period: auditPeriodSchema.optional(),
  /** 自定义的起止（北京时间的日期，含两端） */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  actor: z.union([z.literal(SYSTEM_ACTOR), z.uuid()]).optional(),
  type: auditObjectTypeSchema.optional(),
  action: z.string().max(40).optional(),
  q: z.string().max(AUDIT_SEARCH_MAX).optional(),
});
export type AuditLogFilter = z.infer<typeof auditLogFilterSchema>;
export const auditLogQuerySchema = auditLogFilterSchema.extend({
  page: z.coerce.number().int().min(1).optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

/** 这次按的时间：哪一种与起止日期（含两端） */
export const auditRangeSchema = z.object({
  period: auditPeriodSchema,
  from: z.iso.date(),
  to: z.iso.date(),
});
export type AuditRange = z.infer<typeof auditRangeSchema>;

/** 按筛选与今天（北京时间）算出这次的起止：近 7 天含今天；自定义没给的一端取今天，起止颠倒时对调 */
export function auditRange(
  filter: Pick<AuditLogFilter, 'period' | 'from' | 'to'>,
  today: string,
): AuditRange {
  const period = filter.period ?? 'today';
  if (period === 'today') return { period, from: today, to: today };
  if (period === 'week') return { period, from: addDays(today, -(WEEK_DAYS - 1)), to: today };
  const from = filter.from ?? today;
  const to = filter.to ?? today;
  return from <= to ? { period, from, to } : { period, from: to, to: from };
}

/** 动作筛选的选项（叫法，去重，按登记顺序）：选了对象类型时只列该类型的动作，越权访问被拒对任何对象都列 */
export function auditActionOptions(type?: AuditObjectType): string[] {
  const labels = Object.values(auditActions)
    .filter((action) => !type || action.objectType === null || action.objectType === type)
    .map((action) => action.label);
  return [...new Set(labels)];
}

/** 动作筛选的叫法对应的动作（叫法相同的动作是同一项）；认不出的叫法为空列表 */
export function auditActionsLabelled(label: string): string[] {
  return Object.entries(auditActions)
    .filter(([, action]) => action.label === label)
    .map(([key]) => key);
}

/**
 * 查看范围（PRD 10.1「查看审计日志」、10.2）：客服主管、管理员看全部（●）；坐席、售后负责人、知识库负责人只看自己的
 * 操作记录（○）；没有这项能力为 null。多角色取并集，有一个角色能看全部就看全部
 */
export function auditScope(memberRoles: readonly Role[]): 'all' | 'own' | null {
  const grants = grantsFor(memberRoles, 'audit.view');
  if (grants.some((grant) => grant.kind === 'full')) return 'all';
  return grants.length > 0 ? 'own' : null;
}

// ---------------------------------------------------------------- 输出

/** 展开里的一个字段：前后值（已隐藏时为 null）、是否财务字段、是否这次变化的 */
export const auditLogFieldSchema = z.object({
  label: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  finance: z.boolean(),
  hidden: z.boolean(),
  changed: z.boolean(),
});
export type AuditLogField = z.infer<typeof auditLogFieldSchema>;

/** P27 的一行 */
export const auditLogEntrySchema = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  actor: z.object({
    /** 系统操作（定时任务、同步、自动推进） */
    system: z.boolean(),
    id: z.string().nullable(),
    name: z.string(),
    /** 操作时的角色快照（认不出的旧值原样保留） */
    roles: z.array(z.string()),
    /** 角色的写法（多角色「、」相连；系统为空） */
    roleText: z.string(),
  }),
  ip: z.string().nullable(),
  objectType: auditObjectTypeSchema,
  objectId: z.string(),
  /** 对象的编号或名称（P27「对象」列） */
  objectLabel: z.string(),
  action: z.string(),
  actionLabel: z.string(),
  /** 越权访问被拒（E-24，红色标出） */
  denied: z.boolean(),
  /** 变更摘要（「字段：前 → 后」，或该动作的说明）；没有为「—」 */
  summary: z.string(),
  /** 「等 N 项」的 N：这次变化的字段数，只有一项时为 0 */
  more: z.int(),
  fields: z.array(auditLogFieldSchema),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/**
 * P27 列表：今天、这次按的时间、查看范围（全部 / 只看自己，10.2）、能否看财务字段、总条数与其中越权访问的条数、当前页
 */
export const auditLogSchema = z.object({
  /** 今天（服务端时钟的北京时间日期；时间列与表头按它决定写不写年份） */
  today: z.iso.date(),
  range: auditRangeSchema,
  scope: z.enum(['all', 'own']),
  financeVisible: z.boolean(),
  total: z.int(),
  denied: z.int(),
  page: z.int(),
  pageSize: z.int(),
  entries: z.array(auditLogEntrySchema),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

/** 操作人筛选的选项：查看者能看到的记录里出现过的操作人（系统为 system） */
export const auditLogOptionsSchema = z.object({
  actors: z.array(z.object({ value: z.string(), label: z.string() })),
});
export type AuditLogOptions = z.infer<typeof auditLogOptionsSchema>;

// ---------------------------------------------------------------- 一条记录怎么写

/** 一条审计记录（core.audit_log 的一行） */
export interface AuditRecordInput {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorType: 'member' | 'system';
  readonly actorId: string | null;
  readonly actorName: string;
  readonly actorRoles: readonly string[];
  readonly ip: string | null;
  readonly action: string;
  readonly objectType: AuditObjectType;
  readonly objectId: string;
  readonly objectLabel: string | null;
  readonly storeId: string | null;
  readonly before: unknown;
  readonly after: unknown;
}

/** 写成名字要查的：店铺名、成员姓名（按 ID；查不到写原值） */
export interface AuditNames {
  readonly stores: ReadonlyMap<string, string>;
  readonly members: ReadonlyMap<string, string>;
}

const EMPTY = '—';
const HIDDEN = Symbol('hidden');

type ValueKind =
  | 'text'
  | 'date'
  | 'datetime'
  | 'fee'
  | 'ratios'
  | 'store'
  | 'stores'
  | 'list'
  | 'part'
  | 'feeItems'
  | 'boolean'
  | 'ledgerFilters'
  | 'auditFilters';

interface FieldDefinition {
  /** 快照里的路径（点分） */
  readonly path: string;
  readonly label: string;
  readonly kind?: ValueKind;
  /** 取值的叫法（枚举） */
  readonly labels?: Readonly<Record<string, string>>;
}

const f = (
  path: string,
  label: string,
  kind?: ValueKind,
  labels?: Readonly<Record<string, string>>,
): FieldDefinition => ({ path, label, kind, labels });

const L = registrationFieldLabels;

/**
 * 各种快照在展开里列哪些字段、按什么顺序：售后单先写状态与完成、取消，再按抽屉自上而下（S14），
 * 费用之后是承担比例（同台账的列序），最后是创建路径与登记人。
 */
const snapshotFields: Record<AuditSnapshotKind, readonly FieldDefinition[]> = {
  store: [
    f('platform', '平台', 'text', platformLabels),
    f('name', '店铺名'),
    f('sites', '站点', 'list'),
    f('defaultSite', '默认站点'),
    f('mailboxes', '进线邮箱', 'list'),
    f('platformId', '平台标识'),
    f('adapterMode', '数据来源', 'text', { real: '真实接口', fake: '模拟数据' }),
  ],
  aftersales: [
    f('status', '状态', 'text', aftersalesStatusLabels),
    f('completedAt', '完成时间', 'datetime'),
    f('cancellation.reason', '取消原因'),
    f('cancellation.at', '取消时间', 'datetime'),
    f('cancellation.keptFees', '取消时保留的费用', 'feeItems'),
    f('method', L.method, 'text', handlingMethodLabels),
    f('storeId', L.storeId, 'store'),
    f('site', L.site),
    f('orderNumber', L.orderNumber),
    f('customerName', L.customerName),
    f('sourceTicket', '来源工单'),
    f('feeDate', L.feeDate, 'date'),
    f('ownerName', L.ownerId),
    f('responsibility', L.responsibility, 'text', responsibilityLabels),
    f('factory', L.factory),
    f('claimTarget', L.claimTarget, 'text', claimTargetLabels),
    f('claimStatus', L.claimStatus, 'text', claimStatusLabels),
    f('responsibilityReason', L.responsibilityReason),
    f('part', L.part, 'part'),
    f('shipper', L.shipper, 'text', shipperLabels),
    f('carrier', L.carrier),
    f('shipDate', L.shipDate, 'date'),
    f('trackingNumber', L.trackingNumber),
    f('fees.productCost', feeItemLabels.productCost, 'fee'),
    f('fees.freight', feeItemLabels.freight, 'fee'),
    f('fees.compensation', feeItemLabels.compensation, 'fee'),
    f('fees.otherCost', feeItemLabels.otherCost, 'fee'),
    f('ratios', L.ratios, 'ratios'),
    f('origin', '创建路径', 'text', aftersalesOriginLabels),
    f('registeredBy', '登记人'),
  ],
  ledgerExport: [
    f('fileName', '文件名'),
    f('filters', '筛选', 'ledgerFilters'),
    f('rows', '行数'),
    f('financeFields', '含财务字段', 'boolean'),
  ],
  auditExport: [f('fileName', '文件名'), f('filters', '筛选', 'auditFilters'), f('rows', '行数')],
  login: [f('method', '登录方式', 'text', loginMethodLabels)],
  accessDenied: [
    f('reason', '原因', 'text', { store_scope: '店铺不在授权范围内' }),
    f('storeIds', '店铺', 'stores'),
    f('method', '请求方法'),
    f('path', '请求地址'),
  ],
  empty: [],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHiddenMarker(value: unknown): boolean {
  return isPlainObject(value) && value.hidden === FINANCE_HIDDEN.hidden;
}

/** 按路径取值；路径上遇到「已隐藏」标记时为 HIDDEN */
function valueAt(snapshot: unknown, path: string): unknown {
  let current: unknown = snapshot;
  for (const key of path.split('.')) {
    if (isHiddenMarker(current)) return HIDDEN;
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return isHiddenMarker(current) ? HIDDEN : current;
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** 两个值是否相同（快照是 JSON，按序列化比较） */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : EMPTY;
}

/** 同一天写日期，整月写「9 月」，其余写「起 至 止」（同年省略止的年份，同 P13 的区间写法） */
export function dateRangeWords(from: string, to: string): string {
  if (from === to) return from;
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  // 从 1 号到当月最后一天（次日是下个月 1 号）
  if (sameMonth && from.endsWith('-01') && addDays(to, 1).endsWith('-01')) {
    return `${Number(from.slice(5, 7))} 月`;
  }
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${from} 至 ${sameYear ? to.slice(5) : to}`;
}

interface FormatContext {
  readonly names: AuditNames;
  /** 这条记录的年份：同年的时刻省略年份 */
  readonly year: string;
}

function dateTimeWords(value: unknown, ctx: FormatContext): string {
  if (typeof value !== 'string') return EMPTY;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return text(value);
  const full = businessDateTime(instant).slice(0, 16);
  return full.startsWith(ctx.year) ? full.slice(5) : full;
}

function feeWords(value: unknown): string {
  const parsed = feeSchema.safeParse(value);
  if (!parsed.success) return EMPTY;
  const fee = parsed.data;
  const usd = formatMoney(fee.usd, 'USD');
  if (fee.currency === 'USD' || !fee.rate) return usd;
  const source = fee.rate.source === 'manual' ? '手工修改' : formatRateDate(fee.rate.date);
  return `${usd}（${formatMoney(fee.amount, fee.currency)} · 汇率 ${formatRate(fee.rate.rate)} · ${source}）`;
}

const storeName = (id: string, ctx: FormatContext) => ctx.names.stores.get(id) ?? id;
const memberName = (id: string, ctx: FormatContext) => ctx.names.members.get(id) ?? id;

function ledgerFilterWords(value: unknown, ctx: FormatContext): string {
  const parsed = auditSnapshotSchemas.ledgerExport.shape.filters.safeParse(value);
  if (!parsed.success) return EMPTY;
  const filter = parsed.data;
  const parts: string[] = [];
  if (filter.missing) parts.push('缺字段的已完成单');
  else if (filter.from && filter.to) parts.push(dateRangeWords(filter.from, filter.to));
  parts.push(filter.store ? storeName(filter.store, ctx) : '全部店铺');
  if (filter.method) parts.push(handlingMethodLabels[filter.method]);
  if (filter.responsibility) parts.push(responsibilityLabels[filter.responsibility]);
  if (filter.status) parts.push(aftersalesStatusLabels[filter.status]);
  if (filter.owner) parts.push(`负责人 ${memberName(filter.owner, ctx)}`);
  return parts.join(' · ');
}

function auditFilterWords(value: unknown, ctx: FormatContext): string {
  const parsed = auditSnapshotSchemas.auditExport.shape.filters.safeParse(value);
  if (!parsed.success) return EMPTY;
  const filter = parsed.data;
  const range = dateRangeWords(filter.from, filter.to);
  const period = auditPeriodSchema.safeParse(filter.period);
  const parts = [
    period.success && period.data !== 'custom'
      ? `${auditPeriodLabels[period.data]}（${range}）`
      : range,
  ];
  if (filter.actor) {
    parts.push(`操作人 ${filter.actor === SYSTEM_ACTOR ? '系统' : memberName(filter.actor, ctx)}`);
  }
  if (filter.type) parts.push(auditObjectTypeLabels[filter.type]);
  if (filter.action) parts.push(filter.action);
  if (filter.q) parts.push(`对象编号含「${filter.q}」`);
  return parts.join(' · ');
}

/** 一个值的写法（值已按权限过滤；HIDDEN 由调用方处理） */
function valueWords(definition: FieldDefinition, value: unknown, ctx: FormatContext): string {
  if (isEmptyValue(value)) return EMPTY;
  const labelOf = (item: unknown) =>
    definition.labels && typeof item === 'string' ? (definition.labels[item] ?? item) : text(item);
  switch (definition.kind) {
    case 'date':
      return text(value);
    case 'datetime':
      return dateTimeWords(value, ctx);
    case 'fee':
      return feeWords(value);
    case 'ratios': {
      const parsed = ratiosSchema.safeParse(value);
      return parsed.success ? ratioWords(parsed.data) : EMPTY;
    }
    case 'store':
      return typeof value === 'string' ? storeName(value, ctx) : EMPTY;
    case 'stores':
      return Array.isArray(value)
        ? value.map((id) => (typeof id === 'string' ? storeName(id, ctx) : EMPTY)).join('、')
        : EMPTY;
    case 'list':
      return Array.isArray(value) ? value.map(labelOf).join('、') : EMPTY;
    case 'part': {
      if (!isPlainObject(value) || typeof value.sku !== 'string') return EMPTY;
      return typeof value.quantity === 'number' ? `${value.sku} × ${value.quantity}` : value.sku;
    }
    case 'feeItems':
      return Array.isArray(value)
        ? value
            .map((item) =>
              typeof item === 'string' && item in feeItemLabels
                ? feeItemLabels[item as keyof typeof feeItemLabels]
                : text(item),
            )
            .join('、')
        : EMPTY;
    case 'boolean':
      return value === true ? '是' : value === false ? '否' : EMPTY;
    case 'ledgerFilters':
      return ledgerFilterWords(value, ctx);
    case 'auditFilters':
      return auditFilterWords(value, ctx);
    default:
      return labelOf(value);
  }
}

/** 来源 IP 的写法：IPv4 映射的 IPv6 地址（::ffff:10.20.1.12，经本机代理直连时会这样记）写成 IPv4 */
function ipWords(ip: string | null): string | null {
  return ip?.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '') ?? null;
}

/** 角色的写法：认得出的按固定顺序写中文名，认不出的旧值（中文名快照）原样写在后面 */
function roleWords(actorRoles: readonly string[]): string {
  const known = roles.filter((role) => actorRoles.includes(role)).map((role) => roleLabels[role]);
  const unknown = actorRoles.filter((role) => !(roles as readonly string[]).includes(role));
  return [...known, ...unknown].join('、');
}

/**
 * 按动作的快照结构把财务字段换成「已隐藏」（没有财务权限时）；不是对象时为 null。
 * 写出来的只有字段表里列的路径，结构里没声明的键不会出现在输出里
 */
function maskedSnapshot(kind: AuditSnapshotKind, value: unknown, financeVisible: boolean): unknown {
  if (!isPlainObject(value)) return null;
  return maskFinanceFields(auditSnapshotSchemas[kind], value, financeVisible);
}

/** 有自己写法的摘要：登录、退出、导出、越权；其余写第一个变化的字段 */
function specialSummary(action: string, after: unknown, ctx: FormatContext): string | null {
  switch (action) {
    case 'auth.login':
      return '会话有效期 7 天（无操作）';
    case 'auth.logout':
      return EMPTY;
    case 'ledger.export':
    case 'audit.export': {
      if (!isPlainObject(after)) return EMPTY;
      const definition =
        snapshotFields[action === 'ledger.export' ? 'ledgerExport' : 'auditExport'][1];
      const rows = typeof after.rows === 'number' ? ` · ${after.rows} 行` : '';
      return definition ? `筛选：${valueWords(definition, after.filters, ctx)}${rows}` : EMPTY;
    }
    case ACCESS_DENIED_ACTION: {
      if (!isPlainObject(after) || !Array.isArray(after.storeIds)) return EMPTY;
      const stores = after.storeIds
        .map((id) => (typeof id === 'string' ? storeName(id, ctx) : EMPTY))
        .join('、');
      return `店铺 ${stores} 不在授权范围内（R-ST-06）`;
    }
    default:
      return null;
  }
}

/**
 * 把一条审计记录写成 P27 的一行（PRD P27、10.2、K18）：
 * - 展开里列出快照里前后任一侧有值的全部字段（按固定顺序），这次变化的标出；
 * - 变更摘要写第一个变化的字段「字段：前 → 后」（新建时前值为「—」），变化的字段多于一项时另给「等 N 项」的 N；
 *   登录、退出、导出、越权访问另有写法；
 * - 没有财务权限时，成本、承担比例等财务字段的前后值为「已隐藏」（null），摘要也只写字段名；
 * - 没登记的动作或对不上结构的前后值不放行任何值（叫法写原样，摘要「—」，没有字段）。
 */
export function describeAuditRecord(
  record: AuditRecordInput,
  options: { readonly financeVisible: boolean; readonly names: AuditNames },
): AuditLogEntry {
  const ctx: FormatContext = {
    names: options.names,
    year: businessDateTime(record.occurredAt).slice(0, 4),
  };
  const known = isAuditAction(record.action) ? auditActions[record.action] : null;
  const objectLabel =
    record.objectLabel ??
    (record.objectType === 'store' ? options.names.stores.get(record.objectId) : undefined) ??
    record.objectId;
  const base = {
    id: record.id,
    at: record.occurredAt.toISOString(),
    actor: {
      system: record.actorType === 'system',
      id: record.actorId,
      name: record.actorName,
      roles: [...record.actorRoles],
      roleText: record.actorType === 'system' ? '' : roleWords(record.actorRoles),
    },
    ip: ipWords(record.ip),
    objectType: record.objectType,
    objectId: record.objectId,
    objectLabel,
    action: record.action,
    actionLabel: known?.label ?? record.action,
    denied: record.action === ACCESS_DENIED_ACTION,
  };
  if (!known) return { ...base, summary: EMPTY, more: 0, fields: [] };

  const kind = known.snapshot;
  const rawBefore = isPlainObject(record.before) ? record.before : null;
  const rawAfter = isPlainObject(record.after) ? record.after : null;
  const before = maskedSnapshot(kind, rawBefore, options.financeVisible);
  const after = maskedSnapshot(kind, rawAfter, options.financeVisible);

  const fields: AuditLogField[] = [];
  let first: AuditLogField | null = null;
  let changes = 0;
  for (const definition of snapshotFields[kind]) {
    const rawB = valueAt(rawBefore, definition.path);
    const rawA = valueAt(rawAfter, definition.path);
    if (isEmptyValue(rawB) && isEmptyValue(rawA)) continue;
    const shownB = valueAt(before, definition.path);
    const shownA = valueAt(after, definition.path);
    const hidden = shownB === HIDDEN || shownA === HIDDEN;
    const changed = !sameValue(rawB, rawA);
    const field: AuditLogField = {
      label: definition.label,
      before: hidden ? null : valueWords(definition, shownB, ctx),
      after: hidden ? null : valueWords(definition, shownA, ctx),
      finance: financePathsOf(kind).has(definition.path),
      hidden,
      changed: changed && !hidden,
    };
    fields.push(field);
    if (changed) {
      changes += 1;
      first ??= field;
    }
  }
  const special = specialSummary(record.action, after, ctx);
  if (special !== null) return { ...base, summary: special, more: 0, fields };
  const summary = !first
    ? EMPTY
    : first.hidden
      ? `${first.label}：已隐藏`
      : `${first.label}：${first.before} → ${first.after}`;
  return { ...base, summary, more: changes > 1 ? changes : 0, fields };
}

/** 字段是不是财务字段：按快照结构里的标记判断（有权限的人看到的财务字段也标出，界面在字段名旁画钱的图标） */
function isFinancePath(kind: AuditSnapshotKind, path: string): boolean {
  const masked = maskFinanceFields(auditSnapshotSchemas[kind], probeOf(path), false);
  return valueAt(masked, path) === HIDDEN;
}

/** 按路径造一个只有这一个值的对象（判断该路径是不是财务字段用） */
function probeOf(path: string): Record<string, unknown> {
  const keys = path.split('.');
  const root: Record<string, unknown> = {};
  let current = root;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      current[key] = 'probe';
    } else {
      const next: Record<string, unknown> = {};
      current[key] = next;
      current = next;
    }
  });
  return root;
}

/** 各种快照里哪些字段是财务字段（字段表的路径；第一次用到时按快照结构算好） */
const financePathCache = new Map<AuditSnapshotKind, ReadonlySet<string>>();
function financePathsOf(kind: AuditSnapshotKind): ReadonlySet<string> {
  let paths = financePathCache.get(kind);
  if (!paths) {
    paths = new Set(
      snapshotFields[kind]
        .filter((definition) => isFinancePath(kind, definition.path))
        .map((definition) => definition.path),
    );
    financePathCache.set(kind, paths);
  }
  return paths;
}

/** 这些记录要查名字的店铺与成员 ID（快照、筛选条件里的，以及没有编号的店铺对象） */
export function auditNameIds(records: readonly AuditRecordInput[]): {
  storeIds: Set<string>;
  memberIds: Set<string>;
} {
  const storeIds = new Set<string>();
  const memberIds = new Set<string>();
  const add = (set: Set<string>, value: unknown) => {
    if (typeof value === 'string' && value !== SYSTEM_ACTOR) set.add(value);
  };
  for (const record of records) {
    if (record.objectType === 'store' && record.objectLabel === null) {
      storeIds.add(record.objectId);
    }
    for (const snapshot of [record.before, record.after]) {
      if (!isPlainObject(snapshot)) continue;
      switch (record.action) {
        case 'ledger.export':
          if (isPlainObject(snapshot.filters)) {
            add(storeIds, snapshot.filters.store);
            add(memberIds, snapshot.filters.owner);
          }
          break;
        case 'audit.export':
          if (isPlainObject(snapshot.filters)) add(memberIds, snapshot.filters.actor);
          break;
        case ACCESS_DENIED_ACTION:
          if (Array.isArray(snapshot.storeIds)) {
            snapshot.storeIds.forEach((id) => add(storeIds, id));
          }
          break;
        default:
          if (
            isAuditAction(record.action) &&
            auditActions[record.action].snapshot === 'aftersales'
          ) {
            add(storeIds, snapshot.storeId);
          }
      }
    }
  }
  return { storeIds, memberIds };
}
