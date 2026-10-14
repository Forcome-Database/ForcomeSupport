import { z } from 'zod';
import {
  aftersalesStatusSchema,
  ownerOptionSchema,
  ownersForStore,
  reassignMessages,
  registrationMessages,
  type OwnerOption,
} from './aftersales';
import { relativeTimeWords } from './audit-log';
import { memberStatusSchema, storeScopeSchema, type StoreScopeValue } from './auth';
import type { FieldErrors } from './channel';
import { roles, roleSchema, type Role } from './roles';

/*
 * P20 设置 · 团队与权限（PRD P20 与「第一阶段」小节、K6、K17、G7、G8，待办 06）：成员表、「从钉钉添加」、
 * 修改角色与店铺数据范围的接口模式，以及前后端共用的校验与写法。成员与部门来自钉钉通讯录（待办 05），
 * 本系统只维护角色与店铺数据范围（D-16）；改了下一次请求即生效（角色与范围每次请求从成员表读，ADR 0010）。
 */

/**
 * P20 能分配的角色：客服系统的五个角色（PRD 10.1 的顺序）。生产厂对接人不在这里分配——第一期不分配（P20「第一阶段」、
 * D-24 ⑧），第二期起生产厂成员在工厂账号（P24）维护
 */
export const teamRoles = roles.filter(
  (role): role is Exclude<Role, 'factory_contact'> => role !== 'factory_contact',
);
export type TeamRole = (typeof teamRoles)[number];

/**
 * 成员表列谁：至少有一个客服系统角色的成员（含已停用的）。没有角色的是钉钉通讯录同步进来、等管理员添加的人
 * （「从钉钉添加」的候选）；只有生产厂对接人角色的随第二期 P24 维护，P20 不列（原型 P20 的 6 人不含陈工、张工）
 */
export function isTeamMember(memberRoles: readonly Role[]): boolean {
  return memberRoles.some((role) => (teamRoles as readonly Role[]).includes(role));
}

/** 角色按 PRD 10.1 的顺序排好（成员表、审计与比较都用这个顺序，勾选先后不算区别） */
export function orderedRoles(memberRoles: readonly Role[]): Role[] {
  return roles.filter((role) => memberRoles.includes(role));
}

/** 两组角色是否相同（不看先后） */
export function sameRoles(a: readonly Role[], b: readonly Role[]): boolean {
  return orderedRoles(a).join(',') === orderedRoles(b).join(',');
}

/** 两个店铺范围是否相同：都是全部店铺，或指定的店铺相同（不看先后） */
export function sameStoreScope(a: StoreScopeValue, b: StoreScopeValue): boolean {
  if (a.all || b.all) return a.all === b.all;
  return [...a.storeIds].sort().join(',') === [...b.storeIds].sort().join(',');
}

/**
 * 校验与保存的报错（字段下方或成员表格子下方；文案照原型 K17 下方的 P20 补充小样，10-06 用户确认）。
 * factoryRole、unknownStore 只有直接调接口才会收到（界面不给这些选项），原型不画。「从钉钉添加」选的人刚被停用（钉钉离职）
 * 或已不在成员表里时，同没选一样报「请选择成员」（候选随之刷新，这个人从下拉里消失）
 */
export const teamMessages = {
  memberRequired: '请选择成员',
  rolesRequired: '请至少选择一个角色',
  factoryRole: '第一期不能分配生产厂对接人',
  scopeRequired: '请选择数据范围',
  storesRequired: '请至少选择一个店铺',
  unknownStore: '有店铺已不存在，请重新选择',
  /** 去掉了最后一位在职管理员的「管理员」角色：没人能再管理成员与店铺 */
  lastAdmin: '至少要有一位在职的管理员',
  /** 「从钉钉添加」选的人刚被别人添加过 */
  alreadyAdded: (name: string) => `${name}已经分配过角色`,
  disabledMember: '已停用的成员不能修改角色与数据范围',
} as const;

/** 角色与数据范围（添加成员时两项必填，修改时同样不能清空）：数据范围没选为 null */
export interface TeamAccessInput {
  readonly roles: readonly Role[];
  readonly stores: StoreScopeValue | null;
}

/**
 * 角色与数据范围的校验（PRD P20「校验」：角色与店铺数据范围必填）：键为 roles、stores。
 * knownStoreIds 是现有的全部店铺（指定店铺只能从中选）
 */
