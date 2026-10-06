// channel：店铺与邮箱；接入与规范化：收取、去重、店铺与来源识别、订单号抽取（ADR 0005；第一期起）。
// 其他模块只能经本文件调用本模块，不能引用内部文件或读写本模块的表。
export { channelSenderRulesFixtureStep, channelStoresFixtureStep } from './fixtures';
export { gmailPollJob, gmailRenewWatchJob, gmailSyncJob, inboundReceivedJob } from './gmail-sync';
export { createChannelFeeds, createChannelJobHandlers, storeChangedJob } from './jobs';
export {
  findInboundMessage,
  listMessageSummaries,
  listReceivedMail,
  type InboundMessage,
  type MessageSummary,
  type ReceivedMail,
} from './messages';
export { type MailAddress, type Recognition, type SenderRule } from './recognition';
export { clearInboundMail } from './reset';
export { createChannelRoutes } from './routes';
export { registerSenderRule } from './sender-rules';
export {
  findOrderStore,
  listOrderStores,
  listStoreChoices,
  listStoreOptions,
  storeNamesById,
} from './stores';
