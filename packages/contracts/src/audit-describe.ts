import { businessDateTime } from '@forcome/calendar';
import {
  aftersalesOriginLabels,
  aftersalesStatusLabels,
  claimStatusLabels,
  claimTargetLabels,
  feeItemLabels,
  feeSchema,
  handlingMethodLabels,
  ratiosSchema,
  ratioWords,
  registrationFieldLabels,
  responsibilityLabels,
  shipperLabels,
} from './aftersales';
import {
  ACCESS_DENIED_ACTION,
  SYSTEM_ACTOR_NAME,
  auditActions,
  auditChannels,
  auditSnapshotSchemas,
  isAuditAction,
  loginMethodLabels,
  type AuditChannel,
  type AuditObjectType,
  type AuditSnapshotKind,
} from './audit';
import {
  auditConditionWords,
  auditPeriodLabels,
  auditPeriodSchema,
  auditTimeWords,
  dateRangeWords,
  SYSTEM_ACTOR,
  type AuditLogEntry,
  type AuditLogField,
} from './audit-log';
import { memberStatusLabels, storeScopeSchema } from './auth';
import { connectionStatusLabels, platformLabels } from './channel';
import { formatRate, formatRateDate } from './exchange-rate';
import { FINANCE_HIDDEN, maskFinanceFields } from './finance';
import { adapterModeLabels } from './integration';
import { formatMoney } from './money';
import { roleLabels, roles } from './roles';
import { storeScopeWords } from './team';
import { ticketChannelLabels } from './ticket';
import { recipientHeaderLabels } from './unassigned-mail';

/*
 * 一条审计记录怎么写成 P27 的一行（PRD P27「第一阶段」v2.20、10.2、K18 与补充小样）：操作人、对象、动作、变更摘要与
 * 两栏对照的前后值。后端按查看者的权限调用（接口与导出共用），财务字段对没有财务权限的角色写「已隐藏」（maskFinanceFields）。
 * 每种快照的字段表（列哪些字段、什么顺序、怎么写）与另有写法的摘要都在这里；新增一种审计动作时在 audit.ts 登记、在这里补字段表。
 */

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

/** 值的写法；store、stores 与两种筛选里含要查名字的 ID（auditNameIds 按它收集） */
type ValueKind =
  | 'text'
  | 'date'
  | 'datetime'
  | 'fee'
  | 'ratios'
  | 'store'
  | 'stores'
  | 'storeScope'
  | 'list'
  | 'part'
  | 'feeItems'
  | 'boolean'
  | 'ledgerFilters'
  | 'auditFilters'
  | 'backfill'
  | 'trigger'
  | 'sameDayTime';

interface FieldDefinition {
  /** 快照里的路径（点分） */
  readonly path: string;
  readonly label: string;
  readonly kind: ValueKind;
  /** 取值的叫法（枚举） */
  readonly labels?: Readonly<Record<string, string>>;
}

const field = (
  path: string,
  label: string,
  kind: ValueKind = 'text',
  labels?: Readonly<Record<string, string>>,
): FieldDefinition => ({ path, label, kind, labels });

const registration = registrationFieldLabels;

/**
 * 各种快照在展开里列哪些字段、按什么顺序：售后单先写状态与完成、取消，再按抽屉自上而下（S14），
 * 费用之后是承担比例（同台账的列序），最后是创建路径与登记人；店铺按抽屉的顺序（K8）。
 */
