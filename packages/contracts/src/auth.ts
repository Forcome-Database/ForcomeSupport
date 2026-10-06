import { z } from 'zod';
import { apiErrorSchema } from './api';
import { adapterModeSchema } from './integration';
import { navSectionSchema } from './navigation';
import { roleSchema } from './roles';

/** 登录与会话（ADR 0010 及其修订）：会话在服务端，角色与店铺范围每次请求从成员表实时读取 */

/** 成员状态：在职；钉钉离职或管理员停用后为已停用（不做物理删除） */
export const memberStatuses = ['active', 'disabled'] as const;
export const memberStatusSchema = z.enum(memberStatuses);
export type MemberStatus = z.infer<typeof memberStatusSchema>;
/** 成员状态的叫法（P20 成员表「状态」列、P27 成员记录） */
export const memberStatusLabels: Record<MemberStatus, string> = {
  active: '已启用',
  disabled: '已停用',
};

/**
 * 停用的原因：钉钉离职（通讯录同步自动停用，待办 05）、管理员停用（P20，待办 23）。
 * 只有钉钉离职停用的，在通讯录里重新出现时才会自动恢复在职；管理员停用的不随通讯录变化。
 */
export const memberDisabledReasons = ['dingtalk_left', 'manual'] as const;
export const memberDisabledReasonSchema = z.enum(memberDisabledReasons);
export type MemberDisabledReason = z.infer<typeof memberDisabledReasonSchema>;

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
  /** 被拒的是谁（第一期的生产厂对接人在卡片上方写「陈工 · FQD / 品质部 · 生产厂对接人」）；扫码登录时给出 */
  member: z.object({ name: z.string(), dept: z.string(), roles: z.array(roleSchema) }).optional(),
});
export type LoginDenied = z.infer<typeof loginDeniedSchema>;

// ---------------------------------------------------------------- 钉钉扫码登录（G11，待办 05）

/** 登录页二维码的有效期（G11：2 分钟过期，过期后二维码上加蒙层与「刷新」） */
export const LOGIN_QR_EXPIRES_SECONDS = 120;

/**
 * 开始一次扫码登录（POST /api/auth/dingtalk/start）：服务端把这次的 state 记在 Cookie 里，返回画二维码要用的参数。
 * 「刷新」二维码就是再开始一次。
 */
export const dingtalkLoginStartSchema = z.object({
  /** 钉钉用真实接口还是 Fake（Fake 画示意二维码，扫码由开发工具模拟） */
  mode: adapterModeSchema,
  /** 真实接口的 Client ID（钉钉二维码的 client_id）；Fake 为 null */
  clientId: z.string().nullable(),
  /** 扫码确认后钉钉把浏览器带回的地址（钉钉开放平台「重定向 URL」填的就是它） */
  redirectUri: z.string(),
  /** 这次登录的随机串：钉钉原样带回，与 Cookie 里的核对（防跨站伪造登录） */
  state: z.string(),
});
export type DingtalkLoginStart = z.infer<typeof dingtalkLoginStartSchema>;

/** 扫码确认后，用浏览器带回的授权码与 state 换会话（POST /api/auth/dingtalk/login） */
export const dingtalkLoginRequestSchema = z.object({
  authCode: z.string().min(1),
  state: z.string().min(1),
});
export type DingtalkLoginRequest = z.infer<typeof dingtalkLoginRequestSchema>;

/**
 * 扫码登录失败（不是被拒）：授权码已失效或用过、这次登录的 state 对不上（登录页开得太久或换了浏览器）、连不上钉钉。
 * 界面照 G5 弹失败浮层并回到二维码（标题「登录失败：<message>」，说明取 loginFailureDescriptions）。
 */
export const loginFailureReasons = [
  'code_invalid',
  'state_mismatch',
  'dingtalk_unavailable',
] as const;
export const loginFailureReasonSchema = z.enum(loginFailureReasons);
export type LoginFailureReason = z.infer<typeof loginFailureReasonSchema>;

/** 失败浮层的标题后半（接口的 message） */
export const loginFailureMessages: Record<LoginFailureReason, string> = {
  code_invalid: '扫码结果已失效',
  state_mismatch: '登录已过期',
  dingtalk_unavailable: '暂时连不上钉钉',
};

/** 失败浮层的说明 */
export const loginFailureDescriptions: Record<LoginFailureReason, string> = {
  code_invalid: '请重新扫码。',
  state_mismatch: '请重新扫码。',
  dingtalk_unavailable: '请稍后重新扫码；仍不行请联系管理员。',
};

/** 扫码登录失败（400 code_invalid、state_mismatch；502 dingtalk_unavailable） */
export const loginFailedSchema = apiErrorSchema.extend({
  error: z.literal('login_failed'),
  reason: loginFailureReasonSchema,
});
export type LoginFailed = z.infer<typeof loginFailedSchema>;

/** 开发工具：模拟某人在手机上扫码并确认（只在非生产环境开启开发登录、钉钉用 Fake 时存在），返回钉钉会带回的授权码 */
export const devDingtalkScanRequestSchema = z.object({ userId: z.string().min(1) });
export const devDingtalkScanResponseSchema = z.object({ authCode: z.string() });

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