export function teamAccessErrors(
  input: TeamAccessInput,
  knownStoreIds: readonly string[],
): FieldErrors {
  const errors: FieldErrors = {};
  if (input.roles.length === 0) errors.roles = teamMessages.rolesRequired;
  else if (input.roles.includes('factory_contact')) errors.roles = teamMessages.factoryRole;
  if (input.stores === null) errors.stores = teamMessages.scopeRequired;
  else if (!input.stores.all) {
    if (input.stores.storeIds.length === 0) errors.stores = teamMessages.storesRequired;
    else if (input.stores.storeIds.some((id) => !knownStoreIds.includes(id))) {
      errors.stores = teamMessages.unknownStore;
    }
  }
  return errors;
}

// ---------------------------------------------------------------- 写法

/** 「全部店铺」（含以后新增的） */
export const ALL_STORES_WORDS = '全部店铺';
const NONE = '—';

/** 数据范围的写法（P20「数据范围」列、吸底保存栏与 P27 的店铺范围）：全部店铺，或店铺名用「、」连接；没有范围写「—」 */
export function storeScopeWords(
  scope: StoreScopeValue,
  storeNames: ReadonlyMap<string, string>,
): string {
  if (scope.all) return ALL_STORES_WORDS;
  if (scope.storeIds.length === 0) return NONE;
  return scope.storeIds.map((id) => storeNames.get(id) ?? id).join('、');
}

/** 最近登录（P20）：当天写时:分，之前写「月-日 时:分」，不在今年写全年份；没登录过写「—」 */
export function lastLoginWords(at: string | null, now: Date): string {
  return at === null ? NONE : relativeTimeWords(at, now);
}

/** 成员表头的同步时间（原型「10:00 同步」）：钉钉通讯录最近一次对账成功的时刻；从没成功过写「尚未同步」 */
export function syncedAtWords(at: string | null, now: Date): string {
  return at === null ? '尚未同步' : `${relativeTimeWords(at, now)} 同步`;
}

// ---------------------------------------------------------------- 接口

/** 成员表的一行（GET /api/org/team） */
export const teamMemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** 企业邮箱（成员列「姓名 + 邮箱」）；钉钉里没填的为空 */
  email: z.string().nullable(),
  /** 钉钉部门（例「FSH / 客服部」） */
  dept: z.string(),
  roles: z.array(roleSchema),
  stores: storeScopeSchema,
  status: memberStatusSchema,
  /** 最近一次登录（ISO）；没登录过为空 */
  lastLoginAt: z.string().nullable(),
  /** 乐观锁版本（G7）：改角色、店铺范围与在职状态时加 1 */
  version: z.int().nonnegative(),
  /** 最近一次改角色、店铺范围或在职状态的人（系统写「系统」）与时刻（ISO），G7 横幅写「刚被谁修改」；没改过为空 */
  changedBy: z.string().nullable(),
  changedAt: z.string().nullable(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

/** 授权时可选的店铺（全部店铺，不按管理员自己的数据范围过滤，ADR 0010 修订） */
export const teamStoreSchema = z.object({ id: z.uuid(), name: z.string() });
export type TeamStore = z.infer<typeof teamStoreSchema>;

/** P20「成员」页签（GET /api/org/team） */
export const teamSchema = z.object({
  /** 按角色（PRD 10.1 的顺序）、同角色按加入先后 */
  members: z.array(teamMemberSchema),
  /** 全部店铺（数据范围的店铺名与授权选择） */
  stores: z.array(teamStoreSchema),
  /** 钉钉通讯录最近一次对账成功的时刻（ISO，原型「10:00 同步」）；从没成功过为空 */
  syncedAt: z.string().nullable(),
  /** 服务端的当前时刻（ISO）：最近登录与同步时刻按它判断是不是当天 */
  now: z.string(),
});
export type Team = z.infer<typeof teamSchema>;

/** 「从钉钉添加」可选的人：钉钉通讯录里在职、还没分配角色的成员（GET /api/org/team/candidates） */
export const teamCandidateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  dept: z.string(),
  email: z.string().nullable(),
});
export type TeamCandidate = z.infer<typeof teamCandidateSchema>;
export const teamCandidatesSchema = z.object({ candidates: z.array(teamCandidateSchema) });
export type TeamCandidates = z.infer<typeof teamCandidatesSchema>;

/**
 * 从钉钉添加成员（POST /api/org/team/members）：选人并分配角色与数据范围。没选的项传 null / 空数组，
 * 由接口一次报全字段错误（键 memberId、roles、stores）
 */
export const teamMemberAddSchema = z.object({
  memberId: z.uuid().nullable(),
  roles: z.array(roleSchema),
  stores: storeScopeSchema.nullable(),
});
export type TeamMemberAdd = z.infer<typeof teamMemberAddSchema>;

/** 一位成员改后的角色与数据范围，带打开时读到的版本号（G7） */
export const teamChangeSchema = z.object({
  id: z.uuid(),
  version: z.int().nonnegative(),
  roles: z.array(roleSchema),
  stores: storeScopeSchema,
});
export type TeamChange = z.infer<typeof teamChangeSchema>;

