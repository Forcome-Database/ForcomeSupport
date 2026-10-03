import { z } from 'zod';
import { apiErrorSchema } from './api';
import { navSectionSchema } from './navigation';
import { roleSchema } from './roles';

/** 登录与会话（ADR 0010 及其修订）：会话在服务端，角色与店铺范围每次请求从成员表实时读取 */

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
