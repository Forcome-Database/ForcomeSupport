// core：基础设施层（ADR 0005）——时钟、配置、日志、数据库与事务、后台任务（发件箱、定时）与常驻拉取、审计、业务编号、数据约定、汇率、站内通知、钉钉工作通知、
// 示例数据加载器（只用于非生产环境）、店铺数据范围与无权限错误。
// 其他模块只能经本文件使用 core；core 不依赖任何业务模块。
export { AccessDeniedError } from './access-denied';
export {
  alertClip,
  alertTestMessage,
  alertTime,
  formatAlertMessage,
  planAlerts,
  syncAlertProblem,
  type AlertFinding,
  type AlertMessage,
  type AlertPlan,
  type AlertSender,
  type FiringAlert,
} from './alerts';
export {
  announceChange,
  CHANGE_CHANNEL,
  createChangeFeed,
  type Change,
  type ChangeEvent,
  type ChangeFeed,
  type ChangeFeedOptions,
  type ChangeSubscription,
} from './changes';
export { xlsxDownloadHeaders } from './download';
export { FieldValidationError } from './field-validation';
export {
  queryAuditLog,
  recordAudit,
  systemActor,
  type Actor,
  type AuditEntry,
  type AuditLogConditions,
  type AuditLogPage,
  type AuditRecord,
  type AuditVisibility,
} from './audit';
export {
  ManualClock,
  startingAt,
  systemClock,
  toMilliseconds,
  UNDO_GRACE,
  type Clock,
  type Duration,
} from './clock';
export {
  amount,
  currency,
  feeChecks,
  feeColumns,
  primaryId,
  rate,
  timestamptz,
  version,
} from './columns';
export {
  clientModeVariable,
  ConfigError,
  DEFAULT_ALERT_SETTINGS,
  defaultClientMode,
  defaultMailSendPolicy,
  loadConfig,
  type AlertSettings,
  type AppConfig,
  type AppEnv,
  type DingtalkCredentials,
  type DingtalkRobotConfig,
  type GoogleCredentials,
  type MailSendPolicy,
  type ShopifyCredentials,
  type AmazonSqsConfig,
  type SpApiCredentials,
} from './config';
export { type Database, type DbExecutor, type DbTransaction } from './db';
export {
  exchangeRateOn,
  exchangeRatesOn,
  syncExchangeRatesJob,
  type DateRange,
  type EurReferenceRates,
  type ExchangeRateSource,
} from './exchange-rates';
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
export {
  drainJobs,
  requeueInterruptedJobs,
  type DrainJobsOptions,
  type DrainJobsReport,
  type FailedDrainJob,
} from './drain-jobs';
export { createCoreJobHandlers } from './job-handlers';
export { coreNotificationsFixtureStep } from './notification-fixtures';
export {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  sendNotification,
  type NotificationDraft,
  type NotificationViewer,
} from './notifications';
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
  type JobSchedule,
  type WorkerOptions,
} from './jobs';
export { createLogger, silentLogger, type Logger } from './logger';
export { selfCheckJob, type SelfCheckContext, type SelfCheckProbe } from './self-check';
export {
  queueWorkNotifications,
  sendWorkNotificationsJob,
  type WorkNotificationDraft,
  type WorkNotificationRecipient,
  type WorkNotificationSender,
} from './work-notifications';
export {
  businessNumberSequence,
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
