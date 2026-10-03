import { z } from 'zod';
import { apiErrorSchema } from './api';
import { navSectionSchema } from './navigation';
import { roleSchema } from './roles';

/** 登录与会话（ADR 0010 及其修订）：会话在服务端，角色与店铺范围每次请求从成员表实时读取 */

/** 成员状态：在职；钉钉离职或管理员停用后为已停用（不做物理删除） */
export const memberStatuses = ['active', 'disabled'] as const;
export const memberStatusSchema = z.enum(memberStatuses);
export type MemberStatus = z.infer<typeof memberStatusSchema>;

/** 界面密度（G9、设计规范第 12 节）：舒适（默认）与紧凑两档，按成员保存在服务端 */
export const densities = ['comfortable', 'compact'] as const;
export const densitySchema = z.enum(densities);
export type Density = z.infer<typeof densitySchema>;
export const densityLabels: Record<Density, string> = { comfortable: '舒适', compact: '紧凑' };

/** 店铺数据范围（R-ST-06）：全部店铺（含以后新增的）或指定的几个店铺 */
export const storeScopeSchema = z.discriminatedUnion('all', [
  z.object({ all: z.literal(true) }),
  z.object({ all: z.literal(false), storeIds: z.array(z.uuid()) }),
]);
export type StoreScopeValue = z.infer<typeof storeScopeSchema>;

/** 当前登录的成员（GET /api/me）：身份、角色、店铺范围、密度偏好，以及按角色算出的导航与默认首页（PRD 4.1） */
export const currentMemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** 钉钉部门（例「FSH / 客服部」） */
  dept: z.string(),
  roles: z.array(roleSchema),
  stores: storeScopeSchema,
  density: densitySchema,
  /** 顶栏导航入口，按顶栏顺序（多角色取并集） */
  nav: z.array(navSectionSchema),
  /** 默认首页；「返回首页」也回到这里 */
  home: navSectionSchema,
});
export type CurrentMember = z.infer<typeof currentMemberSchema>;

/**
 * 后台请求的标记：轮询、实时推送触发的重新拉取等不是人的操作，带上这个请求头（值为 1），
 * 服务端照常校验会话但不续期——「7 天无操作过期」只按人的操作算（ADR 0010 修订）。
 */
export const BACKGROUND_REQUEST_HEADER = 'x-forcome-background';

/** 个人偏好（PUT /api/me/preferences） */
export const preferencesSchema = z.object({ density: densitySchema });
export type Preferences = z.infer<typeof preferencesSchema>;

/**
 * 登录被拒的原因（G12）：未分配角色、账号已停用；第一期另有「只有生产厂对接人角色」（工厂工作台第二期上线，AC-P1-21）。
 * 会话过期不是登录被拒，受保护接口返回 401 session_expired。
 */
export const loginDenialReasons = ['no_role', 'disabled', 'factory_phase1'] as const;
export const loginDenialReasonSchema = z.enum(loginDenialReasons);
export type LoginDenialReason = z.infer<typeof loginDenialReasonSchema>;

/** G12 被拒画面的标题与说明（原型文案）；说明里的管理员由后端按在职管理员填上 */
export const loginDenialTitles: Record<LoginDenialReason, string> = {
  no_role: '还没有分配角色',
  disabled: '账号已停用',
  factory_phase1: '暂时无法进入',
};

export function loginDenialMessage(
  reason: LoginDenialReason,
  adminNames: readonly string[],
): string {
  switch (reason) {
    case 'no_role':
      return `你的钉钉账号还没有在本系统分配角色，请${contactAdmins(adminNames)}。`;
    case 'disabled':
      return '你的账号已停用（钉钉离职或管理员停用）。';
    case 'factory_phase1':
      return '工厂工作台第二阶段上线，目前无法进入。';
  }
}

/** 登录被拒（403，error 为 login_denied）：reason 供界面选择 G12 的画面，message 可直接显示 */
export const loginDeniedSchema = apiErrorSchema.extend({
  error: z.literal('login_denied'),
  reason: loginDenialReasonSchema,
});
export type LoginDenied = z.infer<typeof loginDeniedSchema>;

/** 管理员的联系人（无权限 G2、登录被拒 G12 写「请联系管理员刘洋」） */
export const adminContactsSchema = z.object({
  admins: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type AdminContacts = z.infer<typeof adminContactsSchema>;

/** 开发登录可选的成员（只在非生产环境、开启开发登录时提供；含第一期登录被拒的生产厂对接人） */
export const devMemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  dept: z.string(),
  roles: z.array(roleSchema),
});
export type DevMember = z.infer<typeof devMemberSchema>;

export const devMembersResponseSchema = z.object({ members: z.array(devMemberSchema) });
export type DevMembersResponse = z.infer<typeof devMembersResponseSchema>;

export const devLoginRequestSchema = z.object({ memberId: z.uuid() });
export type DevLoginRequest = z.infer<typeof devLoginRequestSchema>;

/** 「联系管理员刘洋」（多位管理员用「、」连接；没有在职管理员时只写「联系管理员」），G2、G12 共用 */
export function contactAdmins(adminNames: readonly string[]): string {
  return `联系管理员${adminNames.join('、')}`;
}