/**
 * 吸底保存栏的「保存」（PUT /api/org/team，K6）：这次改过的成员一起保存，要么全部保存、要么都不保存。
 * 有人已被别人改过返回 409（G7）；字段错误的键为「成员 ID.roles」「成员 ID.stores」
 */
export const teamSaveSchema = z.object({
  changes: z
    .array(teamChangeSchema)
    .min(1)
    .refine((changes) => new Set(changes.map((c) => c.id)).size === changes.length, {
      message: '同一位成员只能出现一次',
    }),
});
export type TeamSave = z.infer<typeof teamSaveSchema>;

/** 保存修改时某位成员某一项的字段路径（接口的 fields 与表格格子的对应） */
export function teamFieldPath(memberId: string, field: 'roles' | 'stores'): string {
  return `${memberId}.${field}`;
}

// ---------------------------------------------------------------- 停用成员（K10 第一阶段，待办 23）

/**
 * 停用成员的报错与不可用的原因（PRD P20「第一阶段」与 K10 第一阶段补充小样，协调者 2026-10-14 决定 Q1–Q4）。
 * 行尾「更多」的「停用」不可用时悬停写 self / disabled / lastAdmin；弹窗里没人可接手时字段下写 onlyOwner / noOwner / scopeMissing，
 * 底部写 noOwnerFix / scopeFix
 */
export const disableMessages = {
  self: '不能停用自己',
  disabled: '这位成员已停用',
  lastAdmin: teamMessages.lastAdmin,
  ownerRequired: reassignMessages.ownerMissing,
  ownerNotEligible: registrationMessages.ownerNotEligible,
  onlyOwner: (name: string) => `${name}是唯一的售后负责人，没有其他人可接手`,
  noOwner: '没有在职的售后负责人可接手',
  noOwnerFix: '请先在成员表为其他成员分配售后负责人角色',
  scopeMissing: (stores: readonly string[]) =>
    `其他售后负责人都没有 ${stores.join('、')} 的数据范围`,
  scopeFix: '请先在成员表为其他售后负责人加上该店铺的数据范围',
} as const;

/** 停用弹窗里的一张进行中售后单 */
export const handoverCaseSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: aftersalesStatusSchema,
  store: z.object({ id: z.uuid(), name: z.string() }),
  /** 乐观锁版本：改派时带上（G7） */
  version: z.int(),
});
export type HandoverCase = z.infer<typeof handoverCaseSchema>;

/**
 * 停用弹窗的内容（GET /api/org/team/members/{id}/handover）：成员与版本、他负责的进行中售后单（按单号）、
 * 在职的售后负责人与店铺范围（不含他自己）。第一阶段只检查进行中售后单（工单没有负责人）
 */
export const teamHandoverSchema = z.object({
  member: z.object({
    id: z.uuid(),
    name: z.string(),
    version: z.int().nonnegative(),
    /** 他自己是不是售后负责人（没人可接手时的写法不同） */
    aftersalesOwner: z.boolean(),
  }),
  cases: z.array(handoverCaseSchema),
  owners: z.array(ownerOptionSchema),
});
export type TeamHandover = z.infer<typeof teamHandoverSchema>;

/** 一张单交给谁（没选为 null），带弹窗里读到的这张单的版本（G7：列出之后被别人改过就不停用） */
export const handoverAssignmentSchema = z.object({
  caseId: z.uuid(),
  version: z.int(),
  ownerId: z.uuid().nullable(),
});
export type HandoverAssignment = z.infer<typeof handoverAssignmentSchema>;

/**
 * 「改派并停用」（POST /api/org/team/members/{id}/disable）：打开弹窗时读到的成员版本（G7）与每张进行中售后单的接手人。
 * 改派与停用同一事务；字段错误的键是 handover（没人可接手、没选、选的人不能接）与 member（不能停用这个人）
 */
export const teamDisableSchema = z.object({
  version: z.int().nonnegative(),
  assignments: z.array(handoverAssignmentSchema),
});
export type TeamDisable = z.infer<typeof teamDisableSchema>;

/** 接手人的一组候选：全部单一个下拉（store 为 null），或按店铺各一个 */
export interface HandoverGroup {
  readonly store: { readonly id: string; readonly name: string } | null;
  /** 这一组的单 */
  readonly caseIds: readonly string[];
  readonly candidates: readonly OwnerOption[];
}

/** 停用弹窗怎么选接手人：没有进行中售后单 · 选接手人（一组或按店铺几组）· 没人可接手（原因与怎么办） */
export type HandoverPlan =
  | { readonly kind: 'none' }
  | { readonly kind: 'choose'; readonly groups: readonly HandoverGroup[] }
  | { readonly kind: 'blocked'; readonly reason: string; readonly fix: string };