const snapshotFields: Record<AuditSnapshotKind, readonly FieldDefinition[]> = {
  store: [
    field('platform', '平台', 'text', platformLabels),
    field('name', '店铺名'),
    field('sites', '站点', 'list'),
    field('defaultSite', '默认站点'),
    field('mailboxes', '进线邮箱', 'list'),
    field('platformId', '平台标识'),
    field('adapterMode', '数据来源', 'text', adapterModeLabels),
  ],
  aftersales: [
    field('status', '状态', 'text', aftersalesStatusLabels),
    field('completedAt', '完成时间', 'datetime'),
    field('cancellation.reason', '取消原因'),
    field('cancellation.at', '取消时间', 'datetime'),
    field('cancellation.keptFees', '取消时保留的费用', 'feeItems'),
    field('method', registration.method, 'text', handlingMethodLabels),
    field('storeId', registration.storeId, 'store'),
    field('site', registration.site),
    field('orderNumber', registration.orderNumber),
    field('customerName', registration.customerName),
    field('sourceTicket', '来源工单'),
    field('feeDate', registration.feeDate, 'date'),
    field('ownerName', registration.ownerId),
    field('responsibility', registration.responsibility, 'text', responsibilityLabels),
    field('factory', registration.factory),
    field('claimTarget', registration.claimTarget, 'text', claimTargetLabels),
    field('claimStatus', registration.claimStatus, 'text', claimStatusLabels),
    field('responsibilityReason', registration.responsibilityReason),
    field('part', registration.part, 'part'),
    field('shipper', registration.shipper, 'text', shipperLabels),
    field('carrier', registration.carrier),
    field('shipDate', registration.shipDate, 'date'),
    field('trackingNumber', registration.trackingNumber),
    field('fees.productCost', feeItemLabels.productCost, 'fee'),
    field('fees.freight', feeItemLabels.freight, 'fee'),
    field('fees.compensation', feeItemLabels.compensation, 'fee'),
    field('fees.otherCost', feeItemLabels.otherCost, 'fee'),
    field('ratios', registration.ratios, 'ratios'),
    field('origin', '创建路径', 'text', aftersalesOriginLabels),
    field('registeredBy', '登记人'),
  ],
  ledgerExport: [
    field('fileName', '文件名'),
    field('filters', '筛选', 'ledgerFilters'),
    field('rows', '行数'),
    field('financeFields', '含财务字段', 'boolean'),
  ],
  auditExport: [
    field('fileName', '文件名'),
    field('filters', '筛选', 'auditFilters'),
    field('rows', '行数'),
  ],
  login: [field('method', '登录方式', 'text', loginMethodLabels)],
  member: [
    field('status', '状态', 'text', memberStatusLabels),
    field('roles', '角色', 'list', roleLabels),
    field('stores', '店铺范围', 'storeScope'),
    field('name', '姓名'),
    field('dept', '钉钉部门'),
  ],
  // 渠道连接（待办 09，原型 AUDIT_P27_EXPAND）：状态、最近同步成功、补拉、触发
  channel: [
    field('status', '状态', 'text', connectionStatusLabels),
    field('lastSuccessAt', '最近同步成功', 'sameDayTime'),
    field('backfilled', '补拉', 'backfill'),
    field('trigger', '触发', 'trigger'),
  ],
  // 来信的店铺（待办 15，协调者 2026-10-07 决定）：店铺在前（摘要「店铺：— → forcome.mx」），其后是按所归店铺重新识别的结果与识别依据
  messageStore: [
    field('storeId', '店铺', 'store'),
    field('site', '站点'),
    field('channel', '渠道', 'text', ticketChannelLabels),
    field('recipient', '收件地址'),
    field('recipientHeader', '识别依据', 'text', recipientHeaderLabels),
    field('subject', '主题'),
  ],
  accessDenied: [
    field('reason', '原因', 'text', { store_scope: '店铺不在授权范围内' }),
    field('storeIds', '店铺', 'stores'),
    field('method', '请求方法'),
    field('path', '请求地址'),
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

/** 店铺范围是「指定店铺」却一个都没有（通讯录同步进来、还没分配的成员）：同没有值 */
function isEmptyScope(value: unknown): boolean {
  const parsed = storeScopeSchema.safeParse(value);
  return parsed.success && !parsed.data.all && parsed.data.storeIds.length === 0;
}

/** 字段的值是不是空的（展开里两侧都空的字段不列） */
function isEmptyField(definition: FieldDefinition, value: unknown): boolean {
  return isEmptyValue(value) || (definition.kind === 'storeScope' && isEmptyScope(value));
}

/** 两个值是否相同（快照是 JSON，按序列化比较） */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : EMPTY;
}

interface FormatContext {
  readonly names: AuditNames;
  /** 这条记录的年份：同年的时刻省略年份 */
  readonly year: string;
  /** 这条记录的日期（北京时间）：sameDayTime 的值在同一天时只写时:分 */
  readonly day: string;
  /** 渠道连接记录是哪个渠道（快照的 channel；没写的是 Gmail）：「补拉」写来信还是订单 */
  readonly channel: AuditChannel;
}

/** 订单的补拉：N 笔订单，平台更新时间的起止 */
const ORDER_BACKFILL = {
  count: (n: number) => `${n} 笔订单`,
  range: (from: string, to: string) => `${from}–${to} 更新`,
};

/**
 * 补拉的单位与时间的说法：Gmail 为来信（到达时间），Shopify 与亚马逊为订单（平台更新时间；协调者 2026-10-06 决定，亚马逊为待办 12 Q5 套用）
 */
const BACKFILL_WORDS: Record<
  AuditChannel,
  { count: (n: number) => string; range: (from: string, to: string) => string }
> = {
  gmail: {
    count: (n: number) => `${n} 封来信`,
    range: (from: string, to: string) => `${from}–${to} 到达，SLA 按原到达时间`,
  },
  shopify: ORDER_BACKFILL,
  amazon: ORDER_BACKFILL,
};

/** 快照里写的渠道；待办 09 写下的记录没有它，是 Gmail */
function auditChannelOf(after: unknown): AuditChannel {
  if (!isPlainObject(after)) return 'gmail';
  const channel = auditChannels.find((c) => c === after.channel);
  return channel ?? 'gmail';
}

function dateTimeWords(value: unknown, ctx: FormatContext): string {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) return text(value);
  return auditTimeWords(value, { withDate: true, year: ctx.year });
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

const storeName = (id: unknown, ctx: FormatContext) =>
  typeof id === 'string' ? (ctx.names.stores.get(id) ?? id) : EMPTY;
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
  const time =
    period.success && period.data !== 'custom'
      ? `${auditPeriodLabels[period.data]}（${range}）`
      : range;
  const actorName =
    filter.actor === undefined
      ? undefined
      : filter.actor === SYSTEM_ACTOR
        ? SYSTEM_ACTOR_NAME
        : memberName(filter.actor, ctx);
  return [time, ...auditConditionWords({ ...filter, actorName })].join(' · ');
}

