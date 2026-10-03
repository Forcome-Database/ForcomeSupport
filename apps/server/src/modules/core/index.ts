// core：基础设施层（ADR 0005）——时钟、配置、日志、数据库与事务、后台任务（发件箱）、审计、业务编号、数据约定。
// 其他模块只能经本文件使用 core；core 不依赖任何业务模块。
export { recordAudit, systemActor, type Actor, type AuditEntry } from './audit';
export { ManualClock, systemClock, type Clock, type Duration } from './clock';
export { amount, currency, primaryId, timestamptz, version } from './columns';
export { ConfigError, loadConfig, type AppConfig, type AppEnv } from './config';
export {
  closeDatabase,
  createDatabase,
  type Database,
  type DatabaseOptions,
  type DbExecutor,
  type DbTransaction,
} from './db';
export { OptimisticLockError, updateWithVersion } from './optimistic-lock';
export {
  createJobQueue,
  defineJob,
  ensureQueues,
  handleJob,
  startWorker,
  type AnyJobDefinition,
  type AnyJobHandler,
  type JobContext,
  type JobDefinition,
  type JobHandler,
  type JobQueueRole,
  type WorkerOptions,
} from './jobs';
export { createLogger, silentLogger, type Logger } from './logger';
export { nextBusinessNumber, type BusinessNumberKind } from './numbering';
export {
  startRuntime,
  transaction,
  type RunningRuntime,
  type Runtime,
  type RuntimeOptions,
  type Tx,
} from './runtime';
