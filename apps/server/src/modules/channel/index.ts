// channel：店铺与邮箱；接入与规范化：收取、去重、店铺与来源识别、订单号抽取（ADR 0005；第一期起）。
// 其他模块只能经本文件调用本模块，不能引用内部文件或读写本模块的表。
export { channelStoresFixtureStep } from './fixtures';
export { gmailSyncJob, inboundReceivedJob } from './gmail-sync';
export { createChannelFeeds, createChannelJobHandlers, storeChangedJob } from './jobs';
export {
  findInboundMessage,
  listMessageSummaries,
  type InboundMessage,
  type MessageSummary,
} from './messages';
export { createChannelRoutes } from './routes';
export { storeNamesById } from './stores';