/**
 * 恢复连接时补拉了多少：Gmail 原型「3 封来信（10:05–10:13 到达，SLA 按原到达时间）」，Shopify「2 笔订单（10:05–10:13 更新）」
 */
function backfillWords(value: unknown, ctx: FormatContext): string {
  const parsed = auditSnapshotSchemas.channel.shape.backfilled.safeParse(value);
  if (!parsed.success || !parsed.data) return EMPTY;
  const { count, from, to } = parsed.data;
  const time = (at: string) => auditTimeWords(at, { withDate: false, year: ctx.year });
  const words = BACKFILL_WORDS[ctx.channel];
  return `${words.count(count)}（${words.range(time(from), time(to))}）`;
}

/** 触发（原型「连续 3 次失败」「第 4 次重试成功」） */
function triggerWords(value: unknown): string {
  const parsed = auditSnapshotSchemas.channel.shape.trigger.safeParse(value);
  if (!parsed.success || !parsed.data) return EMPTY;
  return parsed.data.kind === 'failures'
    ? `连续 ${parsed.data.count} 次失败`
    : `第 ${parsed.data.attempt} 次重试成功`;
}

/** 一个值的写法（值已按权限过滤；HIDDEN 由调用方处理） */
function valueWords(definition: FieldDefinition, value: unknown, ctx: FormatContext): string {
  if (isEmptyField(definition, value)) return EMPTY;
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
      return storeName(value, ctx);
    case 'stores':
      return Array.isArray(value) ? value.map((id) => storeName(id, ctx)).join('、') : EMPTY;
    case 'storeScope': {
      const parsed = storeScopeSchema.safeParse(value);
      return parsed.success ? storeScopeWords(parsed.data, ctx.names.stores) : EMPTY;
    }
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
    case 'backfill':
      return backfillWords(value, ctx);
    case 'sameDayTime': {
      if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) return text(value);
      const sameDay = businessDateTime(new Date(value)).startsWith(ctx.day);
      return auditTimeWords(value, { withDate: !sameDay, year: ctx.year });
    }
    case 'trigger':
      return triggerWords(value);
    default:
      return labelOf(value);
  }
}

/** 某种快照里某条路径的字段 */
function fieldAt(kind: AuditSnapshotKind, path: string): FieldDefinition {
  const definition = snapshotFields[kind].find((candidate) => candidate.path === path);
  if (!definition) throw new Error(`快照 ${kind} 没有字段 ${path}`);
  return definition;
}

/** 导出记录的摘要「筛选：…· N 行」（原型「筛选：9 月 · 全部店铺 · 12 行」） */
function exportSummary(kind: 'ledgerExport' | 'auditExport') {
  return (after: unknown, ctx: FormatContext) => {
    if (!isPlainObject(after)) return EMPTY;
    const rows = typeof after.rows === 'number' ? ` · ${after.rows} 行` : '';
    return `筛选：${valueWords(fieldAt(kind, 'filters'), after.filters, ctx)}${rows}`;
  };
}

/**
 * 渠道连接的摘要（原型 AUDIT_LOG）：「状态：已连接 → 连接异常（连续 3 次失败）」「状态：连接异常 → 已连接（补拉 3 封来信）」，
 * Shopify 写「补拉 N 笔订单」；恢复时一封也没补拉到照写「补拉 0 封来信」（展开里「补拉」两侧都空、不列）
 */
