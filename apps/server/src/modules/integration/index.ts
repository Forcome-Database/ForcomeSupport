// integration：全部外部适配器与客户端、调用记录；只能依赖 core（ADR 0005；第一期起）。
// 其他模块只能经本文件调用本模块，不能引用内部文件或读写本模块的表。
export {
  databaseCallRecorder,
  noCallRecords,
  type CallRecordEntry,
  type CallRecorder,
} from './call-records';
export {
  createIntegrationClients,
  FakeNotAllowedError,
  IntegrationClients,
  type IntegrationClientsOptions,
  type StoreClientSelection,
} from './clients';
export {
  defineClient,
  type AnyClientDefinition,
  type ClientDefinition,
  type ClientScope,
  type FakeClient,
  type FakeContext,
  type RealClientContext,
} from './definition';
export {
  dingtalkClient,
  DingtalkAuthCodeError,
  dingtalkDepartmentEvents,
  dingtalkUserEvents,
  FakeDingtalk,
  type DingtalkClient,
  type DingtalkDepartment,
  type DingtalkDirectory,
  type DingtalkEvent,
  type DingtalkLoginIdentity,
  type DingtalkUser,
  type SentWorkNotification,
} from './dingtalk';
export { factoryHeadUserId } from './dingtalk-replay';
export {
  exchangeRateClient,
  FakeExchangeRates,
  type ExchangeRateClient,
  type UsdQuotes,
} from './exchange-rate';
export {
  FakeGmail,
  FakeGmailPush,
  gmailClient,
  gmailPushClient,
  type GmailClient,
  type GmailNotification,
  type GmailPushClient,
  type GmailRawMessage,
} from './gmail';
export { type FakeMailInput } from './gmail-mime';
export { MailRecipientGuard, MailRecipientNotAllowedError } from './mail-recipient-guard';
export {
  databaseCredentialVault,
  type CredentialVault,
  type StoredCredential,
} from './credential-vault';
export {
  FakeShopify,
  shopifyClient,
  type FakeShopifyOrderInput,
  type ShopifyAddress,
  type ShopifyClient,
  type ShopifyLineItem,
  type ShopifyOrder,
  type ShopifyOrderPage,
  type ShopifyTracking,
} from './shopify';
export {
  AMAZON_MARKETPLACES,
  amazonOrdersClient,
  FakeAmazonOrders,
  type AmazonOrder,
  type AmazonOrderItem,
  type AmazonOrderPage,
  type AmazonOrdersClient,
  type AmazonPackage,
  type AmazonShipTo,
  type FakeAmazonOrderInput,
} from './amazon-orders';
export { storeSpApiRefreshToken } from './amazon-orders-real';
export {
  amazonSqsClient,
  FakeAmazonSqs,
  type AmazonNotificationsClient,
  type OrderChangeNotification,
  type QueueMessage,
} from './amazon-sqs';
export { type SpApiPriority } from './sp-api-quota';
export {
  ClientNotConfiguredError,
  ConnectionLostError,
  CursorExpiredError,
  ExternalCallFailedError,
  ExternalServiceError,
  ExternalTimeoutError,
  FaultInjector,
  type FaultSpec,
} from './faults';
