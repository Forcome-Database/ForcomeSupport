// 前后端共享的 zod 模式与类型（ADR 0005、0006）：接口用这里的模式声明，前端据此取得类型。
export {
  SYSTEM_ACTOR_NAME,
  auditObjectTypeLabels,
  auditObjectTypeSchema,
  type AuditObjectType,
} from './audit';
export { healthResponseSchema, type HealthResponse } from './health';
export { currencies, currencySchema, type Currency } from './money';
