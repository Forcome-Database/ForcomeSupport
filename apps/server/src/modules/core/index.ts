// core：基础设施层（ADR 0005）——时钟、配置、日志、数据库与事务、后台任务（发件箱）与常驻拉取、审计、业务编号、数据约定、
// 示例数据加载器（只用于非生产环境）、店铺数据范围与无权限错误。
// 其他模块只能经本文件使用 core；core 不依赖任何业务模块。
export { AccessDeniedError } from './access-denied';
export { FieldValidationError } from './field-validation';
export { recordAudit, systemActor, type Actor, type AuditEntry } from './audit';
export { ManualClock, systemClock, type Clock, type Duration } from './clock';
export { amount, currency, primaryId, timestamptz, version } from './columns';
export {
  clientModeVariable,
  ConfigError,
  defaultMailSendPolicy,
  loadConfig,
  type AppConfig,
  type AppEnv,
  type MailSendPolicy,
} from './config';
export { type Database, type DbExecutor, type DbTransaction } from './db';
export {
  defineFeed,
  startFeeds,
  type Feed,
  type FeedContext,
  type RunningFeeds,
  type StartFeedsOptions,
} from './feeds';
export {
  defineFixtureStep,
  loadFixtures,
  type FixtureLoadReport,
  type FixtureStep,
  type LoadFixturesOptions,
} from './fixtures';
export { OptimisticLockError, updateWithVersion } from './optimistic-lock';
export {
  defineJob,
  ensureQueues,
  handleJob,
  runJob,
  startWorker,
  type AnyJobDefinition,
  type AnyJobHandler,
  type FetchedJob,
  type JobContext,
  type JobDefinition,
  type JobHandler,
  type JobQueueRole,
  type WorkerOptions,
} from './jobs';
export { createLogger, silentLogger, type Logger } from './logger';
export {
  nextBusinessNumber,
  reserveBusinessNumbers,
  resetBusinessNumbers,
  type BusinessNumberKind,
} from './numbering';
export {
  isStoreInScope,
  memberStoreScope,
  storeScopeCondition,
  storeScopeValue,
  storesOutsideScope,
  SYSTEM_STORE_SCOPE,
  type StoreScope,
} from './store-scope';
export {
  advisoryLock,
  startRuntime,
  transaction,
  type RunningRuntime,
  type Runtime,
  type RuntimeOptions,
  type Tx,
} from './runtime';