/**
 * 停用弹窗的接手人（协调者 2026-10-14 决定 Q1、Q3）：平时一个「接手人」下拉，候选为店铺范围覆盖这些单全部店铺的在职售后负责人
 * （owners 已不含被停用的人）；没有一人覆盖全部店铺、但每个店铺各有人可接时按店铺各一个（按店铺名排序）；
 * 有店铺没人可接时不可用：一位售后负责人都没有写「X是唯一的售后负责人」或「没有在职的售后负责人」，否则写缺哪些店铺的范围
 */
export function handoverPlan(
  handover: Pick<TeamHandover, 'member' | 'cases' | 'owners'>,
): HandoverPlan {
  const { member, cases, owners } = handover;
  if (cases.length === 0) return { kind: 'none' };
  if (owners.length === 0) {
    return {
      kind: 'blocked',
      reason: member.aftersalesOwner
        ? disableMessages.onlyOwner(member.name)
        : disableMessages.noOwner,
      fix: disableMessages.noOwnerFix,
    };
  }
  const stores = new Map<string, { id: string; name: string }>();
  for (const item of cases) stores.set(item.store.id, item.store);
  const byStore = [...stores.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  const uncovered = byStore.filter((store) => ownersForStore(owners, store.id).length === 0);
  if (uncovered.length > 0) {
    return {
      kind: 'blocked',
      reason: disableMessages.scopeMissing(uncovered.map((store) => store.name)),
      fix: disableMessages.scopeFix,
    };
  }
  const covering = owners.filter((owner) =>
    byStore.every((store) => ownersForStore([owner], store.id).length > 0),
  );
  if (covering.length > 0) {
    return {
      kind: 'choose',
      groups: [{ store: null, caseIds: cases.map((item) => item.id), candidates: covering }],
    };
  }
  return {
    kind: 'choose',
    groups: byStore.map((store) => ({
      store,
      caseIds: cases.filter((item) => item.store.id === store.id).map((item) => item.id),
      candidates: ownersForStore(owners, store.id),
    })),
  };
}

/**
 * 弹窗里列的单与现在的不一样了（有单被改过、不再是他负责的进行中单，或又登记了新的给他）：后端据此整笔回滚、409（G7），
 * 弹窗刷新后再选（协调者 2026-10-14 决定 R2）
 */
export function handoverStale(
  cases: readonly Pick<HandoverCase, 'id' | 'version'>[],
  assignments: readonly Pick<HandoverAssignment, 'caseId' | 'version'>[],
): boolean {
  const seen = new Map(assignments.map((item) => [item.caseId, item.version]));
  return (
    cases.length !== assignments.length || cases.some((item) => seen.get(item.id) !== item.version)
  );
}

/** 在职管理员的人数（「最后一位在职管理员」不能停用；前端按成员表算） */
export function activeAdminCount(members: readonly Pick<TeamMember, 'status' | 'roles'>[]): number {
  return members.filter((m) => m.status === 'active' && m.roles.includes('admin')).length;
}

/**
 * 「改派并停用」的接手人校验（前后端同一个）：没人可接手时报原因；每张单都要有接手人，且是有该单店铺范围的在职售后负责人。
 * 返回报错（键 handover），没问题为 null
 */
export function handoverError(
  handover: Pick<TeamHandover, 'member' | 'cases' | 'owners'>,
  assignments: readonly HandoverAssignment[],
): string | null {
  const plan = handoverPlan(handover);
  if (plan.kind === 'none') return null;
  if (plan.kind === 'blocked') return plan.reason;
  const chosen = new Map(assignments.map((item) => [item.caseId, item.ownerId]));
  for (const item of handover.cases) {
    const ownerId = chosen.get(item.id);
    if (!ownerId) return disableMessages.ownerRequired;
    if (!ownersForStore(handover.owners, item.store.id).some((owner) => owner.id === ownerId)) {
      return disableMessages.ownerNotEligible;
    }
  }
  return null;
}

/**
 * 行尾「更多」的「停用」不可用的原因（K10 第一阶段补充小样 ⑤）：已停用的成员、当前登录的管理员自己、最后一位在职管理员；
 * 可以停用为 null。activeAdmins 是在职管理员的人数
 */
export function disableBlockedReason(
  target: Pick<TeamMember, 'id' | 'status' | 'roles'>,
  selfId: string,
  activeAdmins: number,
): string | null {
  if (target.status !== 'active') return disableMessages.disabled;
  if (target.id === selfId) return disableMessages.self;
  if (target.roles.includes('admin') && activeAdmins <= 1) return disableMessages.lastAdmin;
  return null;
}
