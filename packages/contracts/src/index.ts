// 前后端共享的 zod 模式与类型（ADR 0005、0006）：接口用这里的模式声明，前端据此取得类型。
export { apiErrorSchema, type ApiError } from './api';
export {
  SYSTEM_ACTOR_NAME,
  auditObjectTypeLabels,
  auditObjectTypeSchema,
  type AuditObjectType,
} from './audit';
export {
  adminContactsSchema,
  BACKGROUND_REQUEST_HEADER,
  contactAdmins,
  currentMemberSchema,
  densities,
  densityLabels,
  densitySchema,
  devLoginRequestSchema,
  devMemberSchema,
  devMembersResponseSchema,
  loginDenialMessage,
  loginDenialReasons,
  loginDenialReasonSchema,
  loginDenialTitles,
  loginDeniedSchema,
  memberStatuses,
  memberStatusSchema,
  preferencesSchema,
  storeScopeSchema,
  type AdminContacts,
  type CurrentMember,
  type Density,
  type DevLoginRequest,
  type DevMember,
  type DevMembersResponse,
  type LoginDenialReason,
  type LoginDenied,
  type MemberStatus,
  type Preferences,
  type StoreScopeValue,
} from './auth';
export {
  can,
  capabilities,
  capabilityGroups,
  CURRENT_PHASE,
  grantsFor,
  isLive,
  rolesWith,
  type Capability,
  type CapabilityDefinition,
  type CapabilityGroup,
  type CapabilityStage,
  type Grant,
  type Phase,
} from './capabilities';
export {
  canViewFinance,
  financeField,
  FINANCE_HIDDEN,
  financeHiddenSchema,
  isFinanceField,
  maskFinanceFields,
  stripFinanceFields,
} from './finance';
export { healthResponseSchema, type HealthResponse } from './health';
export { adapterModeSchema, adapterModes, type AdapterMode } from './integration';
export { currencies, currencySchema, type Currency } from './money';
export { homeFor, navFor, navSections, navSectionSchema, type NavSection } from './navigation';
export { roleByLabel, roleLabels, roleNames, roles, roleSchema, type Role } from './roles';
