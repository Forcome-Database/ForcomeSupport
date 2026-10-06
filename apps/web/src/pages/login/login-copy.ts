import { LOGIN_QR_EXPIRES_SECONDS } from '@forcome/contracts';

/*
 * 登录页（G11）与登录被拒（G12）的界面文案（逐字照原型 design/GlobalStates.dc.html；login-copy.test.ts 直接读原型核对）。
 * 被拒三种原因的标题与说明在 contracts（loginDenialTitles、loginDenialMessage，后端给出），这里只有登录页本身、会话过期与按钮。
 * 扫码登录失败的提示（不是被拒）在 contracts 的 loginFailureMessages、loginFailureDescriptions（后端给出），失败浮层的标题照 G5
 * 写成「<动作>失败：原因」；它们与「正在登录…」画在 G11 · G12 补充小样里（PRD v2.23，2026-10-06 确认），测试一并核对。
 */

/** G11：卡片标题、副标题、二维码下的有效期、底部说明 */
export const LOGIN = {
  title: '用钉钉扫码登录',
  subtitle: '打开钉钉，扫一扫下方二维码',
  validity: `二维码 ${LOGIN_QR_EXPIRES_SECONDS / 60} 分钟内有效`,
  note: '成员与部门来自钉钉通讯录，由管理员在本系统分配角色后才能进入',
} as const;

/** G11：二维码过期后的蒙层 */
export const QR_EXPIRED = { title: '二维码已过期', refresh: '刷新' } as const;

/** G12「会话过期」：7 天无操作退出登录后的画面 */
export const SESSION_EXPIRED = {
  title: '已退出登录',
  description: '7 天未操作，已退出登录。',
  action: '重新扫码登录',
} as const;

/** G12「未分配角色」「账号已停用」的按钮（生产厂对接人那一种没有按钮） */
export const BACK_TO_LOGIN = '返回登录页';

/** 扫码确认后等服务端换会话的过渡画面（G11 · G12 补充小样③） */
export const SIGNING_IN = '正在登录…';

/** 失败浮层的动作（G5「<动作>失败：原因」）：扫码登录（补充小样②④）、取二维码（补充小样①） */
export const LOGIN_ACTION = '登录';
export const QR_ACTION = '加载二维码';
