// org：成员、部门、钉钉同步、登录、角色与店铺范围（ADR 0005；第一期起）。
// 其他模块只能经本文件调用本模块，不能引用内部文件或读写本模块的表。
export {
  requireCapability,
  requireSession,
  type Access,
  type AccessVariables,
  type SessionMember,
  type StoreAccessTarget,
} from './access';
export {
  createAuditLogRoutes,
  type StoreNamesById,
  type TicketNumbersOfMessages,
} from './audit-log';
export { createDevLoginRoutes, devLoginAvailable } from './dev-login';
export {
  createDevDingtalkRoutes,
  createDingtalkLoginRoutes,
  devDingtalkScanAvailable,
} from './dingtalk-login';
export {
  createOrgFeeds,
  createOrgJobHandlers,
  checkDingtalkDirectory,
  dingtalkConnection,
  dingtalkEventJob,
  dingtalkReconcileJob,
} from './dingtalk-sync';
export { createDevNotificationRoutes } from './dev-notifications';
export { createLiveRoutes, LIVE_HEARTBEAT_MS } from './live';
export { orgMembersFixtureStep } from './fixtures';
export {
  createMember,
  listAftersalesOwners,
  lockMembersForShare,
  memberNamesById,
  type NewMember,
} from './members';
export { createNotificationRoutes, notifyMembers } from './notifications';
export { createOrgRoutes } from './routes';
export { memberDisabledJob } from './events';
export { orgSelfCheckProbe } from './self-check';
export { type MemberHandover, type TeamStoreChoices } from './team';
export { createTeamRoutes } from './team-routes';
export { SESSION_COOKIE, SESSION_IDLE_TIMEOUT_MS } from './session';
