import { addDays, businessDateTime } from '@forcome/calendar';
import { z } from 'zod';
import {
  auditActionFilterLabel,
  auditActionFilterSchema,
  auditObjectTypeLabels,
  auditObjectTypeSchema,
  type AuditObjectType,
} from './audit';
import { grantsFor } from './capabilities';
import type { Role } from './roles';

/*
 * P27 审计日志（PRD P27、10.2、K18）：查询条件、查看范围、接口输出，以及页面、导出与后端写法共用的几种写法
 * （日期区间、时刻、筛选条件）。一条审计记录怎么写成 P27 的一行在 audit-describe.ts。
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
 * 筛选条件（地址栏与接口共用）：时间、操作人（成员 ID 或 system）、对象类型、动作（auditActionFilterKeys 的键，
 * 叫法相同的动作是同一项）、对象编号搜索；列表另带页码。只能看自己的角色，操作人由后端锁定为本人（10.2）。
 */
export const auditLogFilterSchema = z.object({
  period: auditPeriodSchema.optional(),
  /** 自定义的起止（北京时间的日期，含两端） */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  actor: z.union([z.literal(SYSTEM_ACTOR), z.uuid()]).optional(),
  type: auditObjectTypeSchema.optional(),
  action: auditActionFilterSchema.optional(),
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

/** 操作人筛选的选项：看全部时为「系统」与全部成员，只看自己时只有本人（系统为 system） */
export const auditLogOptionsSchema = z.object({
  actors: z.array(z.object({ value: z.string(), label: z.string() })),
});
export type AuditLogOptions = z.infer<typeof auditLogOptionsSchema>;

// ---------------------------------------------------------------- 共用的写法

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

/**
 * 一个时刻（北京时间）的写法：只写「时:分」，或写「月-日 时:分」（不在 year 这一年的写全年份「年-月-日 时:分」）。
 * P27 时间列「今天」只写时分、「近 7 天」「自定义」带日期；展开的说明行与前后值里的时刻总带日期
 */
export function auditTimeWords(
  at: Date | string,
  options: { readonly withDate: boolean; readonly year: string },
): string {
  const full = businessDateTime(typeof at === 'string' ? new Date(at) : at).slice(0, 16);
  if (!options.withDate) return full.slice(11);
  return full.startsWith(options.year) ? full.slice(5) : full;
}

/** 筛选条件里时间以外的各项（P27 列表为空的「当前筛选」与导出记录的摘要共用）：操作人、对象类型、动作、对象编号 */
export function auditConditionWords(condition: {
  readonly actorName?: string;
  readonly type?: AuditObjectType;
  readonly action?: string;
  readonly q?: string;
}): string[] {
  const parts: string[] = [];
  if (condition.actorName) parts.push(`操作人 ${condition.actorName}`);
  if (condition.type) parts.push(auditObjectTypeLabels[condition.type]);
  if (condition.action) parts.push(auditActionFilterLabel(condition.action));
  if (condition.q) parts.push(`对象编号含「${condition.q}」`);
  return parts;
}