function channelSummary(before: unknown, after: unknown, ctx: FormatContext): string {
  const status = fieldAt('channel', 'status');
  const parsed = auditSnapshotSchemas.channel.safeParse(after);
  const head = `${status.label}：${valueWords(status, valueAt(before, 'status'), ctx)} → ${valueWords(status, valueAt(after, 'status'), ctx)}`;
  if (!parsed.success) return head;
  const { trigger, backfilled } = parsed.data;
  if (trigger?.kind === 'failures') return `${head}（${triggerWords(trigger)}）`;
  if (trigger?.kind === 'retry_succeeded')
    return `${head}（补拉 ${BACKFILL_WORDS[ctx.channel].count(backfilled?.count ?? 0)}）`;
  return head;
}

/** 另有写法的摘要（按快照）：登录、退出、导出、越权访问、渠道连接；其余写第一个变化的字段 */
const snapshotSummaries: Partial<
  Record<AuditSnapshotKind, (after: unknown, ctx: FormatContext, before: unknown) => string>
> = {
  login: () => '会话有效期 7 天（无操作）',
  empty: () => EMPTY,
  ledgerExport: exportSummary('ledgerExport'),
  auditExport: exportSummary('auditExport'),
  accessDenied: (after, ctx) =>
    isPlainObject(after) && Array.isArray(after.storeIds)
      ? `店铺 ${valueWords(fieldAt('accessDenied', 'storeIds'), after.storeIds, ctx)} 不在授权范围内（R-ST-06）`
      : EMPTY,
  channel: (after, ctx, before) => channelSummary(before, after, ctx),
};

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
    day: businessDateTime(record.occurredAt).slice(0, 10),
    channel: auditChannelOf(record.after),
  };
  const known = isAuditAction(record.action) ? auditActions[record.action] : null;
  // 没有编号的店铺对象（较早的越权记录）写店铺名
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
    if (isEmptyField(definition, rawB) && isEmptyField(definition, rawA)) continue;
    const shownB = valueAt(before, definition.path);
    const shownA = valueAt(after, definition.path);
    const hidden = shownB === HIDDEN || shownA === HIDDEN;
    const changed = !sameValue(rawB, rawA);
    const item: AuditLogField = {
      label: definition.label,
      before: hidden ? null : valueWords(definition, shownB, ctx),
      after: hidden ? null : valueWords(definition, shownA, ctx),
      finance: financePathsOf(kind).has(definition.path),
      hidden,
      changed: changed && !hidden,
    };
    fields.push(item);
    if (changed) {
      changes += 1;
      first ??= item;
    }
  }
  const special = snapshotSummaries[kind];
  if (special) return { ...base, summary: special(after, ctx, before), more: 0, fields };
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

/** 一个字段的值里要查名字的 ID（按字段表的值写法：店铺、店铺列表、两种筛选里的店铺与成员） */
function collectIds(
  definition: FieldDefinition,
  value: unknown,
  ids: { storeIds: Set<string>; memberIds: Set<string> },
): void {
  const add = (set: Set<string>, id: unknown) => {
    if (typeof id === 'string' && id !== SYSTEM_ACTOR) set.add(id);
  };
  switch (definition.kind) {
    case 'store':
      add(ids.storeIds, value);
      break;
    case 'stores':
      if (Array.isArray(value)) value.forEach((id) => add(ids.storeIds, id));
      break;
    case 'storeScope': {
      const parsed = storeScopeSchema.safeParse(value);
      if (parsed.success && !parsed.data.all)
        parsed.data.storeIds.forEach((id) => add(ids.storeIds, id));
      break;
    }
    case 'ledgerFilters':
      if (isPlainObject(value)) {
        add(ids.storeIds, value.store);
        add(ids.memberIds, value.owner);
      }
      break;
    case 'auditFilters':
      if (isPlainObject(value)) add(ids.memberIds, value.actor);
      break;
    default:
  }
}

/** 这些记录要查名字的店铺与成员 ID（按各快照的字段表收集，另加没有编号的店铺对象） */
export function auditNameIds(records: readonly AuditRecordInput[]): {
  storeIds: Set<string>;
  memberIds: Set<string>;
} {
  const ids = { storeIds: new Set<string>(), memberIds: new Set<string>() };
  for (const record of records) {
    if (record.objectType === 'store' && record.objectLabel === null) {
      ids.storeIds.add(record.objectId);
    }
    if (!isAuditAction(record.action)) continue;
    const definitions = snapshotFields[auditActions[record.action].snapshot];
    for (const snapshot of [record.before, record.after]) {
      for (const definition of definitions) {
        collectIds(definition, valueAt(snapshot, definition.path), ids);
      }
    }
  }
  return ids;
}
